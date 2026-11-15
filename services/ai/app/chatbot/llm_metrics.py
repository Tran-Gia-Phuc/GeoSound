"""Prometheus metrics of the chat agent's LLM calls (deployment task 4.3, issue #400).

The chat agent does not use `app/llm/fallback.py`: it calls a LangChain chat model
(Gemini `.with_fallbacks([Groq])`, or Groq alone for overflow turns, see
`app/chatbot/models.py`). `ChatLLMMetrics` is a LangChain callback attached to
that model; it records the same metrics as `FallbackLLM` with `task="chat"`:

- `llm_requests_total{provider, task="chat", outcome}` and
  `llm_request_duration_seconds` for every chat model run (one per provider tried);
- `llm_fallback_total{from, to}` when a model inside a fallback chain starts after
  a sibling failed with 429, 5xx or a timeout. LangChain 1.6 does not give these
  model runs the chain as `parent_run_id`, so the chain state lives in a context
  variable: each chat turn runs in its own asyncio task, hence its own context.

The provider comes from LangChain's `ls_provider` metadata or the model class
name, never from the messages. An empty answer counts as `blocked`: Gemini
returns one when it blocks content (the `answer` node then refuses politely).
"""

from __future__ import annotations

import time
from contextvars import ContextVar
from typing import Any
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler

from app import metrics

TASK = "chat"

# State of the fallback chain running in this context: {"failed": provider or None}.
_fallback_chain: ContextVar[dict[str, Any] | None] = ContextVar("chat_fallback_chain", default=None)


def chat_provider(serialized: Any, metadata: Any) -> str:
    """`gemini`, `groq` or `other` from LangChain metadata or the model class name."""
    hint = ""
    if isinstance(metadata, dict):
        hint = str(metadata.get("ls_provider") or "")
    if not hint and isinstance(serialized, dict):
        ids = serialized.get("id")
        hint = str(ids[-1]) if isinstance(ids, list) and ids else str(serialized.get("name") or "")
    hint = hint.lower()
    if "groq" in hint:
        return "groq"
    if "google" in hint or "gemini" in hint:
        return "gemini"
    return metrics.OTHER


def _has_text(response: Any) -> bool:
    for generations in getattr(response, "generations", None) or []:
        for generation in generations or []:
            message = getattr(generation, "message", None)
            content = getattr(message, "content", None) if message is not None else None
            if content is None:
                content = getattr(generation, "text", "")
            if isinstance(content, str) and content.strip():
                return True
            if isinstance(content, list) and any(
                (part.get("text") if isinstance(part, dict) else part) for part in content
            ):
                return True
    return False


class ChatLLMMetrics(BaseCallbackHandler):
    """Callback that counts chat model runs. Keeps only run ids, providers and timestamps."""

    # Called directly in the event loop, in order, in the context of the run (no thread pool).
    run_inline = True
    raise_error = False

    def __init__(self) -> None:
        self._runs: dict[UUID, tuple[str, float]] = {}

    # The only chain this handler sees is the fallback chain around the chat models.
    def on_chain_start(self, serialized: Any, inputs: Any, *, run_id: UUID, **kwargs: Any) -> None:
        _fallback_chain.set({"failed": None})

    def _end_chain(self) -> None:
        state = _fallback_chain.get()
        if state is not None:
            state["failed"] = None
        _fallback_chain.set(None)

    def on_chain_end(self, outputs: Any, *, run_id: UUID, **kwargs: Any) -> None:
        self._end_chain()

    def on_chain_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        self._end_chain()

    def on_chat_model_start(self, serialized: Any, messages: Any, *, run_id: UUID,
                            metadata: Any = None, **kwargs: Any) -> None:
        provider = chat_provider(serialized, metadata)
        state = _fallback_chain.get()
        if state is not None and state.get("failed") is not None:
            metrics.record_fallback(state["failed"], provider)
            state["failed"] = None
        self._runs[run_id] = (provider, time.perf_counter())

    def on_llm_end(self, response: Any, *, run_id: UUID, **kwargs: Any) -> None:
        entry = self._runs.pop(run_id, None)
        if entry is None:
            return
        provider, started = entry
        outcome = "ok" if _has_text(response) else "blocked"
        metrics.record_llm_call(provider, TASK, outcome, time.perf_counter() - started)

    def on_llm_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        entry = self._runs.pop(run_id, None)
        if entry is None:
            return
        provider, started = entry
        outcome = metrics.llm_outcome(error)
        metrics.record_llm_call(provider, TASK, outcome, time.perf_counter() - started)
        # The next model started in this fallback chain is a fallback (same rule as the
        # chain itself: only 429, 5xx and timeouts are handed on).
        state = _fallback_chain.get()
        if state is not None and outcome in metrics.FALLBACK_OUTCOMES:
            state["failed"] = provider


_handler: ChatLLMMetrics | None = None


def with_llm_metrics(model: Any) -> Any:
    """`model` with the shared ChatLLMMetrics callback; test fakes without
    `with_config` come back unchanged."""
    global _handler
    if not hasattr(model, "with_config"):
        return model
    if _handler is None:
        _handler = ChatLLMMetrics()
    return model.with_config(callbacks=[_handler])

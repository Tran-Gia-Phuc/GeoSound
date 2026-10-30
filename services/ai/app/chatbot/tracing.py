"""LangSmith tracing of chat turns with hidden inputs (task #AI-47, issue #188).

With LANGSMITH_TRACING=true, LangChain would trace every graph node, tool and
model call with its full inputs and outputs: user messages, retrieved text and
the `nearby_places` arguments (`lat`, `lng`). The chat agent therefore gets an
explicit `LangChainTracer` whose LangSmith client redacts every run:

- `hide_inputs` / `hide_outputs` = `redact`: only a whitelist of scalar fields
  (intent, lang, finish_reason, llm_calls, tools_called) is kept; everything
  else, including tool input strings with coordinates and all message text,
  is replaced by the number of hidden keys.
- `hide_metadata` is left to the default (run names, latency, model name stay).

Because a `LangChainTracer` is already in the callbacks, LangChain does not add
its environment tracer on top. Flag off: [] and `langsmith` is not touched.
Any problem (empty key, tracer error): [] plus one warning, the chat runs untraced.
"""

import importlib
import logging
from functools import lru_cache
from typing import Any

from app.config import get_settings

logger = logging.getLogger(__name__)

SAFE_FIELDS = frozenset({"intent", "lang", "finish_reason", "llm_calls", "tools_called"})


def redact(data: Any) -> dict[str, Any]:
    """Run inputs or outputs as LangSmith will store them: whitelisted fields only."""
    if not isinstance(data, dict):
        return {"hidden": 1}
    kept: dict[str, Any] = {}
    hidden = 0
    for key, value in data.items():
        if key in SAFE_FIELDS and (
            isinstance(value, (bool, int, float, str))
            or (isinstance(value, list) and all(isinstance(v, str) for v in value))
        ):
            kept[key] = value
        else:
            hidden += 1
    if hidden:
        kept["hidden"] = hidden
    return kept


@lru_cache
def chat_callbacks() -> tuple[Any, ...]:
    """Callbacks for the chat agent: the redacting tracer, or () when untraced."""
    settings = get_settings()
    if not settings.langsmith_tracing:
        return ()
    api_key = settings.langsmith_api_key.get_secret_value().strip()
    if not api_key:
        logger.warning("LANGSMITH_TRACING is on but LANGSMITH_API_KEY is empty; chat runs untraced")
        return ()
    try:
        langsmith = importlib.import_module("langsmith")
        from langchain_core.tracers import LangChainTracer

        client = langsmith.Client(api_key=api_key, hide_inputs=redact, hide_outputs=redact)
        return (LangChainTracer(project_name=settings.langsmith_project, client=client),)
    except Exception as exc:  # never fail chat because of tracing
        logger.warning("LangSmith chat tracer could not be created (%s); chat runs untraced",
                       type(exc).__name__)
        return ()

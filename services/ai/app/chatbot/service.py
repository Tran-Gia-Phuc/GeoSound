"""Chat session wrapper used by POST /chat and GET /chat/history (task #AI-47, issue #188).

`ChatService` wraps `ChatAgent` and adds what the API needs:

- per-message metadata: `at` (ISO 8601, UTC, ends with `Z`) for every message
  and `citations` for assistant messages, kept beside the checkpointed
  messages and joined by message id in `history()`;
- session TTL: a session idle for more than CHAT_SESSION_TTL_HOURS is
  deleted (checkpoints and metadata) on the next request. MemorySaver has no
  expiry of its own, so the wrapper does it (clock injectable for tests).
  Sessions and metadata live in this process, like MemorySaver; the Postgres
  checkpointer (#219) will need the same metadata stored with it.

`GuardedChatModel` wraps the LLM call of a turn (moderation keeps priority):

1. the shared moderation semaphore (D13) must have a free slot and no
   moderation waiter; chat never queues, it gets 429 instead;
2. the global Gemini chat cap (CHAT_GLOBAL_RATE_LIMIT_PER_MIN, LLM-backed
   turns only) must allow the call; the Gemini model (with its Groq fallback)
   then runs holding the slot, only for the LLM call itself;
3. over the cap, the turn runs on a Groq-only model (text only, section 7)
   when GROQ_API_KEY is set: it neither counts against the cap nor takes the
   moderation slot. Without Groq: 429 with the window's Retry-After.

Turns that need no LLM (out of scope, no data) never touch the cap or the slot.
"""

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.chatbot.agent import ChatAgent
from app.chatbot.limits import ChatBusyError, SlidingWindowLimiter
from app.chatbot.rag.retriever import NullRetriever, Retriever
from app.chatbot.tracing import chat_callbacks
from app.config import Settings, get_settings
from app.moderation.pipeline import shared_semaphore

logger = logging.getLogger(__name__)

# Retry-After when every AI slot is taken (moderation calls last a few seconds).
BUSY_RETRY_AFTER_SECONDS = 5


def iso_utc(epoch_seconds: float) -> str:
    stamp = datetime.fromtimestamp(epoch_seconds, tz=timezone.utc)
    return stamp.isoformat(timespec="milliseconds").replace("+00:00", "Z")


class GuardedChatModel:
    """LLM of the chat agent behind the AI slot and the global chat cap."""

    def __init__(
        self,
        factory: Callable[[], Any],
        limiter: SlidingWindowLimiter,
        semaphore: Callable[[], Any] = shared_semaphore,
        overflow_factory: Callable[[], Any] | None = None,
    ) -> None:
        self._factory = factory
        self._model: Any = None
        self._overflow_factory = overflow_factory
        self._overflow: Any = None
        self.limiter = limiter
        self._semaphore = semaphore

    def _get(self) -> Any:
        if self._model is None:
            self._model = self._factory()
        return self._model

    async def ainvoke(self, messages, *args, **kwargs):
        semaphore = self._semaphore()
        if semaphore.locked():  # full, or moderation is already waiting
            raise ChatBusyError(BUSY_RETRY_AFTER_SECONDS, "ai_busy")
        allowed, retry_after = self.limiter.try_acquire()
        if not allowed:
            if self._overflow_factory is None:
                raise ChatBusyError(retry_after, "chat_cap")
            if self._overflow is None:
                self._overflow = self._overflow_factory()
            # Groq overflow: outside the Gemini cap and the moderation slot.
            return await self._overflow.ainvoke(messages, *args, **kwargs)
        async with semaphore:
            return await self._get().ainvoke(messages, *args, **kwargs)


@dataclass
class _Session:
    last_seen: float
    meta: dict[str, dict[str, Any]] = field(default_factory=dict)


class ChatService:
    def __init__(self, agent: ChatAgent, *, ttl_seconds: float,
                 clock: Callable[[], float] = time.time) -> None:
        self.agent = agent
        self.ttl_seconds = ttl_seconds
        self.clock = clock
        self._sessions: dict[str, _Session] = {}

    async def evict_expired(self) -> int:
        """Delete sessions idle for longer than the TTL. Returns how many were deleted."""
        limit = self.clock() - self.ttl_seconds
        expired = [sid for sid, s in self._sessions.items() if s.last_seen < limit]
        for sid in expired:
            self._sessions.pop(sid, None)
            try:
                await self.agent.delete_session(sid)
            except Exception as exc:
                logger.warning("chat session eviction failed (%s)", type(exc).__name__)
        return len(expired)

    async def turn(self, session_id: str, message: str, *, location: dict | None = None,
                   language: str | None = None) -> dict[str, Any]:
        """Run one turn. Errors propagate; the agent has already removed the user message."""
        await self.evict_expired()
        asked_at = self.clock()
        result = await self.agent.run(session_id, message, location=location, language=language)
        now = self.clock()
        session = self._sessions.setdefault(session_id, _Session(last_seen=now))
        session.last_seen = now
        session.meta[result["user_message_id"]] = {"at": iso_utc(asked_at)}
        if result.get("answer_id"):
            session.meta[result["answer_id"]] = {
                "at": iso_utc(now), "citations": list(result.get("citations", []))}
        return result

    async def history(self, session_id: str) -> list[dict[str, Any]] | None:
        """Stored messages with `at` (and `citations` for the assistant); None = unknown session."""
        await self.evict_expired()
        session = self._sessions.get(session_id)
        if session is None:
            return None
        stored = await self.agent.history(session_id)
        if not stored:
            return None
        ids = {m["id"] for m in stored}
        session.meta = {k: v for k, v in session.meta.items() if k in ids}  # drop trimmed turns
        out = []
        for m in stored:
            meta = session.meta.get(m["id"], {})
            entry: dict[str, Any] = {"role": m["role"], "content": m["content"],
                                     "at": meta.get("at") or iso_utc(session.last_seen)}
            if m["role"] == "assistant":
                entry["citations"] = meta.get("citations", [])
            out.append(entry)
        return out


def build_retriever(settings: Settings) -> Retriever:
    """HybridRetriever over pgvector when available, else NullRetriever (one warning)."""
    if settings.database_url_ai:
        try:
            from app.chatbot.rag.embedder import build_embedder
            from app.chatbot.rag.hybrid_retriever import HybridRetriever
            from app.chatbot.rag.store import PgVectorIndexStore

            embedder = build_embedder(settings)
            return HybridRetriever(PgVectorIndexStore(settings.database_url_ai, embedder.dimension),
                                   embedder)
        except Exception as exc:  # store or embedder runtime not there yet (TODO #219)
            logger.warning("chatbot index unavailable (%s); chat runs with an empty retriever",
                           type(exc).__name__)
    else:
        logger.warning("DATABASE_URL_AI is empty; chat runs with an empty retriever")
    return NullRetriever()


def build_chat_service(settings: Settings | None = None) -> ChatService:
    """Production wiring, called lazily on the first chat request."""
    settings = settings or get_settings()

    def factory():
        from app.chatbot import models

        return models.build_chat_model(settings)

    def overflow_factory():
        from app.chatbot import models

        return models.build_groq_chat_model(settings)

    model = GuardedChatModel(
        factory,
        SlidingWindowLimiter(settings.chat_global_rate_limit_per_min),
        overflow_factory=overflow_factory if settings.groq_api_key else None,
    )
    agent = ChatAgent(build_retriever(settings), model=model, callbacks=list(chat_callbacks()))
    return ChatService(agent, ttl_seconds=settings.chat_session_ttl_hours * 3600)

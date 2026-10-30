"""Chat session wrapper used by POST /chat and GET /chat/history (task #AI-47, issue #188).

`ChatService` wraps `ChatAgent` and adds what the API needs:

- per-message metadata: `at` (ISO 8601, UTC, ends with `Z`) for every message
  and `citations` for assistant messages, kept beside the checkpointed
  messages and joined by message id in `history()`;
- session TTL: a session idle for more than CHAT_SESSION_TTL_HOURS is
  deleted (checkpoints and metadata). A sweep of every idle session runs on a
  request at most once per EVICTION_INTERVAL_SECONDS, and the session of the
  request itself is always checked. Checkpointers have no expiry of their own,
  so the wrapper does it (clock injectable for tests).
- memory backend (CHAT_MEMORY_BACKEND, `chatbot/memory.py`, #219): in-process
  (`memory`, default) or Postgres schema `ai_chat` shared by every replica
  (`postgres`). The metadata store port hides the difference.

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
from datetime import datetime, timezone
from typing import Any

from app.chatbot.agent import ChatAgent
from app.chatbot.limits import ChatBusyError, SlidingWindowLimiter
from app.chatbot.memory import (
    ChatMemory,
    ChatMetadataStore,
    InMemoryMetadataStore,
    MessageMeta,
    memory_chat_memory,
    open_chat_memory,
    resolve_backend,
)
from app.chatbot.rag.retriever import NullRetriever, Retriever
from app.chatbot.tracing import chat_callbacks
from app.config import Settings, get_settings
from app.moderation.pipeline import shared_semaphore

logger = logging.getLogger(__name__)

# Retry-After when every AI slot is taken (moderation calls last a few seconds).
BUSY_RETRY_AFTER_SECONDS = 5
# The sweep of idle sessions runs at most this often (one DELETE across replicas).
EVICTION_INTERVAL_SECONDS = 60.0


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


class ChatService:
    def __init__(self, agent: ChatAgent, *, ttl_seconds: float,
                 clock: Callable[[], float] = time.time,
                 metadata: ChatMetadataStore | None = None,
                 memory: ChatMemory | None = None,
                 eviction_interval_seconds: float = EVICTION_INTERVAL_SECONDS) -> None:
        self.agent = agent
        self.ttl_seconds = ttl_seconds
        self.clock = clock
        self.memory = memory
        if metadata is None:
            metadata = memory.metadata if memory is not None else InMemoryMetadataStore()
        self.metadata = metadata
        self.eviction_interval_seconds = eviction_interval_seconds
        self._last_sweep: float | None = None

    async def _drop_checkpoints(self, session_id: str) -> None:
        try:
            await self.agent.delete_session(session_id)
        except Exception as exc:
            logger.warning("chat session eviction failed (%s)", type(exc).__name__)

    async def evict_expired(self, *, force: bool = False) -> int:
        """Delete sessions idle for longer than the TTL, at most once per interval.

        Returns how many sessions this call deleted (checkpoints and metadata).
        """
        now = self.clock()
        if (not force and self._last_sweep is not None
                and now - self._last_sweep < self.eviction_interval_seconds):
            return 0
        self._last_sweep = now
        try:
            expired = await self.metadata.delete_idle(now - self.ttl_seconds)
        except Exception as exc:  # never fail a request because of the sweep
            logger.warning("chat session sweep failed (%s)", type(exc).__name__)
            return 0
        for sid in expired:
            await self._drop_checkpoints(sid)
        return len(expired)

    async def _live_last_active(self, session_id: str) -> float | None:
        """Last activity of a live session; an idle one is deleted right now (None)."""
        last = await self.metadata.last_active(session_id)
        if last is not None and last < self.clock() - self.ttl_seconds:
            if await self.metadata.delete(session_id):
                await self._drop_checkpoints(session_id)
            return None
        return last

    async def turn(self, session_id: str, message: str, *, location: dict | None = None,
                   language: str | None = None) -> dict[str, Any]:
        """Run one turn. Errors propagate; the agent has already removed the user message."""
        await self.evict_expired()
        await self._live_last_active(session_id)  # an idle session starts from scratch
        asked_at = self.clock()
        result = await self.agent.run(session_id, message, location=location, language=language)
        now = self.clock()
        entries = [MessageMeta(result["user_message_id"], "user", asked_at)]
        if result.get("answer_id"):
            entries.append(MessageMeta(result["answer_id"], "assistant", now,
                                       list(result.get("citations", []))))
        await self.metadata.record(session_id, entries, now)
        return result

    async def history(self, session_id: str) -> list[dict[str, Any]] | None:
        """Stored messages with `at` (and `citations` for the assistant); None = unknown session."""
        await self.evict_expired()
        last = await self._live_last_active(session_id)
        if last is None:
            return None
        stored = await self.agent.history(session_id)
        if not stored:
            return None
        ids = {m["id"] for m in stored}
        meta = await self.metadata.messages(session_id)
        if set(meta) - ids:
            await self.metadata.prune(session_id, ids)  # drop trimmed turns
        out = []
        for m in stored:
            info = meta.get(m["id"])
            entry: dict[str, Any] = {"role": m["role"], "content": m["content"],
                                     "at": iso_utc(info.at if info else last)}
            if m["role"] == "assistant":
                entry["citations"] = list(info.citations or []) if info else []
            out.append(entry)
        return out

    async def aclose(self) -> None:
        """Close the retriever's store pool and the chat memory pool, if any (app shutdown)."""
        store = getattr(self.agent.retriever, "store", None)
        close = getattr(store, "aclose", None)
        if close is not None:
            try:
                await close()
            except Exception as exc:
                logger.warning("chatbot store close failed (%s)", type(exc).__name__)
        if self.memory is not None:
            try:
                await self.memory.aclose()
            except Exception as exc:
                logger.warning("chat memory close failed (%s)", type(exc).__name__)


def build_retriever(settings: Settings) -> Retriever:
    """HybridRetriever over pgvector when DATABASE_URL_AI is set, else NullRetriever (one warning).

    Nothing connects here: the asyncpg pool opens on the first query and is closed
    by `ChatService.aclose()` on app shutdown.
    """
    if settings.database_url_ai:
        try:
            from app.chatbot.rag.embedder import build_embedder
            from app.chatbot.rag.hybrid_retriever import HybridRetriever
            from app.chatbot.rag.store import PgVectorIndexStore

            embedder = build_embedder(settings)
            return HybridRetriever(PgVectorIndexStore(settings.database_url_ai, embedder.dimension),
                                   embedder)
        except Exception as exc:  # embedder runtime missing: never echo the DSN
            logger.warning("chatbot index unavailable (%s); chat runs with an empty retriever",
                           type(exc).__name__)
    else:
        logger.warning("DATABASE_URL_AI is empty; chat runs with an empty retriever")
    return NullRetriever()


async def load_city_aliases(retriever: Retriever) -> dict[str, str] | None:
    """City aliases from the index (City nodes) when the retriever has them, else None."""
    load = getattr(retriever, "city_aliases_from_index", None)
    if load is None:
        return None
    try:
        return await load()
    except Exception as exc:  # index not reachable yet: keep the built-in aliases
        logger.warning("chatbot city aliases not loaded from the index (%s)", type(exc).__name__)
        return None


def build_chat_service(settings: Settings | None = None, *, retriever: Retriever | None = None,
                       city_aliases: dict[str, str] | None = None,
                       memory: ChatMemory | None = None) -> ChatService:
    """Production wiring. Without `memory`, only the in-process backend is built here;
    the Postgres one has to be opened first (`abuild_chat_service`)."""
    settings = settings or get_settings()
    if memory is None:
        if resolve_backend(settings) != "memory":
            raise RuntimeError("the postgres chat memory is opened by abuild_chat_service")
        memory = memory_chat_memory()

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
    retriever = retriever if retriever is not None else build_retriever(settings)
    agent = ChatAgent(retriever, model=model, checkpointer=memory.checkpointer,
                      callbacks=list(chat_callbacks()), city_aliases=city_aliases)
    return ChatService(agent, ttl_seconds=settings.chat_session_ttl_hours * 3600, memory=memory)


async def abuild_chat_service(settings: Settings | None = None) -> ChatService:
    """`build_chat_service` plus the opened chat memory and the city aliases of the index.

    A wrong CHAT_MEMORY_BACKEND setup raises: no silent fallback to in-process memory.
    """
    settings = settings or get_settings()
    memory = await open_chat_memory(settings)
    try:
        retriever = build_retriever(settings)
        aliases = await load_city_aliases(retriever)
        return build_chat_service(settings, retriever=retriever, city_aliases=aliases,
                                  memory=memory)
    except BaseException:
        await memory.aclose()
        raise

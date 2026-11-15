"""Chat memory backends (issue #219, part D).

CHAT_MEMORY_BACKEND selects where chat sessions live:

- `memory` (default): LangGraph `MemorySaver` plus `InMemoryMetadataStore`, in this
  process only. Used by the tests and by a single replica.
- `postgres`: the official LangGraph `AsyncPostgresSaver` plus `PostgresMetadataStore`,
  shared by every AI replica. Needs DATABASE_URL_DIRECT_AI (Supabase session pooler):
  there is no silent fallback to `memory`.

Postgres layout: everything lives in the dedicated schema `ai_chat`, never in schema
`ai` (managed by `prisma db push`, which would drop unknown tables). Every pooled
connection runs `SET search_path TO ai_chat`, so the checkpointer's own tables
(`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations`) land
there. `setup()` is idempotent and runs once when the chat service is built:

    ai_chat.chat_sessions(session_id PK, last_active_at timestamptz)
    ai_chat.chat_messages(session_id FK ON DELETE CASCADE, message_id, role, at, citations jsonb)

Messages themselves are in the checkpoints; `chat_messages` only keeps their metadata
(`at`, citations), joined by message id in `ChatService.history()`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Protocol

from app.config import Settings

logger = logging.getLogger(__name__)

CHAT_SCHEMA = "ai_chat"
MEMORY_BACKENDS = ("memory", "postgres")
_POOL_MIN_SIZE = 1
_POOL_MAX_SIZE = 4
_POOL_OPEN_TIMEOUT_SECONDS = 30.0


class ChatMemoryConfigError(RuntimeError):
    """CHAT_MEMORY_BACKEND is unknown, or `postgres` lacks DATABASE_URL_DIRECT_AI."""


@dataclass(frozen=True)
class MessageMeta:
    message_id: str
    role: str  # "user" | "assistant"
    at: float  # epoch seconds
    citations: list[dict[str, Any]] | None = None  # assistant only


class ChatMetadataStore(Protocol):
    """Per-message metadata and session activity, beside the checkpointer."""

    async def record(self, session_id: str, messages: list[MessageMeta], now: float) -> None:
        """Create or refresh the session (last activity = now) and add message metadata."""

    async def last_active(self, session_id: str) -> float | None:
        """Last activity of the session (epoch seconds), None when unknown."""

    async def messages(self, session_id: str) -> dict[str, MessageMeta]:
        """Metadata of the session's messages, keyed by message id."""

    async def prune(self, session_id: str, keep_ids: set[str]) -> None:
        """Drop the metadata of messages no longer in the checkpoint (trimmed turns)."""

    async def delete(self, session_id: str) -> bool:
        """Delete one session and its metadata; True when it existed."""

    async def delete_idle(self, before: float) -> list[str]:
        """Delete sessions idle since `before` and return their ids (claimed once)."""


# ---------------------------------------------------------------------------
# In memory
# ---------------------------------------------------------------------------

@dataclass
class _Session:
    last_active: float
    meta: dict[str, MessageMeta] = field(default_factory=dict)


class InMemoryMetadataStore:
    def __init__(self) -> None:
        self._sessions: dict[str, _Session] = {}

    async def record(self, session_id: str, messages: list[MessageMeta], now: float) -> None:
        session = self._sessions.setdefault(session_id, _Session(last_active=now))
        session.last_active = now
        for m in messages:
            session.meta[m.message_id] = m

    async def last_active(self, session_id: str) -> float | None:
        session = self._sessions.get(session_id)
        return session.last_active if session else None

    async def messages(self, session_id: str) -> dict[str, MessageMeta]:
        session = self._sessions.get(session_id)
        return dict(session.meta) if session else {}

    async def prune(self, session_id: str, keep_ids: set[str]) -> None:
        session = self._sessions.get(session_id)
        if session:
            session.meta = {k: v for k, v in session.meta.items() if k in keep_ids}

    async def delete(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None

    async def delete_idle(self, before: float) -> list[str]:
        expired = [sid for sid, s in self._sessions.items() if s.last_active < before]
        for sid in expired:
            self._sessions.pop(sid, None)
        return expired


# ---------------------------------------------------------------------------
# Postgres (psycopg 3 pool shared with the checkpointer)
# ---------------------------------------------------------------------------

_SETUP_SQL = (
    f"CREATE TABLE IF NOT EXISTS {CHAT_SCHEMA}.chat_sessions ("
    " session_id text PRIMARY KEY,"
    " last_active_at timestamptz NOT NULL)",
    f"CREATE INDEX IF NOT EXISTS chat_sessions_last_active_idx"
    f" ON {CHAT_SCHEMA}.chat_sessions (last_active_at)",
    f"CREATE TABLE IF NOT EXISTS {CHAT_SCHEMA}.chat_messages ("
    f" session_id text NOT NULL REFERENCES {CHAT_SCHEMA}.chat_sessions (session_id)"
    " ON DELETE CASCADE,"
    " message_id text NOT NULL,"
    " role text NOT NULL CHECK (role IN ('user', 'assistant')),"
    " at timestamptz NOT NULL,"
    " citations jsonb,"
    " PRIMARY KEY (session_id, message_id))",
)


def _ts(epoch: float) -> datetime:
    return datetime.fromtimestamp(epoch, tz=timezone.utc)


class PostgresMetadataStore:
    """Metadata in `ai_chat.chat_sessions` / `ai_chat.chat_messages` (tables qualified)."""

    def __init__(self, pool: Any) -> None:
        self.pool = pool

    async def setup(self) -> None:
        async with self.pool.connection() as conn:
            for sql in _SETUP_SQL:
                await conn.execute(sql)

    async def record(self, session_id: str, messages: list[MessageMeta], now: float) -> None:
        from psycopg.types.json import Jsonb

        async with self.pool.connection() as conn:
            async with conn.transaction():
                await conn.execute(
                    f"INSERT INTO {CHAT_SCHEMA}.chat_sessions (session_id, last_active_at)"
                    " VALUES (%s, %s) ON CONFLICT (session_id)"
                    " DO UPDATE SET last_active_at = GREATEST("
                    f"{CHAT_SCHEMA}.chat_sessions.last_active_at, EXCLUDED.last_active_at)",
                    (session_id, _ts(now)),
                )
                for m in messages:
                    await conn.execute(
                        f"INSERT INTO {CHAT_SCHEMA}.chat_messages"
                        " (session_id, message_id, role, at, citations)"
                        " VALUES (%s, %s, %s, %s, %s)"
                        " ON CONFLICT (session_id, message_id) DO UPDATE SET"
                        " role = EXCLUDED.role, at = EXCLUDED.at, citations = EXCLUDED.citations",
                        (session_id, m.message_id, m.role, _ts(m.at),
                         Jsonb(m.citations) if m.citations is not None else None),
                    )

    async def last_active(self, session_id: str) -> float | None:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                f"SELECT last_active_at FROM {CHAT_SCHEMA}.chat_sessions WHERE session_id = %s",
                (session_id,),
            )
            row = await cur.fetchone()
        return row["last_active_at"].timestamp() if row else None

    async def messages(self, session_id: str) -> dict[str, MessageMeta]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT message_id, role, at, citations"
                f" FROM {CHAT_SCHEMA}.chat_messages WHERE session_id = %s",
                (session_id,),
            )
            rows = await cur.fetchall()
        return {
            r["message_id"]: MessageMeta(r["message_id"], r["role"], r["at"].timestamp(),
                                         r["citations"])
            for r in rows
        }

    async def prune(self, session_id: str, keep_ids: set[str]) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                f"DELETE FROM {CHAT_SCHEMA}.chat_messages"
                " WHERE session_id = %s AND NOT (message_id = ANY(%s))",
                (session_id, list(keep_ids)),
            )

    async def delete(self, session_id: str) -> bool:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                f"DELETE FROM {CHAT_SCHEMA}.chat_sessions WHERE session_id = %s",
                (session_id,),
            )
            return (cur.rowcount or 0) > 0

    async def delete_idle(self, before: float) -> list[str]:
        # DELETE ... RETURNING: each idle session is claimed by exactly one replica.
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                f"DELETE FROM {CHAT_SCHEMA}.chat_sessions WHERE last_active_at < %s"
                " RETURNING session_id",
                (_ts(before),),
            )
            rows = await cur.fetchall()
        return [r["session_id"] for r in rows]


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------

@dataclass
class ChatMemory:
    """Checkpointer + metadata store of one backend, and how to close them."""

    backend: str
    checkpointer: Any
    metadata: ChatMetadataStore
    _close: Callable[[], Awaitable[None]] | None = None

    async def aclose(self) -> None:
        if self._close is not None:
            close, self._close = self._close, None
            await close()


def resolve_backend(settings: Settings) -> str:
    """Validate the memory settings without connecting. Raises ChatMemoryConfigError."""
    backend = (settings.chat_memory_backend or "").strip().lower()
    if backend not in MEMORY_BACKENDS:
        raise ChatMemoryConfigError(
            f"CHAT_MEMORY_BACKEND must be one of {', '.join(MEMORY_BACKENDS)}")
    if backend == "postgres" and not settings.database_url_direct_ai.strip():
        raise ChatMemoryConfigError(
            "CHAT_MEMORY_BACKEND=postgres needs DATABASE_URL_DIRECT_AI (session pooler)")
    return backend


def memory_chat_memory() -> ChatMemory:
    from langgraph.checkpoint.memory import MemorySaver

    return ChatMemory("memory", MemorySaver(), InMemoryMetadataStore())


async def _configure_connection(conn: Any) -> None:
    await conn.execute(f"SET search_path TO {CHAT_SCHEMA}")


def postgres_pool(dsn: str) -> Any:
    """psycopg pool for the checkpointer and the metadata (not opened yet).

    autocommit + dict rows are what `AsyncPostgresSaver` expects; `prepare_threshold=None`
    disables server-side prepared statements (safe behind the Supabase poolers).
    """
    from psycopg.rows import dict_row
    from psycopg_pool import AsyncConnectionPool

    from app.chatbot.rag.store import clean_dsn

    return AsyncConnectionPool(
        clean_dsn(dsn),  # drops Prisma-only keys: schema, pgbouncer, connection_limit
        min_size=_POOL_MIN_SIZE,
        max_size=_POOL_MAX_SIZE,
        open=False,
        configure=_configure_connection,
        kwargs={"autocommit": True, "prepare_threshold": None, "row_factory": dict_row},
    )


async def open_postgres_memory(dsn: str) -> ChatMemory:
    """Open the pool, create schema `ai_chat`, run the checkpointer and metadata setup."""
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

    pool = postgres_pool(dsn)
    try:
        await pool.open(wait=True, timeout=_POOL_OPEN_TIMEOUT_SECONDS)
        async with pool.connection() as conn:
            await conn.execute(f"CREATE SCHEMA IF NOT EXISTS {CHAT_SCHEMA}")
        saver = AsyncPostgresSaver(pool)
        await saver.setup()  # idempotent migrations, tables in ai_chat (search_path)
        metadata = PostgresMetadataStore(pool)
        await metadata.setup()
    except BaseException:
        await pool.close()
        raise
    return ChatMemory("postgres", saver, metadata, pool.close)


async def open_chat_memory(settings: Settings) -> ChatMemory:
    """The backend selected by CHAT_MEMORY_BACKEND, ready to use."""
    backend = resolve_backend(settings)
    if backend == "postgres":
        return await open_postgres_memory(settings.database_url_direct_ai)
    return memory_chat_memory()

"""Chat memory backends (issue #219, part D).

Unit tests (always run, offline): backend selection and its errors, the in-memory
metadata store, TTL sweep rate limit, pool settings, startup failure, pool closing.

Integration tests: run only when `AI_TEST_DATABASE_URL` points at a DISPOSABLE Postgres
(same one as test_pgvector_store.py). They use the real LangGraph `AsyncPostgresSaver` in
schema `ai_chat`: two turns, history read back from a NEW ChatService and pool
(persistence), and TTL deletion of checkpoints and metadata. Each test deletes its own
sessions. Never point this at the shared Supabase database.
"""

import asyncio
import os
import uuid

import pytest

from app import main as app_main
from app.chatbot import memory as chat_memory
from app.chatbot.agent import ChatAgent
from app.chatbot.memory import (
    CHAT_SCHEMA,
    ChatMemory,
    ChatMemoryConfigError,
    InMemoryMetadataStore,
    MessageMeta,
    open_chat_memory,
    resolve_backend,
)
from app.chatbot.rag.embedder import FakeEmbedder
from app.chatbot.rag.hybrid_retriever import HybridRetriever
from app.chatbot.rag.indexer import Indexer
from app.chatbot.rag.store import InMemoryIndexStore
from app.chatbot.service import ChatService, abuild_chat_service, build_chat_service
from app.config import Settings
from test_chat_api import DATA_QUESTION, FakeChatModel, FakeClock, cite_first_and_ghost
from test_chatbot_retriever import TOURS, FakeTopics, payload

TEST_DB_URL = os.environ.get("AI_TEST_DATABASE_URL", "")
needs_db = pytest.mark.skipif(not TEST_DB_URL, reason="AI_TEST_DATABASE_URL not set (chat memory integration)")


def settings(**overrides) -> Settings:
    base = {"chat_memory_backend": "memory", "database_url_direct_ai": "", "database_url_ai": ""}
    base.update(overrides)
    return Settings(_env_file=None, **base)


# ---------- selection ----------

def test_default_backend_is_memory():
    assert Settings(_env_file=None).chat_memory_backend == "memory"
    assert resolve_backend(settings()) == "memory"
    assert resolve_backend(settings(chat_memory_backend=" Postgres ",
                                    database_url_direct_ai="postgresql://u@h/db")) == "postgres"


def test_postgres_without_direct_url_is_a_clear_error():
    with pytest.raises(ChatMemoryConfigError, match="DATABASE_URL_DIRECT_AI"):
        resolve_backend(settings(chat_memory_backend="postgres", database_url_direct_ai="  "))


def test_unknown_backend_is_refused():
    with pytest.raises(ChatMemoryConfigError, match="CHAT_MEMORY_BACKEND"):
        resolve_backend(settings(chat_memory_backend="redis"))


def test_abuild_never_falls_back_to_memory():
    with pytest.raises(ChatMemoryConfigError):
        asyncio.run(abuild_chat_service(settings(chat_memory_backend="postgres")))


def test_sync_build_refuses_postgres_backend():
    with pytest.raises(RuntimeError):
        build_chat_service(settings(chat_memory_backend="postgres",
                                    database_url_direct_ai="postgresql://u@h/db"))


def test_memory_backend_wires_memory_saver_and_store():
    from langgraph.checkpoint.memory import MemorySaver

    service = build_chat_service(settings())  # models are built lazily: no network
    assert isinstance(service.agent.checkpointer, MemorySaver)
    assert isinstance(service.metadata, InMemoryMetadataStore)
    assert service.memory is not None and service.memory.backend == "memory"


def test_startup_fails_on_postgres_without_url(monkeypatch):
    monkeypatch.setattr(app_main, "settings", settings(chatbot_enabled=True,
                                                      chat_memory_backend="postgres"))
    with pytest.raises(ChatMemoryConfigError):
        asyncio.run(app_main.open_chat_memory_at_startup())


def test_startup_builds_nothing_with_memory_backend(monkeypatch):
    async def must_not_build():
        raise AssertionError("the chat service is built lazily with the memory backend")

    monkeypatch.setattr(app_main.chat, "get_chat_service", must_not_build)
    monkeypatch.setattr(app_main, "settings", settings(chatbot_enabled=True))
    asyncio.run(app_main.open_chat_memory_at_startup())
    monkeypatch.setattr(app_main, "settings", settings(chatbot_enabled=False,
                                                      chat_memory_backend="postgres"))
    asyncio.run(app_main.open_chat_memory_at_startup())  # chat off: nothing checked


# ---------- postgres wiring without a database ----------

def test_pool_drops_prisma_keys_and_disables_prepared_statements():
    pool = chat_memory.postgres_pool(
        "postgresql://user:secret@db.example.com:5432/postgres?schema=ai&pgbouncer=true"
        "&connection_limit=1&sslmode=require")
    assert "schema=" not in pool.conninfo and "pgbouncer" not in pool.conninfo
    assert "connection_limit" not in pool.conninfo and "sslmode=require" in pool.conninfo
    assert pool.kwargs["autocommit"] is True and pool.kwargs["prepare_threshold"] is None
    assert pool.closed  # open=False: nothing connected


def test_connections_use_the_ai_chat_schema():
    executed = []

    class FakeConn:
        async def execute(self, sql, *args):
            executed.append(sql)

    asyncio.run(chat_memory._configure_connection(FakeConn()))
    assert executed == [f"SET search_path TO {CHAT_SCHEMA}"] and CHAT_SCHEMA == "ai_chat"


def test_open_failure_closes_the_pool(monkeypatch):
    closed = []

    class FailingPool:
        async def open(self, **kwargs):
            raise OSError("unreachable")

        async def close(self):
            closed.append(True)

    monkeypatch.setattr(chat_memory, "postgres_pool", lambda dsn: FailingPool())
    with pytest.raises(OSError):
        asyncio.run(chat_memory.open_postgres_memory("postgresql://u@h/db"))
    assert closed == [True]


# ---------- in-memory metadata store ----------

def test_in_memory_store_records_prunes_and_deletes():
    async def scenario():
        store = InMemoryMetadataStore()
        assert await store.last_active("s") is None and await store.messages("s") == {}
        await store.record("s", [MessageMeta("u1", "user", 10.0),
                                 MessageMeta("a1", "assistant", 11.0, [{"kind": "tour"}])], 11.0)
        await store.record("s", [MessageMeta("u2", "user", 20.0)], 20.0)
        assert await store.last_active("s") == 20.0
        assert set(await store.messages("s")) == {"u1", "a1", "u2"}
        await store.prune("s", {"u2"})
        assert set(await store.messages("s")) == {"u2"}
        await store.record("old", [], 5.0)
        assert await store.delete_idle(15.0) == ["old"]
        assert await store.delete("s") is True and await store.delete("s") is False

    asyncio.run(scenario())


# ---------- TTL with a fake agent ----------

class FakeAgent:
    def __init__(self):
        self.retriever = None
        self.deleted = []
        self.threads: dict[str, list[dict]] = {}

    async def run(self, session_id, message, location=None, language=None):
        n = len(self.threads.get(session_id, []))
        uid, aid = f"u{n}", f"a{n}"
        self.threads.setdefault(session_id, []).extend([
            {"id": uid, "role": "user", "content": message},
            {"id": aid, "role": "assistant", "content": "ok"}])
        return {"session_id": session_id, "user_message_id": uid, "answer_id": aid,
                "citations": [{"kind": "tour", "id": "t1", "title": "T"}]}

    async def history(self, session_id):
        return list(self.threads.get(session_id, []))

    async def delete_session(self, session_id):
        self.deleted.append(session_id)
        self.threads.pop(session_id, None)


def test_sweep_runs_at_most_once_per_interval():
    calls = []

    class CountingStore(InMemoryMetadataStore):
        async def delete_idle(self, before):
            calls.append(before)
            return await super().delete_idle(before)

    clock = FakeClock()
    service = ChatService(FakeAgent(), ttl_seconds=100, clock=clock, metadata=CountingStore(),
                          eviction_interval_seconds=60)

    async def scenario():
        await service.turn("a", "hi")
        clock.now += 30
        await service.turn("b", "hi")
        clock.now += 31
        await service.turn("b", "hi")

    asyncio.run(scenario())
    assert len(calls) == 2


def test_idle_session_is_deleted_on_its_own_request_between_sweeps():
    clock = FakeClock()
    agent = FakeAgent()
    service = ChatService(agent, ttl_seconds=100, clock=clock, eviction_interval_seconds=10_000)

    async def scenario():
        await service.turn("s", "hi")
        assert (await service.history("s"))[1]["citations"][0]["id"] == "t1"
        clock.now += 101  # no sweep yet (interval), but "s" is idle
        assert await service.history("s") is None
        assert agent.deleted == ["s"]
        await service.turn("s", "again")  # a new session from scratch
        assert [m["content"] for m in await service.history("s")] == ["again", "ok"]

    asyncio.run(scenario())


def test_sweep_deletes_checkpoints_and_metadata_of_idle_sessions():
    clock = FakeClock()
    agent = FakeAgent()
    service = ChatService(agent, ttl_seconds=100, clock=clock, eviction_interval_seconds=0)

    async def scenario():
        await service.turn("old", "hi")
        clock.now += 90
        await service.turn("new", "hi")
        clock.now += 20
        assert await service.evict_expired() == 1
        assert agent.deleted == ["old"] and await service.metadata.last_active("old") is None
        assert await service.history("new") is not None

    asyncio.run(scenario())


def test_sweep_failure_never_fails_the_request(caplog):
    class BrokenStore(InMemoryMetadataStore):
        async def delete_idle(self, before):
            raise ConnectionError("db down")

    service = ChatService(FakeAgent(), ttl_seconds=100, clock=FakeClock(), metadata=BrokenStore())
    result = asyncio.run(service.turn("s", "hi"))
    assert result["answer_id"] == "a0" and "ConnectionError" in caplog.text


def test_history_uses_last_activity_when_metadata_is_missing():
    clock = FakeClock()
    agent = FakeAgent()
    store = InMemoryMetadataStore()
    service = ChatService(agent, ttl_seconds=100, clock=clock, metadata=store)

    async def scenario():
        await service.turn("s", "hi")
        await store.prune("s", set())  # metadata lost, checkpoint kept
        return await service.history("s")

    out = asyncio.run(scenario())
    assert out[0]["at"].endswith("Z") and out[1]["citations"] == []


def test_aclose_closes_the_memory():
    closed = []

    async def close():
        closed.append(True)

    memory = ChatMemory("postgres", None, InMemoryMetadataStore(), close)
    service = ChatService(FakeAgent(), ttl_seconds=100, memory=memory)
    asyncio.run(service.aclose())
    asyncio.run(service.aclose())  # idempotent
    assert closed == [True]


# ---------- integration: real AsyncPostgresSaver in schema ai_chat ----------

def _retriever():
    store = InMemoryIndexStore(dimension=384)
    embedder = FakeEmbedder()
    indexer = Indexer(store, embedder, FakeTopics())
    for tid in TOURS:
        asyncio.run(indexer.handle_published(payload(tid)))
    return HybridRetriever(store, embedder)


def _service(memory, retriever, clock, ttl_seconds=3600.0):
    agent = ChatAgent(retriever, model=FakeChatModel(cite_first_and_ghost),
                      checkpointer=memory.checkpointer)
    return ChatService(agent, ttl_seconds=ttl_seconds, clock=clock, memory=memory)


def _pg_settings():
    return settings(chat_memory_backend="postgres", database_url_direct_ai=TEST_DB_URL)


async def _count(memory, sql, *params):
    async with memory.checkpointer.conn.connection() as conn:
        cur = await conn.execute(sql, params)
        row = await cur.fetchone()
    return list(row.values())[0]


async def _cleanup(sid):
    memory = await open_chat_memory(_pg_settings())
    try:
        await memory.metadata.delete(sid)
        await memory.checkpointer.adelete_thread(sid)
    finally:
        await memory.aclose()


@needs_db
def test_postgres_memory_tables_live_in_ai_chat():
    async def scenario():
        memory = await open_chat_memory(_pg_settings())
        try:
            again = await open_chat_memory(_pg_settings())  # setup is idempotent
            await again.aclose()
            async with memory.checkpointer.conn.connection() as conn:
                cur = await conn.execute(
                    "SELECT table_schema, table_name FROM information_schema.tables"
                    " WHERE table_name IN ('checkpoints', 'checkpoint_blobs', 'checkpoint_writes',"
                    " 'checkpoint_migrations', 'chat_sessions', 'chat_messages')")
                rows = await cur.fetchall()
        finally:
            await memory.aclose()
        return {(r["table_schema"], r["table_name"]) for r in rows}

    found = asyncio.run(scenario())
    assert {schema for schema, _ in found} == {"ai_chat"}
    assert {name for _, name in found} == {"checkpoints", "checkpoint_blobs", "checkpoint_writes",
                                           "checkpoint_migrations", "chat_sessions",
                                           "chat_messages"}


@needs_db
def test_postgres_history_survives_a_new_service_and_pool():
    sid = str(uuid.uuid4())
    retriever = _retriever()
    clock = FakeClock()

    async def first():
        memory = await open_chat_memory(_pg_settings())
        try:
            service = _service(memory, retriever, clock)
            r1 = await service.turn(sid, DATA_QUESTION)
            clock.now += 5
            r2 = await service.turn(sid, "Street food tour in Hanoi please")
            return r1, r2, await service.history(sid)
        finally:
            await memory.aclose()

    async def second():
        memory = await open_chat_memory(_pg_settings())  # new pool, new saver, new service
        try:
            return await _service(memory, retriever, clock).history(sid)
        finally:
            await memory.aclose()

    try:
        r1, r2, before = asyncio.run(first())
        after = asyncio.run(second())
    finally:
        asyncio.run(_cleanup(sid))

    assert before == after
    assert [m["role"] for m in after] == ["user", "assistant", "user", "assistant"]
    assert after[0]["content"] == DATA_QUESTION
    assert all(m["at"].endswith("Z") for m in after)
    assert after[0]["at"] != after[2]["at"]
    assert after[1]["citations"] == r1["citations"] and r1["citations"]
    assert after[3]["citations"] == r2["citations"]
    assert "citations" not in after[0]


@needs_db
def test_postgres_ttl_deletes_checkpoints_and_metadata():
    sid = str(uuid.uuid4())
    other = str(uuid.uuid4())
    retriever = _retriever()
    clock = FakeClock()

    async def scenario():
        memory = await open_chat_memory(_pg_settings())
        try:
            service = _service(memory, retriever, clock, ttl_seconds=3600)
            await service.turn(sid, DATA_QUESTION)
            clock.now += 3000
            await service.turn(other, DATA_QUESTION)
            clock.now += 601  # sid idle 3601 s, other 601 s

            # A new replica (its own service) sweeps: sid is deleted, other stays.
            replica = _service(memory, retriever, clock, ttl_seconds=3600)
            deleted = await replica.evict_expired(force=True)
            checkpoints = await _count(
                memory, f"SELECT count(*) FROM {CHAT_SCHEMA}.checkpoints WHERE thread_id = %s", sid)
            metas = await _count(
                memory, f"SELECT count(*) FROM {CHAT_SCHEMA}.chat_messages WHERE session_id = %s",
                sid)
            return (deleted, checkpoints, metas, await replica.history(sid),
                    await replica.history(other))
        finally:
            await memory.aclose()

    try:
        deleted, checkpoints, metas, gone, kept = asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(sid))
        asyncio.run(_cleanup(other))

    assert deleted >= 1  # other idle rows of the disposable DB may be swept too
    assert checkpoints == 0 and metas == 0 and gone is None
    assert kept is not None and [m["role"] for m in kept] == ["user", "assistant"]

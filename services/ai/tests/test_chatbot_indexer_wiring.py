"""Offline tests of the chatbot indexer transport and the chat retriever wiring (#219).

No RabbitMQ, no Postgres, no model: aio-pika-like fakes record ack / nack / reject,
and PgVectorIndexStore is only constructed (its pool opens lazily, never here).
"""

import asyncio
import json
import logging

import pytest

from app.chatbot.rag import consumer
from app.chatbot.rag.consumer import (
    ACKED,
    REJECTED,
    REQUEUED,
    RETRIED,
    RETRY_HEADER,
    IndexEventDispatcher,
    handle_message,
    start_indexer,
)
from app.chatbot.rag.embedder import FakeEmbedder
from app.chatbot.rag.indexer import Indexer
from app.chatbot.rag.retriever import NullRetriever
from app.chatbot.rag.store import InMemoryIndexStore, PgVectorIndexStore
from app.config import Settings

SECRET_DSN = "postgresql://user:very-secret-pw@db.example.com:6543/postgres?schema=ai"
R1 = "2026-10-01T00:00:00Z"


def run(coro):
    return asyncio.run(coro)


def tour(**over):
    payload = {
        "tourId": "t1",
        "revision": R1,
        "status": "public",
        "title": "Saigon food walk",
        "description": "Street food around Ben Thanh market.",
        "language": "en",
        "city": "Ho Chi Minh",
        "type": "walking",
        "durationMinutes": 90,
        "places": [
            {"placeId": "p1", "name": "Ben Thanh Market", "type": "market",
             "description": "Historic market.", "lat": 10.772, "lng": 106.698, "sequence": 1},
        ],
        "at": R1,
    }
    payload.update(over)
    return payload


class FakeMessage:
    def __init__(self, routing_key, body, headers=None):
        self.routing_key = routing_key
        self.body = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        self.headers = headers or {}
        self.content_type = "application/json"
        self.redelivered = False
        self.settled = []

    async def ack(self):
        self.settled.append("ack")

    async def nack(self, requeue=True):
        self.settled.append(("nack", requeue))

    async def reject(self, requeue=False):
        self.settled.append(("reject", requeue))


class Resender:
    def __init__(self, fail=False):
        self.sent = []
        self.fail = fail

    async def __call__(self, message, count):
        if self.fail:
            raise ConnectionError("broker down")
        self.sent.append(FakeMessage(message.routing_key, message.body,
                                     {**message.headers, RETRY_HEADER: count}))


class BrokenStore(InMemoryIndexStore):
    async def get_revision(self, tour_id):
        raise ConnectionError("db down")


def dispatcher(store=None):
    store = store or InMemoryIndexStore(dimension=384)
    return IndexEventDispatcher(Indexer(store, FakeEmbedder())), store


def handle(d, msg, resend, max_retries=1):
    return run(handle_message(d, msg, resend=resend, max_retries=max_retries))


# --- message handling ---


def test_published_is_indexed_and_acked():
    d, store = dispatcher()
    msg = FakeMessage("tour.published", tour())
    assert handle(d, msg, Resender()) == ACKED
    assert msg.settled == ["ack"]
    assert store.nodes


def test_duplicate_and_stale_are_acked():
    d, _ = dispatcher()
    handle(d, FakeMessage("tour.published", tour(revision="2026-10-02T00:00:00Z")), Resender())
    dup = FakeMessage("tour.published", tour(revision="2026-10-02T00:00:00Z"))
    stale = FakeMessage("tour.published", tour(revision=R1))
    assert handle(d, dup, Resender()) == ACKED and dup.settled == ["ack"]
    assert handle(d, stale, Resender()) == ACKED and stale.settled == ["ack"]


def test_unpublished_and_hidden_remove_the_tour():
    d, store = dispatcher()
    handle(d, FakeMessage("tour.published", tour()), Resender())
    hidden = FakeMessage("tour.hidden", {"tourId": "t1"})
    assert handle(d, hidden, Resender()) == ACKED
    assert not store.nodes


def test_error_is_retried_once_then_rejected(caplog):
    d, _ = dispatcher(BrokenStore(dimension=384))
    resend = Resender()
    first = FakeMessage("tour.published", tour())
    assert handle(d, first, resend, max_retries=1) == RETRIED
    assert first.settled == ["ack"] and len(resend.sent) == 1
    retry = resend.sent[0]
    assert retry.headers[RETRY_HEADER] == 1
    with caplog.at_level(logging.ERROR):
        assert handle(d, retry, resend, max_retries=1) == REJECTED
    assert retry.settled == [("reject", False)] and len(resend.sent) == 1
    assert "Saigon" not in caplog.text


def test_error_with_failed_resend_falls_back_to_requeue():
    d, _ = dispatcher(BrokenStore(dimension=384))
    msg = FakeMessage("tour.published", tour())
    assert handle(d, msg, Resender(fail=True), max_retries=3) == REQUEUED
    assert msg.settled == [("nack", True)]


def test_invalid_json_and_payload_are_rejected_without_requeue():
    d, _ = dispatcher()
    bad_json = FakeMessage("tour.published", b"{not json")
    bad_payload = FakeMessage("tour.unpublished", {"reason": "deleted"})
    assert handle(d, bad_json, Resender()) == REJECTED
    assert handle(d, bad_payload, Resender()) == REJECTED
    assert bad_json.settled == [("reject", False)] and bad_payload.settled == [("reject", False)]


def test_unknown_routing_key_is_acked():
    d, _ = dispatcher()
    msg = FakeMessage("tour.submitted", tour())
    assert handle(d, msg, Resender()) == ACKED


# --- start_indexer ---


def settings(**over):
    values = {"chatbot_indexer_enabled": True, "database_url_ai": SECRET_DSN,
              "embedding_provider": "fake", "chatbot_indexer_retry_delay_seconds": 0}
    values.update(over)
    return Settings(_env_file=None, **values)


async def must_not_connect(url):
    raise AssertionError("must not connect")


def test_flag_off_starts_nothing():
    s = settings(chatbot_indexer_enabled=False)
    assert run(start_indexer(s, connect=must_not_connect)) is None


def test_missing_database_url_does_not_start(caplog):
    with caplog.at_level(logging.INFO, logger="app.chatbot.rag.consumer"):
        assert run(start_indexer(settings(database_url_ai=""), connect=must_not_connect)) is None
    lines = [r for r in caplog.records if r.name == "app.chatbot.rag.consumer"]
    assert len(lines) == 1 and "DATABASE_URL_AI" in lines[0].getMessage()


def test_unavailable_embedder_does_not_start_and_hides_the_dsn(caplog):
    with caplog.at_level(logging.INFO, logger="app.chatbot.rag.consumer"):
        assert run(start_indexer(settings(embedding_provider="nope"),
                                 connect=must_not_connect)) is None
    lines = [r for r in caplog.records if r.name == "app.chatbot.rag.consumer"]
    assert len(lines) == 1
    assert "very-secret-pw" not in caplog.text and "db.example.com" not in caplog.text


class FakeQueue:
    def __init__(self):
        self.bindings = []
        self.callback = None
        self.cancelled = False

    async def bind(self, exchange, routing_key):
        self.bindings.append((exchange, routing_key))

    async def consume(self, callback):
        self.callback = callback
        return "tag-1"

    async def cancel(self, tag):
        self.cancelled = tag == "tag-1"


class FakeChannel:
    def __init__(self):
        self.queue = FakeQueue()
        self.prefetch = None
        self.exchange = None
        self.queue_args = None

    async def set_qos(self, prefetch_count):
        self.prefetch = prefetch_count

    async def declare_exchange(self, name, kind, durable):
        self.exchange = (name, kind, durable)
        return name

    async def declare_queue(self, name, durable):
        self.queue_args = (name, durable)
        return self.queue


class FakeConnection:
    def __init__(self):
        self.chan = FakeChannel()
        self.closed = False
        self.url = None

    async def channel(self):
        return self.chan

    async def close(self):
        self.closed = True


def test_start_declares_topology_consumes_and_closes(monkeypatch):
    import aio_pika

    conn = FakeConnection()

    async def connect(url):
        conn.url = url
        return conn

    closed = []

    async def fake_aclose(self):
        closed.append(True)

    monkeypatch.setattr(PgVectorIndexStore, "aclose", fake_aclose)
    handle_ = run(start_indexer(settings(), connect=connect))
    assert handle_ is not None
    ch = conn.chan
    assert ch.prefetch == 1
    assert ch.exchange == ("geosound.events", aio_pika.ExchangeType.TOPIC, True)
    assert ch.queue_args == ("ai.chatbot-indexer", True)
    assert {k for _, k in ch.queue.bindings} == {"tour.published", "tour.unpublished", "tour.hidden"}
    assert isinstance(handle_.store, PgVectorIndexStore) and handle_.store._pool is None
    run(handle_.aclose())
    assert ch.queue.cancelled and conn.closed and closed == [True]


def test_connection_failure_does_not_start_and_hides_the_url(monkeypatch, caplog):
    async def connect(url):
        raise ConnectionError(url)  # the URL must not leak through the log

    monkeypatch.setattr(PgVectorIndexStore, "aclose", lambda self: asyncio.sleep(0))
    with caplog.at_level(logging.ERROR):
        assert run(start_indexer(settings(rabbitmq_url="amqp://u:amqp-secret@mq:5672"),
                                 connect=connect)) is None
    assert "amqp-secret" not in caplog.text


# --- chat retriever wiring ---


def test_build_retriever_uses_pgvector_without_connecting():
    from app.chatbot.rag.hybrid_retriever import HybridRetriever
    from app.chatbot.service import build_retriever

    retriever = build_retriever(settings())
    assert isinstance(retriever, HybridRetriever)
    assert isinstance(retriever.store, PgVectorIndexStore)
    assert retriever.store._pool is None


def test_build_retriever_without_database_url_is_null():
    from app.chatbot.service import build_retriever

    assert isinstance(build_retriever(settings(database_url_ai="")), NullRetriever)


def test_city_aliases_fall_back_when_the_index_is_down():
    from app.chatbot.service import load_city_aliases

    class Down:
        async def city_aliases_from_index(self):
            raise ConnectionError("db down")

    assert run(load_city_aliases(Down())) is None
    assert run(load_city_aliases(NullRetriever())) is None


def test_chat_service_aclose_closes_the_store_pool(monkeypatch):
    from app.chatbot.service import build_chat_service

    closed = []

    async def fake_aclose(self):
        closed.append(True)

    monkeypatch.setattr(PgVectorIndexStore, "aclose", fake_aclose)
    service = build_chat_service(settings())
    run(service.aclose())
    assert closed == [True]


# --- lifespan ---


def test_lifespan_starts_and_closes_handles(monkeypatch):
    from fastapi.testclient import TestClient

    from app import main
    from app.api import chat as chat_api

    events = []

    class Handle:
        async def aclose(self):
            events.append("indexer closed")

    async def fake_start(s):
        events.append("indexer started")
        return Handle()

    class Service:
        async def aclose(self):
            events.append("chat closed")

    monkeypatch.setattr(main.settings, "chatbot_indexer_enabled", True)
    monkeypatch.setattr(consumer, "start_indexer", fake_start)
    monkeypatch.setattr(chat_api, "_service", Service())
    with TestClient(main.app):
        assert events == ["indexer started"]
    assert events == ["indexer started", "indexer closed", "chat closed"]
    assert chat_api._service is None


def test_lifespan_flag_off_builds_nothing(monkeypatch):
    from fastapi.testclient import TestClient

    from app import main
    from app.api import chat as chat_api

    async def boom(s):
        raise AssertionError("must not start")

    monkeypatch.setattr(main.settings, "chatbot_indexer_enabled", False)
    monkeypatch.setattr(consumer, "start_indexer", boom)
    monkeypatch.setattr(chat_api, "_service", None)
    with TestClient(main.app):
        pass
    assert chat_api._service is None

"""POST /chat (SSE) and GET /chat/history (task #AI-47, issue #188).

Real ChatAgent and HybridRetriever over an in-memory index (Indexer +
FakeEmbedder); a fake chat model and a fake clock. No real LLM, no network.
"""

import asyncio
import json
import re
import uuid

import pytest

pytest.importorskip("langgraph")

from fastapi.testclient import TestClient  # noqa: E402
from langchain_core.messages import AIMessage  # noqa: E402
from langgraph.checkpoint.memory import MemorySaver  # noqa: E402

from app.api import chat as chat_api  # noqa: E402
from app.chatbot import models as chat_models  # noqa: E402
from app.chatbot import tracing as chat_tracing  # noqa: E402
from app.chatbot.agent import ChatAgent  # noqa: E402
from app.chatbot.limits import SlidingWindowLimiter  # noqa: E402
from app.chatbot.rag.embedder import FakeEmbedder  # noqa: E402
from app.chatbot.rag.hybrid_retriever import HybridRetriever  # noqa: E402
from app.chatbot.rag.indexer import Indexer  # noqa: E402
from app.chatbot.rag.store import InMemoryIndexStore  # noqa: E402
from app.chatbot.service import ChatService, GuardedChatModel  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.llm.errors import LLMServerError  # noqa: E402
from app.main import app  # noqa: E402
from conftest import AUTH_HEADERS  # noqa: E402
from test_chatbot_retriever import TOURS, FakeTopics, payload  # noqa: E402

INDEXED_IDS = set(TOURS) | {p["placeId"] for t in TOURS.values() for p in t["places"]}
DATA_QUESTION = "Find a street food tour in Hanoi"
ITEM_ID = re.compile(r"^id: (\S+)$", re.M)


class FakeClock:
    def __init__(self, now=1_790_000_000.0):
        self.now = now

    def __call__(self):
        return self.now


class FakeChatModel:
    def __init__(self, responder):
        self.responder = responder
        self.calls = []

    async def ainvoke(self, messages, *args, **kwargs):
        self.calls.append(list(messages))
        result = self.responder(messages, len(self.calls))
        if isinstance(result, Exception):
            raise result
        return AIMessage(content=result)


def cite_first_and_ghost(messages, n):
    """Cites the first retrieved id plus an invented one."""
    ids = ITEM_ID.findall(messages[-1].content)
    return f"Try [tour:{ids[0]}] and also [tour:ghost-{n}] today." if ids else "Hello!"


@pytest.fixture(autouse=True)
def no_real_model_factory(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("build_chat_model must not be called in tests")

    monkeypatch.setattr(chat_models, "build_chat_model", boom)


@pytest.fixture
def enabled(internal_token, monkeypatch):
    monkeypatch.setenv("CHATBOT_ENABLED", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def make_chat(enabled):
    """Returns (client, service, model, clock) over a fresh in-memory index."""

    def _make(responder=cite_first_and_ghost, cap=10, ttl_seconds=3600.0, overflow=None):
        store = InMemoryIndexStore(dimension=384)
        embedder = FakeEmbedder()
        indexer = Indexer(store, embedder, FakeTopics())
        for tid in TOURS:
            asyncio.run(indexer.handle_published(payload(tid)))
        clock = FakeClock()
        model = FakeChatModel(responder)
        guarded = GuardedChatModel(lambda: model, SlidingWindowLimiter(cap, clock=clock),
                                   overflow_factory=(lambda: overflow) if overflow else None)
        agent = ChatAgent(HybridRetriever(store, embedder), model=guarded, checkpointer=MemorySaver())
        service = ChatService(agent, ttl_seconds=ttl_seconds, clock=clock)
        app.dependency_overrides[chat_api.get_chat_service] = lambda: service
        return TestClient(app, headers=AUTH_HEADERS), service, model, clock

    yield _make
    app.dependency_overrides.clear()


def events(response):
    out = []
    for block in response.text.split("\n\n"):
        if not block.strip():
            continue
        lines = dict(line.split(": ", 1) for line in block.split("\n"))
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def post(client, message, **body):
    return client.post("/chat", json={"message": message, **body})


# ---------- flag, auth, validation ----------

def test_disabled_returns_404_and_builds_nothing(internal_token, monkeypatch):
    monkeypatch.setenv("CHATBOT_ENABLED", "false")
    get_settings.cache_clear()

    def must_not_build():
        raise AssertionError("chat service built while disabled")

    app.dependency_overrides[chat_api.get_chat_service] = must_not_build
    try:
        client = TestClient(app, headers=AUTH_HEADERS)
        assert post(client, "hello").status_code == 404
        assert client.get("/chat/history", params={"session_id": str(uuid.uuid4())}).status_code == 404
        assert TestClient(app).post("/chat", json={"message": "hi"}).status_code == 404  # no token
    finally:
        app.dependency_overrides.clear()
        get_settings.cache_clear()


def test_disabled_by_default():
    assert get_settings().chatbot_enabled is False
    assert get_settings().chat_global_rate_limit_per_min == 2
    assert get_settings().chat_session_ttl_hours == 24


def test_bad_or_missing_token_is_401(make_chat):
    make_chat()
    assert TestClient(app).post("/chat", json={"message": "hi"}).status_code == 401
    bad = TestClient(app, headers={"x-internal-token": "wrong"})
    assert bad.post("/chat", json={"message": "hi"}).status_code == 401
    assert bad.get("/chat/history", params={"session_id": str(uuid.uuid4())}).status_code == 401


@pytest.mark.parametrize("body", [
    {"message": ""},
    {"message": "   "},
    {"message": "x" * 1001},
    {"message": "hi", "language": "fr"},
    {"message": "hi", "session_id": "not-a-uuid"},
    {"message": "hi", "location": {"lat": 91, "lng": 0}},
    {},
])
def test_invalid_input_is_422(make_chat, body):
    client, _, model, _ = make_chat()
    assert client.post("/chat", json=body).status_code == 422
    assert model.calls == []


def test_history_bad_session_id_is_422(make_chat):
    client, *_ = make_chat()
    assert client.get("/chat/history", params={"session_id": "abc"}).status_code == 422


# ---------- SSE ----------

def test_data_question_streams_meta_tokens_citations_done(make_chat):
    client, _, model, _ = make_chat()
    response = post(client, DATA_QUESTION, language="en")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    evs = events(response)
    names = [e for e, _ in evs]
    assert names[0] == "meta" and names[-2:] == ["citations", "done"]
    assert set(names[1:-2]) == {"token"} and len(names) > 4
    meta = evs[0][1]
    uuid.UUID(meta["session_id"])
    assert meta["lang"] == "en"

    tokens = [d["text"] for e, d in evs if e == "token"]
    text = "".join(tokens)
    assert all("ghost" not in t for t in tokens)
    markers = re.findall(r"\[(tour|place):([^\]]+)\]", text)
    assert markers and {m[1] for m in markers} <= INDEXED_IDS
    # A marker is never split across two token events.
    assert any(re.search(r"\[tour:[^\]]+\]", t) for t in tokens)

    items = evs[-2][1]["items"]
    assert items and {i["id"] for i in items} <= INDEXED_IDS
    assert {i["id"] for i in items} == {m[1] for m in markers}
    assert evs[-1][1] == {"finish_reason": "stop", "llm_calls": 1}
    assert len(model.calls) == 1


def test_out_of_scope_is_refused_without_llm(make_chat):
    client, _, model, _ = make_chat()
    evs = events(post(client, "What's the weather in Hanoi tomorrow?"))
    assert evs[-1] == ("done", {"finish_reason": "refused", "llm_calls": 0})
    assert evs[-2] == ("citations", {"items": []})
    assert model.calls == []


def test_session_continuity_and_history(make_chat):
    client, _, model, clock = make_chat()
    first = events(post(client, DATA_QUESTION, language="en"))
    sid = first[0][1]["session_id"]
    clock.now += 5
    second = events(post(client, "Any street food tour in Hanoi for the evening?",
                         session_id=sid, language="en"))
    assert second[0][1]["session_id"] == sid
    # The second prompt carried the first turn as memory.
    assert len(model.calls[1]) == len(model.calls[0]) + 2

    response = client.get("/chat/history", params={"session_id": sid})
    assert response.status_code == 200
    body = response.json()
    assert body["session_id"] == sid
    msgs = body["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant"]
    assert msgs[0]["content"] == DATA_QUESTION
    assert all(m["at"].endswith("Z") for m in msgs)
    assert msgs[0]["at"] < msgs[2]["at"]
    assert "citations" not in msgs[0]
    assert msgs[1]["citations"] == first[-2][1]["items"]
    assert "ghost" not in msgs[1]["content"]


def test_unknown_session_history_is_404(make_chat):
    client, *_ = make_chat()
    assert client.get("/chat/history", params={"session_id": str(uuid.uuid4())}).status_code == 404


# ---------- caps and errors ----------

def test_global_cap_returns_429_with_retry_after(make_chat):
    client, service, model, clock = make_chat(cap=1)
    sid = str(uuid.uuid4())
    assert post(client, DATA_QUESTION, session_id=sid).status_code == 200
    # Out-of-scope turns use no LLM, so they do not count.
    assert post(client, "What's the weather in Hanoi tomorrow?", session_id=sid).status_code == 200
    clock.now += 20
    response = post(client, DATA_QUESTION, session_id=sid)
    assert response.status_code == 429
    assert response.headers["retry-after"] == "40"
    assert response.json() == {"detail": chat_api.BUSY_DETAIL}
    assert len(model.calls) == 1
    # The refused question is not left in memory.
    history = asyncio.run(service.agent.history(sid))
    assert [m["role"] for m in history] == ["user", "assistant", "user", "assistant"]
    clock.now += 41
    assert post(client, DATA_QUESTION, session_id=sid).status_code == 200


def test_cap_reached_runs_on_groq_overflow_outside_cap_and_slot(make_chat):
    overflow = FakeChatModel(cite_first_and_ghost)
    client, service, primary, _ = make_chat(cap=1, overflow=overflow)
    guarded = service.agent._model
    sid = str(uuid.uuid4())
    assert post(client, DATA_QUESTION, session_id=sid).status_code == 200
    assert len(primary.calls) == 1 and overflow.calls == []

    slot_taken = []

    class FreeSlot:
        def locked(self):
            return False

        async def __aenter__(self):
            slot_taken.append(True)

        async def __aexit__(self, *exc):
            return False

    guarded._semaphore = lambda: FreeSlot()
    for _ in range(2):
        evs = events(post(client, DATA_QUESTION, session_id=sid))
        assert evs[-1] == ("done", {"finish_reason": "stop", "llm_calls": 1})
    assert len(primary.calls) == 1  # Gemini not called over the cap
    assert len(overflow.calls) == 2
    assert slot_taken == []  # the overflow never takes the moderation slot
    assert len(guarded.limiter._hits) == 1  # overflow turns do not count


def test_cap_without_groq_overflow_is_429(make_chat):
    client, _, primary, _ = make_chat(cap=1)
    assert post(client, DATA_QUESTION).status_code == 200
    response = post(client, DATA_QUESTION)
    assert response.status_code == 429 and "retry-after" in response.headers
    assert len(primary.calls) == 1


@pytest.mark.parametrize("groq_key, has_overflow", [("", False), ("fake-groq-key", True)])
def test_overflow_is_wired_only_with_a_groq_key(monkeypatch, groq_key, has_overflow):
    from app.chatbot.service import build_chat_service

    monkeypatch.setenv("GROQ_API_KEY", groq_key)
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)
    get_settings.cache_clear()
    chat_tracing.chat_callbacks.cache_clear()
    try:
        service = build_chat_service(get_settings())  # models are built lazily: no network
        assert (service.agent._model._overflow_factory is not None) is has_overflow
    finally:
        get_settings.cache_clear()
        chat_tracing.chat_callbacks.cache_clear()


def test_full_ai_slot_returns_429(make_chat):
    client, service, model, _ = make_chat()

    class Busy:
        def locked(self):
            return True

    service.agent._model._semaphore = lambda: Busy()
    response = post(client, DATA_QUESTION)
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) >= 1
    assert model.calls == []


def test_provider_error_is_503_without_dangling_user_message(make_chat, caplog):
    secret = "user text that must not be logged"
    responder = lambda m, n: (cite_first_and_ghost(m, n) if n == 1
                              else LLMServerError(secret, provider="fake", status_code=503))
    client, service, _, _ = make_chat(responder)
    sid = str(uuid.uuid4())
    assert post(client, DATA_QUESTION, session_id=sid).status_code == 200

    response = post(client, "Street food tour in Hanoi please", session_id=sid)
    assert response.status_code == 503
    assert response.json() == {"detail": chat_api.UNAVAILABLE_DETAIL}
    assert secret not in caplog.text and "LLMServerError" in caplog.text

    stored = asyncio.run(service.agent.history(sid))
    assert [m["content"] for m in stored if m["role"] == "user"] == [DATA_QUESTION]
    msgs = client.get("/chat/history", params={"session_id": sid}).json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"]


def test_provider_error_on_first_turn_leaves_no_session(make_chat):
    client, service, _, _ = make_chat(lambda m, n: LLMServerError("down", provider="fake",
                                                                  status_code=503))
    sid = str(uuid.uuid4())
    assert post(client, DATA_QUESTION, session_id=sid).status_code == 503
    assert asyncio.run(service.agent.history(sid)) == []
    assert client.get("/chat/history", params={"session_id": sid}).status_code == 404


# ---------- TTL ----------

def test_idle_session_is_evicted_after_ttl(make_chat):
    client, service, _, clock = make_chat(ttl_seconds=3600)
    sid = str(uuid.uuid4())
    other = str(uuid.uuid4())
    assert post(client, DATA_QUESTION, session_id=sid).status_code == 200
    clock.now += 3000
    assert post(client, DATA_QUESTION, session_id=other).status_code == 200
    clock.now += 601  # sid idle 3601 s, other 601 s
    assert client.get("/chat/history", params={"session_id": sid}).status_code == 404
    assert asyncio.run(service.agent.history(sid)) == []
    assert client.get("/chat/history", params={"session_id": other}).status_code == 200


# ---------- tracing ----------

def test_chat_tracing_off_adds_no_callbacks(monkeypatch):
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)
    get_settings.cache_clear()
    chat_tracing.chat_callbacks.cache_clear()
    try:
        assert chat_tracing.chat_callbacks() == ()
    finally:
        chat_tracing.chat_callbacks.cache_clear()
        get_settings.cache_clear()


def test_chat_tracer_hides_inputs_and_outputs(monkeypatch):
    import langsmith
    from langchain_core.tracers import LangChainTracer

    created = []

    class FakeClient:
        def __init__(self, **kwargs):
            created.append(kwargs)

    monkeypatch.setattr(langsmith, "Client", FakeClient)
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.setenv("LANGSMITH_API_KEY", "fake-key-for-tests")
    get_settings.cache_clear()
    chat_tracing.chat_callbacks.cache_clear()
    try:
        callbacks = chat_tracing.chat_callbacks()
    finally:
        chat_tracing.chat_callbacks.cache_clear()
        get_settings.cache_clear()

    assert len(callbacks) == 1 and isinstance(callbacks[0], LangChainTracer)
    assert created[0]["hide_inputs"] is chat_tracing.redact
    assert created[0]["hide_outputs"] is chat_tracing.redact

    tool_input = {"input": "{'lat': 21.0340, 'lng': 105.8500, 'radius_m': 500}", "lat": 21.034}
    state = {"messages": ["Where is pho near me?"], "intent": "nearby", "lang": "en",
             "llm_calls": 1, "tools_called": ["nearby_places"]}
    assert "21.03" not in json.dumps(chat_tracing.redact(tool_input))
    hidden = chat_tracing.redact(state)
    assert "pho" not in json.dumps(hidden)
    assert hidden["intent"] == "nearby" and hidden["tools_called"] == ["nearby_places"]
    assert chat_tracing.redact("raw text") == {"hidden": 1}

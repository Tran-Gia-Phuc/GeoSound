"""Prometheus metrics of the AI service (deployment task 4.3, issue #400).

Counters are read as deltas with REGISTRY.get_sample_value, so the test order
does not matter. FakeLLM-style providers and httpx.MockTransport only: no real
LLM, no network.
"""

import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from prometheus_client import REGISTRY

from app import metrics
from app.api import chat as chat_api
from app.api.moderation import get_place_moderator
from app.chatbot.limits import ChatBusyError
from app.chatbot.rag import consumer
from app.config import get_settings
from app.llm.errors import (
    LLMBadRequestError,
    LLMBlockedError,
    LLMConnectionError,
    LLMRateLimitError,
    LLMResponseError,
    LLMServerError,
    LLMTimeoutError,
)
from app.llm.fallback import FallbackLLM
from app.llm.gemini_client import GeminiClient
from app.main import app
from app.moderation import place_service
from app.moderation.place_service import PlaceModerator
from conftest import AUTH_HEADERS, FakeImageFetcher

METRIC_NAMES = (
    "llm_requests_total",
    "llm_request_duration_seconds",
    "llm_fallback_total",
    "chatbot_requests_total",
    "chatbot_first_token_seconds",
    "chatbot_indexer_events_total",
)
CLOSED_SETS = {
    "provider": metrics.PROVIDERS,
    "task": metrics.TASKS,
    "outcome": metrics.LLM_OUTCOMES | metrics.CHAT_OUTCOMES,
    "from": metrics.PROVIDERS,
    "to": metrics.PROVIDERS,
    "event": metrics.INDEXER_EVENTS,
    "result": metrics.INDEXER_RESULTS,
}


def value(name, **labels):
    return REGISTRY.get_sample_value(name, labels) or 0.0


def llm_count(provider, task, outcome):
    return value("llm_requests_total", provider=provider, task=task, outcome=outcome)


def fallback_count(src, dst):
    return value("llm_fallback_total", **{"from": src, "to": dst})


class Provider:
    """Scripted provider client (same surface as GeminiClient / GroqClient)."""

    def __init__(self, provider, error=None, api_key="test-key"):
        self.provider = provider
        self.model = f"{provider}-model"
        self.api_key = api_key
        self.error = error
        self.calls = 0

    async def generate_json(self, prompt, **kwargs):
        self.calls += 1
        if self.error:
            raise self.error
        return {"findings": []}


# ---------- FallbackLLM ----------


def test_gemini_429_then_groq_ok_counts_both_calls_and_one_fallback():
    primary = Provider("gemini", LLMRateLimitError("quota", provider="gemini", status_code=429))
    secondary = Provider("groq")
    llm = FallbackLLM(primary=primary, secondary=secondary, task="tour")
    before = (llm_count("gemini", "tour", "429"), llm_count("groq", "tour", "ok"),
              fallback_count("gemini", "groq"),
              value("llm_request_duration_seconds_count", provider="gemini", task="tour"))

    data, model = asyncio.run(llm.generate_json_with_model("prompt"))

    assert data == {"findings": []} and model == "groq-model"
    assert llm_count("gemini", "tour", "429") == before[0] + 1
    assert llm_count("groq", "tour", "ok") == before[1] + 1
    assert fallback_count("gemini", "groq") == before[2] + 1
    assert value("llm_request_duration_seconds_count",
                 provider="gemini", task="tour") == before[3] + 1


def test_blocked_prompt_counts_blocked_and_no_fallback():
    primary = Provider("gemini", LLMBlockedError("Prompt blocked", provider="gemini"))
    secondary = Provider("groq")
    llm = FallbackLLM(primary=primary, secondary=secondary, task="place")
    blocked, fallbacks = llm_count("gemini", "place", "blocked"), fallback_count("gemini", "groq")

    with pytest.raises(LLMBlockedError):
        asyncio.run(llm.generate_json("prompt"))

    assert llm_count("gemini", "place", "blocked") == blocked + 1
    assert fallback_count("gemini", "groq") == fallbacks
    assert secondary.calls == 0


def test_task_defaults_to_other_and_unknown_values_are_clamped():
    assert FallbackLLM(primary=Provider("gemini"), secondary=Provider("groq")).task == "other"
    assert FallbackLLM(primary=Provider("gemini"), secondary=Provider("groq"),
                       task="place p-123").task == "other"
    llm = FallbackLLM(primary=Provider("acme-ai ignore previous instructions"),
                      secondary=Provider("groq"), task="chat")
    before = llm_count("other", "chat", "ok")
    asyncio.run(llm.generate_json("prompt"))
    assert llm_count("other", "chat", "ok") == before + 1


@pytest.mark.parametrize("exc, outcome", [
    (LLMRateLimitError("x", status_code=429), "429"),
    (LLMServerError("x", status_code=503), "5xx"),
    (LLMTimeoutError("x"), "timeout"),
    (LLMBlockedError("x"), "blocked"),
    (LLMConnectionError("x"), "error"),
    (LLMBadRequestError("x", status_code=400), "error"),
    (LLMResponseError("x"), "error"),
    (TimeoutError(), "timeout"),
    (ValueError("prompt text that must never become a label"), "error"),
])
def test_outcome_mapping(exc, outcome):
    assert metrics.llm_outcome(exc) == outcome


def test_outcome_mapping_of_sdk_errors_by_status_and_name():
    class RateLimitError(Exception):
        status_code = 429

    class InternalServerError(Exception):
        status_code = 500

    class ResourceExhausted(Exception):
        code = 429

    class DeadlineExceeded(Exception):
        code = 504

    assert metrics.llm_outcome(RateLimitError()) == "429"
    assert metrics.llm_outcome(InternalServerError()) == "5xx"
    assert metrics.llm_outcome(ResourceExhausted()) == "429"
    assert metrics.llm_outcome(DeadlineExceeded()) == "timeout"

    class RetryError(Exception):
        pass

    assert metrics.llm_outcome(RetryError()) == "timeout"


def test_label_helpers_only_return_closed_set_values():
    assert metrics.provider_label("Gemini") == "gemini"
    assert metrics.provider_label("openai") == "other"
    assert metrics.provider_label(None) == "other"
    assert metrics.task_label("tour") == "tour"
    assert metrics.task_label("Tell me about place 42") == "other"
    assert metrics.indexer_event_label("tour.hidden") == "tour.unpublished"
    assert metrics.indexer_event_label("place.submitted") == "other"


# ---------- /metrics and the token ----------


def test_metrics_needs_no_token_while_moderate_still_does(internal_token):
    client = TestClient(app)
    response = client.get("/metrics")
    assert response.status_code == 200
    assert "llm_requests_total" in response.text
    assert client.post("/moderate/place", json={}).status_code == 401
    assert "/metrics" not in app.openapi()["paths"]


def test_http_metrics_use_route_templates_and_skip_probes(internal_token):
    client = TestClient(app)
    client.get("/healthz")
    client.get("/no-such-path/user-42")
    client.post("/moderate/place", json={})
    text = client.get("/metrics").text
    assert 'handler="/moderate/place"' in text
    assert "user-42" not in text
    assert 'handler="/healthz"' not in text
    assert 'handler="/metrics"' not in text


def test_one_moderate_place_with_gemini_stub_counts_one_ok_call(internal_token, monkeypatch):
    def gemini(request):
        body = {"candidates": [{"content": {"parts": [{"text": '{"findings": []}'}]}}]}
        return httpx.Response(200, json=body)

    real_client = GeminiClient
    monkeypatch.setattr(
        place_service, "GeminiClient",
        lambda **kwargs: real_client(api_key="test-key", transport=httpx.MockTransport(gemini),
                                     **kwargs),
    )
    # The real default wiring of PlaceModerator: FallbackLLM(..., task="place").
    app.dependency_overrides[get_place_moderator] = lambda: PlaceModerator(
        image_fetcher=FakeImageFetcher())
    try:
        client = TestClient(app, headers=AUTH_HEADERS)
        before = llm_count("gemini", "place", "ok")
        body = {"place_id": "p1", "tour_id": "t1", "name": "Ben Thanh Market",
                "description": "Historic market in District 1.", "language": "en"}
        response = client.post("/moderate/place", json=body)
        assert response.status_code == 200, response.text
        assert llm_count("gemini", "place", "ok") == before + 1
        assert 'llm_requests_total{outcome="ok",provider="gemini",task="place"}' \
            in client.get("/metrics").text
    finally:
        app.dependency_overrides.clear()


# ---------- chat ----------


class FakeChatService:
    def __init__(self, outcome):
        self.outcome = outcome

    async def turn(self, session_id, message, *, location=None, language=None):
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return {"session_id": session_id, "lang": "en", "answer": "Hello there friend",
                "citations": [], "finish_reason": "stop", "llm_calls": 1}


@pytest.fixture
def chat_client(internal_token, monkeypatch):
    monkeypatch.setenv("CHATBOT_ENABLED", "true")
    get_settings.cache_clear()

    def _make(outcome=None):
        app.dependency_overrides[chat_api.get_chat_service] = lambda: FakeChatService(outcome)
        return TestClient(app, headers=AUTH_HEADERS)

    yield _make
    app.dependency_overrides.clear()
    get_settings.cache_clear()


def chat_count(outcome):
    return value("chatbot_requests_total", outcome=outcome)


@pytest.mark.parametrize("outcome, status, expected", [
    (None, 200, "ok"),
    (ChatBusyError(5, "chat_cap"), 429, "rate_limited"),
    (LLMServerError("down", provider="gemini", status_code=503), 503, "unavailable"),
])
def test_chat_requests_are_counted_by_outcome(chat_client, outcome, status, expected):
    client = chat_client(outcome)
    before = chat_count(expected)
    first_tokens = value("chatbot_first_token_seconds_count")
    response = client.post("/chat", json={"message": "Find a food tour"})
    assert response.status_code == status
    assert chat_count(expected) == before + 1
    assert value("chatbot_first_token_seconds_count") == first_tokens + (status == 200)


def test_invalid_chat_request_is_counted_as_invalid(chat_client):
    client = chat_client()
    before = chat_count("invalid")
    assert client.post("/chat", json={"message": ""}).status_code == 422
    assert chat_count("invalid") == before + 1


def test_stream_failure_is_counted_as_error():
    async def drain():
        return [event async for event in chat_api.stream_turn({"session_id": "s", "lang": "en"})]

    before = chat_count("error")
    events = asyncio.run(drain())
    assert events[-1].startswith("event: error")
    assert chat_count("error") == before + 1


def test_chat_model_callback_counts_429_fallback_and_ok():
    pytest.importorskip("langchain_core")
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, ChatResult

    from app.chatbot.llm_metrics import with_llm_metrics

    class RateLimited(Exception):
        status_code = 429

    class ScriptedChat(BaseChatModel):
        ls_name: str = "other"
        reply: str = ""
        fail: bool = False

        @property
        def _llm_type(self):
            return "scripted"

        def _get_ls_params(self, stop=None, **kwargs):
            params = super()._get_ls_params(stop=stop, **kwargs)
            params["ls_provider"] = self.ls_name
            return params

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            if self.fail:
                raise RateLimited("quota")
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content=self.reply))])

    gemini = ScriptedChat(ls_name="google_genai", fail=True)
    groq = ScriptedChat(ls_name="groq", reply="Hi there")
    model = with_llm_metrics(gemini.with_fallbacks([groq]))
    before = (llm_count("gemini", "chat", "429"), llm_count("groq", "chat", "ok"),
              fallback_count("gemini", "groq"))

    answer = asyncio.run(model.ainvoke("hello"))

    assert answer.content == "Hi there"
    assert llm_count("gemini", "chat", "429") == before[0] + 1
    assert llm_count("groq", "chat", "ok") == before[1] + 1
    assert fallback_count("gemini", "groq") == before[2] + 1

    # Gemini answers with an empty message when it blocks content: blocked, no fallback.
    blocked, fallbacks = llm_count("gemini", "chat", "blocked"), fallback_count("gemini", "groq")
    empty = with_llm_metrics(ScriptedChat(ls_name="google_genai").with_fallbacks([groq]))
    assert asyncio.run(empty.ainvoke("hello")).content == ""
    assert llm_count("gemini", "chat", "blocked") == blocked + 1
    assert fallback_count("gemini", "groq") == fallbacks

    # Groq alone (overflow turn) failing: counted, never a fallback.
    alone = with_llm_metrics(ScriptedChat(ls_name="groq", fail=True))
    with pytest.raises(RateLimited):
        asyncio.run(alone.ainvoke("hello"))
    assert llm_count("groq", "chat", "429") >= 1
    assert fallback_count("gemini", "groq") == fallbacks


# ---------- chatbot indexer ----------


class FakeDispatcher:
    def __init__(self, outcome):
        self.outcome = outcome

    async def dispatch(self, routing_key, body):
        return self.outcome


class FakeMessage:
    def __init__(self, routing_key):
        self.routing_key = routing_key
        self.body = json.dumps({"tourId": "t1"}).encode()
        self.headers = {}

    async def ack(self):
        pass

    async def reject(self, requeue=False):
        pass

    async def nack(self, requeue=False):
        pass


async def _no_resend(message, count):
    pass


@pytest.mark.parametrize("key, outcome, event, result", [
    ("tour.published", "indexed", "tour.published", "indexed"),
    ("tour.published", "not_public", "tour.published", "removed"),
    ("tour.published", "duplicate", "tour.published", "skipped"),
    ("tour.published", "invalid", "tour.published", "failed"),
    ("tour.published", "error", "tour.published", "failed"),
    ("tour.unpublished", "deleted", "tour.unpublished", "removed"),
    ("tour.unpublished", "not_found", "tour.unpublished", "skipped"),
    ("tour.hidden", "deleted", "tour.unpublished", "removed"),
])
def test_indexer_events_are_counted(key, outcome, event, result):
    before = value("chatbot_indexer_events_total", event=event, result=result)
    asyncio.run(consumer.handle_message(FakeDispatcher(outcome), FakeMessage(key),
                                        resend=_no_resend, max_retries=3))
    assert value("chatbot_indexer_events_total", event=event, result=result) == before + 1


# ---------- closed label sets ----------


def test_every_label_value_comes_from_a_closed_set():
    asyncio.run(FallbackLLM(primary=Provider("gemini"), secondary=Provider("groq"))
                .generate_json("prompt"))
    seen = 0
    for family in REGISTRY.collect():
        if family.name.removesuffix("_total") not in {n.removesuffix("_total")
                                                       for n in METRIC_NAMES}:
            continue
        for sample in family.samples:
            for label, label_value in sample.labels.items():
                if label == "le":
                    continue
                assert label_value in CLOSED_SETS[label], (sample.name, label, label_value)
                seen += 1
    assert seen > 0

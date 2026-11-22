"""Provider clients (Gemini, Groq) and FallbackLLM on httpx.MockTransport.

These are the classes that turn real provider answers into the error types the
business rules depend on (fallback only on timeout, 429, 5xx; blocked text is
LLMBlockedError; malformed output is never retried on another provider).
No network: every HTTP call goes to a scripted MockTransport.
"""

import asyncio
import json

import httpx
import pytest

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
from app.llm.groq_client import GroqClient
from tests.conftest import JPEG_BYTES


def run(coro):
    return asyncio.run(coro)


def gemini_text(text, finish="STOP"):
    return {"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": finish}]}


def groq_text(text):
    return {"choices": [{"message": {"content": text}}]}


class Script:
    """MockTransport handler: returns (or raises) the scripted items in order."""

    def __init__(self, *items):
        self.items = list(items)
        self.requests: list[httpx.Request] = []

    def __call__(self, request):
        self.requests.append(request)
        item = self.items[min(len(self.requests), len(self.items)) - 1]
        if isinstance(item, Exception):
            # A fresh copy: a raised parametrize instance would keep its traceback
            # (and the closed event loop) alive for the whole session.
            raise type(item)(*item.args)
        if isinstance(item, httpx.Response):
            return item
        return httpx.Response(200, json=item)

    def body(self, i=0):
        return json.loads(self.requests[i].content)


def gemini(script, **kwargs):
    kwargs.setdefault("api_key", "test-key")
    kwargs.setdefault("model", "gemini-2.5-flash")
    return GeminiClient(transport=httpx.MockTransport(script), **kwargs)


def groq(script, **kwargs):
    kwargs.setdefault("api_key", "test-key")
    kwargs.setdefault("model", "openai/gpt-oss-20b")
    return GroqClient(transport=httpx.MockTransport(script), **kwargs)


# ---------- Gemini: request shape ----------


def test_gemini_request_has_model_key_header_system_and_json_mode():
    script = Script(gemini_text('{"findings": []}'))
    assert run(gemini(script).generate_json("prompt", system="sys", temperature=0.0)) == {
        "findings": []
    }
    req = script.requests[0]
    assert req.url.path.endswith("/models/gemini-2.5-flash:generateContent")
    assert req.headers["x-goog-api-key"] == "test-key"
    assert "key=" not in str(req.url)  # the key never goes in the URL (logs, proxies)
    body = script.body()
    assert body["systemInstruction"] == {"parts": [{"text": "sys"}]}
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert body["generationConfig"]["temperature"] == 0.0
    assert "safetySettings" not in body


def test_gemini_moderation_client_turns_every_safety_filter_off():
    script = Script(gemini_text("{}"))
    run(gemini(script, safety_block_none=True).generate_json("p"))
    settings = script.body()["safetySettings"]
    assert {s["threshold"] for s in settings} == {"BLOCK_NONE"}
    assert len(settings) == 4


def test_gemini_text_mode_has_no_json_mime_type():
    script = Script(gemini_text("Xin chào"))
    assert run(gemini(script).generate_text("p")) == "Xin chào"
    assert "responseMimeType" not in script.body()["generationConfig"]


def test_gemini_joins_text_parts():
    data = {"candidates": [{"content": {"parts": [{"text": '{"a":'}, {"text": " 1}"}]}}]}
    assert run(gemini(Script(data)).generate_json("p")) == {"a": 1}


@pytest.mark.parametrize(
    "text",
    ['```json\n{"findings": []}\n```', '```\n{"findings": []}\n```', '  {"findings": []}  '],
)
def test_gemini_strips_markdown_fences_around_json(text):
    assert run(gemini(Script(gemini_text(text))).generate_json("p")) == {"findings": []}


def test_missing_api_key_fails_before_any_http_call():
    script = Script(gemini_text("{}"))
    with pytest.raises(LLMBadRequestError):
        run(gemini(script, api_key="").generate_json("p"))
    with pytest.raises(LLMBadRequestError):
        run(groq(script, api_key="").generate_json("p"))
    assert script.requests == []


# ---------- Gemini: answers mapped to error types ----------


@pytest.mark.parametrize(
    "response, error",
    [
        (httpx.Response(429, json={"error": {"message": "quota"}}), LLMRateLimitError),
        (httpx.Response(500, text="boom"), LLMServerError),
        (httpx.Response(503, json={"error": {"message": "overloaded"}}), LLMServerError),
        (httpx.Response(400, json={"error": {"message": "bad"}}), LLMBadRequestError),
        (httpx.Response(401, text=""), LLMBadRequestError),
        (httpx.Response(403, json=["not", "a", "dict"]), LLMBadRequestError),
        (httpx.Response(404, json={"error": "model not found"}), LLMBadRequestError),
        (httpx.ReadTimeout("slow"), LLMTimeoutError),
        (httpx.ConnectError("refused"), LLMConnectionError),
        (httpx.Response(200, text="<html>not json</html>"), LLMResponseError),
        (httpx.Response(200, json={"candidates": []}), LLMResponseError),
        (httpx.Response(200, json=gemini_text("   ")), LLMResponseError),
        (httpx.Response(200, json=gemini_text("not json at all")), LLMResponseError),
        (httpx.Response(200, json=gemini_text('{"findings": [')), LLMResponseError),
        (httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}}), LLMBlockedError),
        (httpx.Response(200, json={"promptFeedback": {"blockReason": "OTHER"}}), LLMBlockedError),
        (httpx.Response(200, json=gemini_text("", finish="SAFETY")), LLMBlockedError),
        (httpx.Response(200, json=gemini_text("", finish="PROHIBITED_CONTENT")), LLMBlockedError),
        (httpx.Response(200, json=gemini_text("", finish="MAX_TOKENS")), LLMResponseError),
    ],
    ids=lambda v: str(getattr(v, "__name__", None) or getattr(v, "status_code", None) or type(v).__name__),
)
def test_gemini_maps_every_answer_to_the_right_error(response, error):
    with pytest.raises(error) as info:
        run(gemini(Script(response)).generate_json("p"))
    assert info.value.provider == "gemini"
    assert info.value.fallback_eligible == (
        error in (LLMRateLimitError, LLMServerError, LLMTimeoutError, LLMConnectionError)
    )


def test_gemini_error_text_is_short_and_never_holds_the_key():
    huge = "x" * 5000
    with pytest.raises(LLMServerError) as info:
        run(gemini(Script(httpx.Response(502, text=huge))).generate_json("p"))
    assert len(info.value.message) <= 200
    assert "test-key" not in str(info.value)
    assert "HTTP 502" in str(info.value)


def test_gemini_answer_that_is_not_an_object_is_a_response_error():
    # A 200 whose JSON is a list must still be a typed LLM error (-> 503), never a 500.
    with pytest.raises(LLMResponseError):
        run(gemini(Script(httpx.Response(200, json=[1, 2]))).generate_json("p"))


# ---------- Groq ----------


def test_groq_request_shape_bearer_json_mode_and_low_reasoning():
    script = Script(groq_text('{"findings": []}'))
    assert run(groq(script).generate_json("prompt", system="sys")) == {"findings": []}
    req = script.requests[0]
    assert req.url.path.endswith("/chat/completions")
    assert req.headers["authorization"] == "Bearer test-key"
    body = script.body()
    assert body["model"] == "openai/gpt-oss-20b"
    assert body["response_format"] == {"type": "json_object"}
    assert body["reasoning_effort"] == "low"
    system, user = body["messages"]
    # Groq JSON mode needs the word JSON in the messages.
    assert system["role"] == "system" and "sys" in system["content"] and "JSON" in system["content"]
    assert user == {"role": "user", "content": "prompt"}


def test_groq_non_reasoning_model_and_text_mode():
    script = Script(groq_text("hello"))
    assert run(groq(script, model="llama-3.1-8b-instant").generate_text("p")) == "hello"
    body = script.body()
    assert "reasoning_effort" not in body and "response_format" not in body
    assert body["messages"] == [{"role": "user", "content": "p"}]


@pytest.mark.parametrize(
    "response, error",
    [
        (httpx.Response(429, json={"error": {"message": "rate"}}), LLMRateLimitError),
        (httpx.Response(500, text="boom"), LLMServerError),
        (httpx.Response(400, json={"error": {"message": "bad"}}), LLMBadRequestError),
        (httpx.Response(413, text="too large"), LLMBadRequestError),
        (httpx.ReadTimeout("slow"), LLMTimeoutError),
        (httpx.ConnectError("refused"), LLMConnectionError),
        (httpx.Response(200, text="not json"), LLMResponseError),
        (httpx.Response(200, json={"choices": []}), LLMResponseError),
        (httpx.Response(200, json={"choices": [{"message": {}}]}), LLMResponseError),
        (httpx.Response(200, json={"choices": [{"message": {"content": None}}]}), LLMResponseError),
        (httpx.Response(200, json=groq_text("  ")), LLMResponseError),
        (httpx.Response(200, json=groq_text("{broken")), LLMResponseError),
        (httpx.Response(200, json=[1]), LLMResponseError),
    ],
    ids=lambda v: str(getattr(v, "__name__", None) or getattr(v, "status_code", None) or type(v).__name__),
)
def test_groq_maps_every_answer_to_the_right_error(response, error):
    with pytest.raises(error) as info:
        run(groq(Script(response)).generate_json("p"))
    assert info.value.provider == "groq"


def test_groq_strips_markdown_fences():
    assert run(groq(Script(groq_text('```json\n{"ok": true}\n```'))).generate_json("p")) == {
        "ok": True
    }


# ---------- FallbackLLM with the real clients ----------


def pair(gemini_items, groq_items, groq_key="test-key"):
    g, q = Script(*gemini_items), Script(*groq_items)
    llm = FallbackLLM(primary=gemini(g), secondary=groq(q, api_key=groq_key), task="place")
    return llm, g, q


@pytest.mark.parametrize(
    "primary_failure",
    [
        httpx.Response(429, json={"error": {"message": "quota"}}),
        httpx.Response(500, text="boom"),
        httpx.Response(503, text="overloaded"),
        httpx.ReadTimeout("slow"),
        httpx.ConnectError("refused"),
    ],
    ids=["429", "500", "503", "timeout", "connect"],
)
def test_fallback_to_groq_on_temporary_gemini_failure(primary_failure):
    llm, g, q = pair([primary_failure], [groq_text('{"findings": []}')])
    data, model = run(llm.generate_json_with_model("p", system="sys"))
    assert data == {"findings": []}
    assert model == "openai/gpt-oss-20b"
    assert len(g.requests) == 1 and len(q.requests) == 1
    # Groq gets the same system prompt and user prompt.
    assert q.body()["messages"][-1]["content"] == "p"
    assert "sys" in q.body()["messages"][0]["content"]


@pytest.mark.parametrize(
    "primary_answer, error",
    [
        (httpx.Response(400, json={"error": {"message": "bad"}}), LLMBadRequestError),
        (httpx.Response(401, text="no key"), LLMBadRequestError),
        (httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}}), LLMBlockedError),
        (httpx.Response(200, json=gemini_text("", finish="SAFETY")), LLMBlockedError),
        (httpx.Response(200, json=gemini_text("not json")), LLMResponseError),
        (httpx.Response(200, json={"candidates": []}), LLMResponseError),
    ],
    ids=["400", "401", "prompt-blocked", "answer-blocked", "invalid-json", "no-candidates"],
)
def test_no_fallback_for_permanent_or_blocked_failures(primary_answer, error):
    llm, g, q = pair([primary_answer], [groq_text("{}")])
    with pytest.raises(error):
        run(llm.generate_json_with_model("p"))
    assert len(g.requests) == 1
    assert q.requests == []


def test_no_fallback_when_the_request_has_images():
    llm, g, q = pair([httpx.Response(503, text="down")], [groq_text("{}")])
    with pytest.raises(LLMServerError):
        run(llm.generate_json_with_model("p", images=[("image/jpeg", JPEG_BYTES)]))
    assert len(g.requests) == 1 and q.requests == []
    assert "inline_data" in g.body()["contents"][0]["parts"][1]


def test_no_fallback_when_groq_has_no_key():
    llm, g, q = pair([httpx.Response(429, text="quota")], [groq_text("{}")], groq_key="")
    with pytest.raises(LLMRateLimitError):
        run(llm.generate_json_with_model("p"))
    assert q.requests == []


@pytest.mark.parametrize(
    "secondary_failure, error",
    [
        (httpx.Response(503, text="down too"), LLMServerError),
        (httpx.Response(429, text="quota too"), LLMRateLimitError),
        (httpx.Response(200, json=groq_text("broken")), LLMResponseError),
    ],
)
def test_both_providers_fail_raises_the_groq_error_chained_to_gemini(secondary_failure, error):
    llm, g, q = pair([httpx.Response(500, text="boom")], [secondary_failure])
    with pytest.raises(error) as info:
        run(llm.generate_json_with_model("p"))
    assert info.value.provider == "groq"
    assert isinstance(info.value.__cause__, LLMServerError)
    assert info.value.__cause__.provider == "gemini"
    assert len(g.requests) == 1 and len(q.requests) == 1


def test_fallback_generate_text_also_falls_back():
    llm, _, q = pair([httpx.Response(503, text="down")], [groq_text("chào bạn")])
    assert run(llm.generate_text("p")) == "chào bạn"
    assert "response_format" not in q.body()


def test_successful_gemini_answer_never_calls_groq():
    llm, g, q = pair([gemini_text('{"findings": []}')], [groq_text("{}")])
    data, model = run(llm.generate_json_with_model("p"))
    assert model == "gemini-2.5-flash" and q.requests == []

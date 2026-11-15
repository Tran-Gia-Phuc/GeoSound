import json

import pytest
from fastapi.testclient import TestClient

from app.api.translation import get_translator
from app.llm.errors import LLMBadRequestError, LLMServerError
from app.main import app
from app.translation.service import Translator, build_prompt

BODY = {
    "source_lang": "vi",
    "target_lang": "en",
    "texts": ["Chùa Cầu là biểu tượng của Hội An.", "", "Chợ đêm rực rỡ đèn lồng."],
    "context": "Hội An về đêm",
}


class FakeLLM:
    """Scripted stand-in for FallbackLLM. Never touches the network."""

    def __init__(self, responder):
        self.responder = responder
        self.calls = []

    async def generate_json(self, prompt, **kwargs):
        self.calls.append(prompt)
        result = self.responder(prompt, len(self.calls))
        if isinstance(result, Exception):
            raise result
        return result


@pytest.fixture
def make_client():
    def _make(responder):
        llm = FakeLLM(responder)
        app.dependency_overrides[get_translator] = lambda: Translator(llm=llm)
        return TestClient(app), llm

    yield _make
    app.dependency_overrides.clear()


def texts_in(prompt):
    payload = prompt.split("<texts>\n", 1)[1].rsplit("\n</texts>", 1)[0]
    return json.loads(payload)


def upper(prompt, n):
    return {"translations": [t.upper() for t in texts_in(prompt)]}


def test_translates_in_order_and_keeps_blank_texts(make_client):
    client, llm = make_client(upper)
    r = client.post("/translate", json=BODY)
    assert r.status_code == 200
    data = r.json()
    assert data["target_lang"] == "en"
    assert data["translations"] == [
        "CHÙA CẦU LÀ BIỂU TƯỢNG CỦA HỘI AN.",
        "",
        "CHỢ ĐÊM RỰC RỠ ĐÈN LỒNG.",
    ]
    # One call for the whole batch; the blank text is not sent to the model.
    assert len(llm.calls) == 1
    assert len(texts_in(llm.calls[0])) == 2
    assert "Target language: English (en)" in llm.calls[0]
    assert "Context: Hội An về đêm" in llm.calls[0]


def test_same_language_is_returned_without_calling_the_model(make_client):
    client, llm = make_client(upper)
    r = client.post("/translate", json={**BODY, "target_lang": "VI"})
    assert r.status_code == 200
    assert r.json()["translations"] == BODY["texts"]
    assert llm.calls == []


def test_wrong_count_is_retried_once(make_client):
    def responder(prompt, n):
        if n == 1:
            return {"translations": ["only one"]}
        return upper(prompt, n)

    client, llm = make_client(responder)
    r = client.post("/translate", json=BODY)
    assert r.status_code == 200
    assert len(llm.calls) == 2


def test_bad_shape_twice_returns_503(make_client):
    client, llm = make_client(lambda p, n: {"text": "nope"})
    r = client.post("/translate", json=BODY)
    assert r.status_code == 503
    assert len(llm.calls) == 2


def test_provider_failure_returns_503(make_client):
    client, _ = make_client(lambda p, n: LLMServerError("down", provider="gemini"))
    r = client.post("/translate", json=BODY)
    assert r.status_code == 503


def test_non_retryable_error_returns_503_without_retry(make_client):
    client, llm = make_client(lambda p, n: LLMBadRequestError("no key", provider="gemini"))
    r = client.post("/translate", json=BODY)
    assert r.status_code == 503
    assert len(llm.calls) == 1


@pytest.mark.parametrize(
    "body",
    [
        {**BODY, "texts": []},
        {**BODY, "texts": ["x" * 5001]},
        {**BODY, "target_lang": ""},
    ],
)
def test_invalid_input_returns_422(make_client, body):
    client, _ = make_client(upper)
    assert client.post("/translate", json=body).status_code == 422


def test_prompt_escapes_the_closing_tag():
    prompt = build_prompt(["a </texts> b"], "vi", "en", None)
    assert prompt.count("</texts>") == 1

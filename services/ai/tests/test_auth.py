"""Internal token auth on /moderate/* (task #AI-28). No network, FakeLLM only."""

import pytest
from fastapi.testclient import TestClient

from app.main import app

BODY = {"tour_id": "t1", "title": "Food tour Saigon", "language": "en"}


def clean(prompt, n):
    return {"findings": []}


@pytest.fixture
def anon(make_client):
    """Client without the token header, plus the FakeLLM behind /moderate."""
    _, llm = make_client(clean)
    return TestClient(app), llm


def test_missing_token_is_401(anon):
    client, llm = anon
    r = client.post("/moderate", json=BODY)
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid internal token"
    assert llm.calls == []


def test_wrong_token_is_401(anon):
    client, llm = anon
    r = client.post("/moderate", json=BODY, headers={"x-internal-token": "wrong"})
    assert r.status_code == 401
    assert llm.calls == []


def test_empty_header_is_401(anon):
    client, _ = anon
    r = client.post("/moderate", json=BODY, headers={"x-internal-token": ""})
    assert r.status_code == 401


def test_correct_token_passes(make_client):
    client, llm = make_client(clean)  # sends the configured token
    r = client.post("/moderate", json=BODY)
    assert r.status_code == 200
    assert len(llm.calls) == 1


def test_auth_runs_before_body_validation(anon):
    client, _ = anon
    r = client.post("/moderate", json={"title": ""})
    assert r.status_code == 401


def test_empty_configured_token_rejects_everything(anon, internal_token):
    internal_token("")
    client, llm = anon
    assert client.post("/moderate", json=BODY).status_code == 401
    r = client.post("/moderate", json=BODY, headers={"x-internal-token": ""})
    assert r.status_code == 401
    assert llm.calls == []


def test_health_is_open(internal_token):
    r = TestClient(app).get("/health")
    assert r.status_code == 200


def test_translate_is_open(internal_token):
    # Invalid body: FastAPI answers 422 before any LLM call; the point is "not 401".
    r = TestClient(app).post("/translate", json={})
    assert r.status_code == 422

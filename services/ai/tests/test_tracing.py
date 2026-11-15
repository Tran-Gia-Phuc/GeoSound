"""Optional LangSmith tracing (task #AI-32). A fake `langsmith` module only; never the network."""

import asyncio
import json
import logging
import sys
import types

import pytest
from fastapi.testclient import TestClient

from app.api.moderation import get_place_moderator, get_tour_moderator
from app.config import get_settings
from app.llm.errors import LLMServerError
from app.main import app
from app.moderation import tracing
from app.moderation.place_service import PlaceModerator
from app.moderation.tour_service import TourModerator
from tests.conftest import AUTH_HEADERS, FakeLLM

FAKE_KEY = "fake-langsmith-key-not-real"
PLACE_NAME = "Ben Thanh Market"
PLACE_DESCRIPTION = "Historic market in District 1, open from 6 am."
PLACE_BODY = {
    "place_id": "p1",
    "tour_id": "t1",
    "name": PLACE_NAME,
    "description": PLACE_DESCRIPTION,
    "language": "en",
}
TOUR_TITLE = "Saigon street food walk"
TOUR_DESCRIPTION = "A two-hour walk through the best food stalls of District 1."
TOUR_BODY = {
    "tour_id": "t1",
    "title": TOUR_TITLE,
    "description": TOUR_DESCRIPTION,
    "language": "en",
    "places": [{"place_id": "p1", "name": PLACE_NAME, "description": PLACE_DESCRIPTION}],
}
USER_TEXTS = (PLACE_NAME, PLACE_DESCRIPTION, TOUR_TITLE, TOUR_DESCRIPTION)


def warning_finding(prompt, n):
    return {
        "findings": [
            {"field": "description", "category": "misleading", "severity": 0.55, "message": "Check the hours."}
        ]
    }


class _RunTree:
    def __init__(self):
        self.metadata = {}

    def add_metadata(self, metadata):
        self.metadata.update(metadata)


def make_fake_langsmith():
    """Minimal stand-in for the `langsmith` package: records one dict per traced call."""
    module = types.ModuleType("langsmith")
    module.runs = []
    module.clients = []
    module._current = None

    class Client:
        def __init__(self, api_key=None):
            module.clients.append(api_key)

    def traceable(**options):
        def decorate(fn):
            async def wrapper(*args, **kwargs):
                run = {"options": options, "inputs": {"args": args, "kwargs": kwargs}, "tree": _RunTree()}
                module._current = run["tree"]
                try:
                    run["outputs"] = await fn(*args, **kwargs)
                finally:
                    module._current = None
                module.runs.append(run)
                return run["outputs"]

            return wrapper

        return decorate

    module.Client = Client
    module.traceable = traceable
    module.get_current_run_tree = lambda: module._current
    return module


class _BlockLangsmith:
    """Meta path finder that fails the test if anything imports `langsmith`."""

    def find_spec(self, name, path=None, target=None):
        if name == "langsmith" or name.startswith("langsmith."):
            raise AssertionError("langsmith must not be imported when tracing is off")
        return None


@pytest.fixture
def tracing_env(monkeypatch, internal_token):
    """Set LANGSMITH_* for one test; resets the cached settings and tracer around it."""

    def _set(enabled, api_key=FAKE_KEY, project="geosound-test"):
        monkeypatch.setenv("LANGSMITH_TRACING", "true" if enabled else "false")
        monkeypatch.setenv("LANGSMITH_API_KEY", api_key)
        monkeypatch.setenv("LANGSMITH_PROJECT", project)
        get_settings.cache_clear()
        tracing.load_tracer.cache_clear()

    yield _set
    get_settings.cache_clear()
    tracing.load_tracer.cache_clear()


@pytest.fixture
def clients():
    """TestClient plus FakeLLMs for both moderators."""
    place_llm = FakeLLM(warning_finding)
    tour_llm = FakeLLM(warning_finding)
    app.dependency_overrides[get_place_moderator] = lambda: PlaceModerator(llm=place_llm)
    app.dependency_overrides[get_tour_moderator] = lambda: TourModerator(llm=tour_llm)
    yield TestClient(app, headers=AUTH_HEADERS), place_llm, tour_llm
    app.dependency_overrides.clear()


@pytest.fixture
def fake_langsmith(monkeypatch):
    module = make_fake_langsmith()
    monkeypatch.setitem(sys.modules, "langsmith", module)
    return module


# ---- flag off --------------------------------------------------------------


def test_flag_off_returns_the_function_unchanged(tracing_env):
    tracing_env(False)

    async def work(request):
        return request

    assert tracing.trace_moderation("place")(work) is work
    assert tracing.trace_moderation("tour")(work) is work


def test_flag_off_never_imports_langsmith(tracing_env, clients, monkeypatch):
    tracing_env(False)
    monkeypatch.delitem(sys.modules, "langsmith", raising=False)
    blocker = _BlockLangsmith()
    monkeypatch.setattr(sys, "meta_path", [blocker, *sys.meta_path])
    client, place_llm, tour_llm = clients

    assert client.post("/moderate/place", json=PLACE_BODY).status_code == 200
    assert client.post("/moderate/tour", json=TOUR_BODY).status_code == 200

    assert "langsmith" not in sys.modules
    assert tracing.load_tracer.cache_info().currsize == 0
    assert len(place_llm.calls) == 1 and len(tour_llm.calls) == 1


def test_default_settings_keep_tracing_off(monkeypatch):
    for name in ("LANGSMITH_TRACING", "LANGSMITH_PROJECT", "LANGSMITH_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    settings = get_settings().__class__(_env_file=None)
    assert settings.langsmith_tracing is False
    assert settings.langsmith_project == "geosound-ai"


def test_api_key_never_in_settings_repr_or_dump(monkeypatch):
    monkeypatch.setenv("LANGSMITH_API_KEY", FAKE_KEY)
    settings = get_settings().__class__(_env_file=None)
    assert settings.langsmith_api_key.get_secret_value() == FAKE_KEY
    assert FAKE_KEY not in repr(settings)
    assert FAKE_KEY not in settings.model_dump_json()


# ---- flag on, fake langsmith -----------------------------------------------


def _recorded_text(run):
    return json.dumps(
        {
            "inputs": run["inputs"],
            "outputs": run["outputs"],
            "options": {k: v for k, v in run["options"].items() if k != "client"},
            "metadata": run["tree"].metadata,
        },
        default=str,
    )


def test_flag_on_traces_one_place_call(tracing_env, clients, fake_langsmith):
    tracing_env(True)
    client, place_llm, _ = clients

    response = client.post("/moderate/place", json=PLACE_BODY)

    assert response.status_code == 200
    assert response.json()["verdict"] == "Warning"
    assert len(place_llm.calls) == 1
    assert len(fake_langsmith.runs) == 1
    run = fake_langsmith.runs[0]
    assert run["options"]["name"] == "moderate_place"
    assert run["options"]["run_type"] == "chain"
    assert run["options"]["project_name"] == "geosound-test"

    (inputs,) = run["inputs"]["args"]
    assert inputs == {
        "language": "en",
        "place_id": "p1",
        "tour_id": "t1",
        "name_length": len(PLACE_NAME),
        "description_length": len(PLACE_DESCRIPTION),
        "images": 0,
    }
    outputs = run["outputs"]
    assert outputs["verdict"] == "Warning"
    assert outputs["severity"] == 0.55
    assert outputs["categories"] == ["misleading"]
    assert outputs["model"] == "fake-model"
    assert outputs["images_checked"] == 0
    assert outputs["latency_ms"] >= 0
    metadata = run["tree"].metadata
    assert metadata["model"] == "fake-model"
    assert metadata["verdict"] == "Warning"
    assert metadata["latency_ms"] >= 0

    recorded = _recorded_text(run)
    for text in USER_TEXTS:
        assert text not in recorded
    assert "Check the hours." not in recorded  # finding messages stay out too
    assert FAKE_KEY not in recorded
    assert fake_langsmith.clients == [FAKE_KEY]  # the key only goes to the client


def test_flag_on_traces_one_tour_call(tracing_env, clients, fake_langsmith):
    tracing_env(True)
    client, _, tour_llm = clients

    response = client.post("/moderate/tour", json=TOUR_BODY)

    assert response.status_code == 200
    assert len(tour_llm.calls) == 1
    assert len(fake_langsmith.runs) == 1
    run = fake_langsmith.runs[0]
    assert run["options"]["name"] == "moderate_tour"
    (inputs,) = run["inputs"]["args"]
    assert inputs["tour_id"] == "t1"
    assert inputs["places"] == 1
    assert inputs["title_length"] == len(TOUR_TITLE)
    assert run["outputs"]["verdict"] == "Warning"
    assert run["outputs"]["model"] == "fake-model"
    assert "images_checked" not in run["outputs"]
    recorded = _recorded_text(run)
    for text in USER_TEXTS:
        assert text not in recorded
    assert FAKE_KEY not in recorded


def test_flag_on_failed_call_records_class_name_and_keeps_503(tracing_env, fake_langsmith, internal_token):
    tracing_env(True)
    secret_text = "provider echoed: " + PLACE_DESCRIPTION
    llm = FakeLLM(lambda prompt, n: LLMServerError(secret_text, provider="gemini", status_code=500))
    app.dependency_overrides[get_place_moderator] = lambda: PlaceModerator(llm=llm)
    try:
        response = TestClient(app, headers=AUTH_HEADERS).post("/moderate/place", json=PLACE_BODY)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert len(fake_langsmith.runs) == 1
    outputs = fake_langsmith.runs[0]["outputs"]
    assert outputs["error"] == "LLMServerError"
    assert secret_text not in _recorded_text(fake_langsmith.runs[0])


def test_tracer_failure_runs_untraced(tracing_env, monkeypatch, caplog):
    tracing_env(True)
    module = make_fake_langsmith()

    def broken_traceable(**options):
        raise RuntimeError("tracer down")

    module.traceable = broken_traceable
    monkeypatch.setitem(sys.modules, "langsmith", module)
    calls = []

    async def work(request):
        calls.append(request)
        return "done"

    with caplog.at_level(logging.WARNING, logger="app.moderation.tracing"):
        result = asyncio.run(tracing.trace_moderation("place")(work)(object()))

    assert result == "done"
    assert len(calls) == 1
    assert "RuntimeError" in caplog.text


# ---- flag on, tracing unavailable ------------------------------------------


def test_flag_on_without_langsmith_installed_runs_untraced(tracing_env, clients, monkeypatch, caplog):
    tracing_env(True)
    monkeypatch.setitem(sys.modules, "langsmith", None)  # import langsmith -> ImportError
    client, place_llm, _ = clients

    with caplog.at_level(logging.WARNING, logger="app.moderation.tracing"):
        first = client.post("/moderate/place", json=PLACE_BODY)
        second = client.post("/moderate/place", json=PLACE_BODY)

    assert first.status_code == 200 and second.status_code == 200
    assert len(place_llm.calls) == 2
    warnings = [r for r in caplog.records if r.name == "app.moderation.tracing"]
    assert len(warnings) == 1
    assert "not installed" in warnings[0].getMessage()
    assert FAKE_KEY not in caplog.text


def test_flag_on_with_empty_key_runs_untraced(tracing_env, clients, fake_langsmith, caplog):
    tracing_env(True, api_key="")
    client, place_llm, _ = clients

    with caplog.at_level(logging.WARNING, logger="app.moderation.tracing"):
        first = client.post("/moderate/place", json=PLACE_BODY)
        second = client.post("/moderate/tour", json=TOUR_BODY)

    assert first.status_code == 200 and second.status_code == 200
    assert fake_langsmith.runs == []
    assert fake_langsmith.clients == []
    warnings = [r for r in caplog.records if r.name == "app.moderation.tracing"]
    assert len(warnings) == 1
    assert "LANGSMITH_API_KEY is empty" in warnings[0].getMessage()


def test_unknown_kind_is_a_programming_error():
    with pytest.raises(ValueError):
        tracing.trace_moderation("chatbot")

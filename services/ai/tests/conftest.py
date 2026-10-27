import pytest
from fastapi.testclient import TestClient

from app.api.moderation import get_moderator
from app.config import get_settings
from app.main import app
from app.moderation.service import TextModerator

# Fake token used only in tests; the real one comes from INTERNAL_SERVICE_TOKEN.
TEST_TOKEN = "test-internal-token"
AUTH_HEADERS = {"x-internal-token": TEST_TOKEN}


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
def internal_token(monkeypatch):
    """Configure INTERNAL_SERVICE_TOKEN for the test; returns a setter for other values."""

    def _set(value):
        monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", value)
        get_settings.cache_clear()

    _set(TEST_TOKEN)
    yield _set
    get_settings.cache_clear()


@pytest.fixture
def make_client(internal_token):
    """Build a TestClient (sending the internal token) whose moderator uses a FakeLLM.

    Returns (client, llm).
    """

    def _make(responder):
        llm = FakeLLM(responder)
        app.dependency_overrides[get_moderator] = lambda: TextModerator(llm=llm)
        return TestClient(app, headers=AUTH_HEADERS), llm

    yield _make
    app.dependency_overrides.clear()

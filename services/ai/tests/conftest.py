import pytest
from fastapi.testclient import TestClient

from app.api.moderation import get_moderator
from app.main import app
from app.moderation.service import TextModerator


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
    """Build a TestClient whose moderator uses a FakeLLM; returns (client, llm)."""

    def _make(responder):
        llm = FakeLLM(responder)
        app.dependency_overrides[get_moderator] = lambda: TextModerator(llm=llm)
        return TestClient(app), llm

    yield _make
    app.dependency_overrides.clear()

import pytest
from fastapi.testclient import TestClient

from app.api.moderation import get_place_moderator
from app.config import get_settings
from app.main import app
from app.moderation.images import FetchedImage, ImageProblem
from app.moderation.place_service import PlaceModerator

# Fake token used only in tests; the real one comes from INTERNAL_SERVICE_TOKEN.
TEST_TOKEN = "test-internal-token"
AUTH_HEADERS = {"x-internal-token": TEST_TOKEN}

# Smallest valid magic bytes for each allowed image type.
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 60
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 60
WEBP_BYTES = b"RIFF\x40\x00\x00\x00WEBPVP8 " + b"\x00" * 50


class FakeLLM:
    """Scripted stand-in for FallbackLLM. Never touches the network.

    `calls` holds the prompts; `kwargs` holds the keyword arguments of each
    call (system, temperature, images).
    """

    model = "fake-model"

    def __init__(self, responder):
        self.responder = responder
        self.calls = []
        self.kwargs = []

    async def generate_json(self, prompt, **kwargs):
        self.calls.append(prompt)
        self.kwargs.append(kwargs)
        result = self.responder(prompt, len(self.calls))
        if isinstance(result, Exception):
            raise result
        return result


class FakeImageFetcher:
    """Stand-in for images.make_image_fetcher(). Never touches the network.

    `plan` maps an index to "ok" (a JPEG), "permanent" or "temporary";
    indexes not in the plan are "ok".
    """

    def __init__(self, plan=None):
        self.plan = plan or {}
        self.calls = []

    async def __call__(self, urls):
        self.calls.append(list(urls))
        results = []
        for index, url in enumerate(urls):
            kind = self.plan.get(index, "ok")
            if kind == "ok":
                results.append(FetchedImage(index, url, "image/jpeg", JPEG_BYTES))
            else:
                results.append(ImageProblem(index, kind, "scripted"))
        return results


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
    """Build a TestClient (sending the internal token) whose place moderator uses a FakeLLM.

    Images go through a FakeImageFetcher (pass `image_plan` to script problems).
    Returns (client, llm).
    """

    def _make(responder, image_plan=None):
        llm = FakeLLM(responder)
        fetcher = FakeImageFetcher(image_plan)
        app.dependency_overrides[get_place_moderator] = lambda: PlaceModerator(
            llm=llm, image_fetcher=fetcher
        )
        return TestClient(app, headers=AUTH_HEADERS), llm

    yield _make
    app.dependency_overrides.clear()

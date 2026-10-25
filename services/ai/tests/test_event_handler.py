import asyncio

import pytest

from app.events.handler import (
    ModerationEventHandler,
    PermanentEventError,
    TransientEventError,
)
from app.events.tour_client import (
    TourContentError,
    TourNotFoundError,
    TourServiceError,
)
from app.llm.errors import LLMServerError
from app.moderation.schema import Category, ModerationRequest
from app.moderation.service import Finding

REQ = ModerationRequest(tour_id="t1", title="Food tour")
BODY = b'{"tourId":"t1","contributorId":"u1"}'


def finding(severity, field="stops[1].description"):
    return Finding(field=field, category=Category.SCAM, severity=severity, message="Asks for a deposit")


class Script:
    """Returns/raises scripted outcomes; the last one repeats."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    def next(self):
        outcome = self.outcomes[min(self.calls, len(self.outcomes) - 1)]
        self.calls += 1
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeTourClient(Script):
    async def fetch_for_moderation(self, tour_id):
        return self.next()


class FakeModerator(Script):
    async def scan_tour(self, request):
        return self.next()


class FakePublisher:
    def __init__(self, failures=0):
        self.failures = failures
        self.attempts = 0
        self.sent = []

    async def publish(self, name, payload):
        self.attempts += 1
        if self.attempts <= self.failures:
            raise OSError("broker down")
        self.sent.append((name, payload))


def build(client, moderator, publisher, attempts=3):
    sleeps = []

    async def fake_sleep(delay):
        sleeps.append(delay)

    handler = ModerationEventHandler(
        client, moderator, publisher, max_attempts=attempts, retry_delay=0.1, sleep=fake_sleep
    )
    return handler, sleeps


def run(handler, body=BODY):
    asyncio.run(handler.handle(body))


def test_pass_publishes_ai_passed():
    pub = FakePublisher()
    handler, _ = build(FakeTourClient(REQ), FakeModerator([]), pub)
    run(handler)
    name, payload = pub.sent[0]
    assert name == "tour.ai_passed"
    assert payload["tourId"] == "t1"
    assert "warning" not in payload


def test_warning_publishes_ai_passed_with_flag():
    pub = FakePublisher()
    handler, _ = build(FakeTourClient(REQ), FakeModerator([finding(0.6)]), pub)
    run(handler)
    name, payload = pub.sent[0]
    assert name == "tour.ai_passed"
    assert payload["warning"] is True
    assert payload["reasons"] == ["stops[1].description: Asks for a deposit"]


def test_reject_publishes_ai_rejected():
    pub = FakePublisher()
    handler, _ = build(FakeTourClient(REQ), FakeModerator([finding(0.95)]), pub)
    run(handler)
    name, payload = pub.sent[0]
    assert name == "tour.ai_rejected"
    assert "stops[1].description" in payload["reason"]


def test_tour_service_hiccup_is_retried():
    client = FakeTourClient(TourServiceError("down"), REQ)
    pub = FakePublisher()
    handler, sleeps = build(client, FakeModerator([]), pub)
    run(handler)
    assert client.calls == 2
    assert sleeps == [0.1]
    assert len(pub.sent) == 1


def test_llm_hiccup_is_retried():
    moderator = FakeModerator(LLMServerError("overloaded", provider="gemini"), [])
    pub = FakePublisher()
    handler, _ = build(FakeTourClient(REQ), moderator, pub)
    run(handler)
    assert moderator.calls == 2
    assert len(pub.sent) == 1


def test_retries_exhausted_publishes_nothing():
    client = FakeTourClient(TourServiceError("down"))
    pub = FakePublisher()
    handler, sleeps = build(client, FakeModerator([]), pub)
    with pytest.raises(TransientEventError):
        run(handler)
    assert client.calls == 3
    assert sleeps == [0.1, 0.2]
    assert pub.sent == []


def test_tour_not_found_is_permanent_and_not_retried():
    client = FakeTourClient(TourNotFoundError("missing"))
    pub = FakePublisher()
    handler, _ = build(client, FakeModerator([]), pub)
    with pytest.raises(PermanentEventError):
        run(handler)
    assert client.calls == 1
    assert pub.sent == []


def test_unusable_content_is_permanent():
    handler, _ = build(FakeTourClient(TourContentError("too long")), FakeModerator([]), FakePublisher())
    with pytest.raises(PermanentEventError):
        run(handler)


def test_invalid_payload_is_permanent_and_skips_fetch():
    client = FakeTourClient(REQ)
    handler, _ = build(client, FakeModerator([]), FakePublisher())
    with pytest.raises(PermanentEventError):
        run(handler, b'{"tourId":"t1"}')
    assert client.calls == 0


def test_publish_is_retried_without_rerunning_moderation():
    moderator = FakeModerator([])
    pub = FakePublisher(failures=1)
    handler, _ = build(FakeTourClient(REQ), moderator, pub)
    run(handler)
    assert pub.attempts == 2
    assert moderator.calls == 1
    assert len(pub.sent) == 1

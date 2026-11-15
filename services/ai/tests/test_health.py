"""Liveness and readiness routes (issue #345). No network: the indexer handle is a stand-in."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api import health
from app.main import app


class FakeConnection:
    """Shape of aio_pika's RobustConnection that /readyz reads."""

    def __init__(self, connected: bool = True, closed: bool = False) -> None:
        self.is_closed = closed
        self.connected = asyncio.Event()
        if connected:
            self.connected.set()


@pytest.fixture
def client(monkeypatch):
    """TestClient without lifespan (no indexer started); settings and handle set per test."""
    health._down.clear()

    def setup(indexer_enabled: bool, handle=None):
        monkeypatch.setattr(
            health, "get_settings", lambda: SimpleNamespace(chatbot_indexer_enabled=indexer_enabled))
        app.state.chatbot_indexer = handle
        return TestClient(app)

    yield setup
    app.state.chatbot_indexer = None


@pytest.mark.parametrize("path", ["/healthz", "/health"])
def test_liveness_needs_no_token_and_no_dependency(client, path):
    c = client(True, None)  # indexer missing: liveness is still ok
    r = c.get(path)
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "service": "ai"}


def test_readyz_without_indexer_flag_is_ready_with_no_checks(client):
    r = client(False).get("/readyz")
    assert r.status_code == 200
    assert r.json() == {"status": "ready", "service": "ai", "checks": {}}


def test_readyz_with_indexer_connected(client):
    r = client(True, SimpleNamespace(connection=FakeConnection())).get("/readyz")
    assert r.status_code == 200
    assert r.json()["checks"] == {"rabbitmq": "ok"}


@pytest.mark.parametrize(
    "handle",
    [
        None,  # flag on but the indexer did not start
        SimpleNamespace(connection=None),
        SimpleNamespace(connection=FakeConnection(connected=False)),  # robust reconnect in progress
        SimpleNamespace(connection=FakeConnection(closed=True)),
    ],
)
def test_readyz_is_503_while_the_indexer_is_down(client, handle):
    r = client(True, handle).get("/readyz")
    assert r.status_code == 503
    assert r.json() == {"status": "not_ready", "service": "ai", "checks": {"rabbitmq": "down"}}


def test_readyz_recovers_when_the_connection_is_back(client, caplog):
    conn = FakeConnection(connected=False)
    c = client(True, SimpleNamespace(connection=conn))
    with caplog.at_level("INFO", logger="app.api.health"):
        assert c.get("/readyz").status_code == 503
        assert c.get("/readyz").status_code == 503
        conn.connected.set()
        assert c.get("/readyz").status_code == 200
    messages = [r.getMessage() for r in caplog.records if r.name == "app.api.health"]
    assert messages == ["readiness: rabbitmq is down", "readiness: rabbitmq is back"]

"""Liveness and readiness routes (deployment plan task 0.4, issue #345).

GET /healthz  liveness: the process answers, no I/O.
GET /health   alias of /healthz (compose, the gateway and old scripts use it).
GET /readyz   readiness: 503 while a required check is down. The only required check is the
              chatbot indexer's RabbitMQ connection, and only with CHATBOT_INDEXER_ENABLED=true.
              Moderation, translation and chat call providers per request: a provider outage is
              an answer (503 on that route), not a reason to leave the load balancer.
The body never carries error text.
"""

import logging
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.config import get_settings

router = APIRouter()
log = logging.getLogger(__name__)

SERVICE = "ai"
_down: set[str] = set()


def _liveness() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


@router.get("/healthz")
def healthz() -> dict[str, str]:
    return _liveness()


@router.get("/health")
def health() -> dict[str, str]:
    return _liveness()


def indexer_connected(handle: Any) -> bool:
    """True while the indexer's robust AMQP connection is up.

    aio_pika's RobustConnection keeps `is_closed` false while it reconnects; `connected`
    (an asyncio.Event) is cleared on a loss and set again once the connection is back.
    """
    connection = getattr(handle, "connection", None)
    if connection is None or getattr(connection, "is_closed", True):
        return False
    connected = getattr(connection, "connected", None)
    return bool(connected is not None and connected.is_set())


def _log_transitions(checks: dict[str, str]) -> None:
    for name, state in checks.items():
        if state == "down" and name not in _down:
            _down.add(name)
            log.warning("readiness: %s is down", name)
        elif state == "ok" and name in _down:
            _down.discard(name)
            log.info("readiness: %s is back", name)


@router.get("/readyz")
def readyz(request: Request) -> JSONResponse:
    checks: dict[str, str] = {}
    if get_settings().chatbot_indexer_enabled:
        handle = getattr(request.app.state, "chatbot_indexer", None)
        checks["rabbitmq"] = "ok" if indexer_connected(handle) else "down"
    _log_transitions(checks)
    ready = all(state == "ok" for state in checks.values())
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ready" if ready else "not_ready", "service": SERVICE, "checks": checks},
    )

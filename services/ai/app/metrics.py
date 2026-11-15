"""Prometheus metrics of the AI service (deployment task 4.3, issue #400).

Names and labels follow docs/02-design/deployment-plan.md section 10.2. Every
label value comes from a closed set: the helpers below map anything unknown to
`other`, so a label never holds prompt text, an id, a user id or a model answer.

`setup_metrics(app)` adds the HTTP metrics (route templates only, never raw
paths) and serves `GET /metrics` without the internal token. The service runs
one uvicorn worker, so the default in-process registry is enough (no
multiprocess mode).
"""

from __future__ import annotations

import asyncio
from typing import Any

from prometheus_client import Counter, Histogram

from app.llm.errors import (
    LLMBlockedError,
    LLMError,
    LLMRateLimitError,
    LLMServerError,
    LLMTimeoutError,
)

OTHER = "other"

PROVIDERS = frozenset({"gemini", "groq", OTHER})
TASKS = frozenset({"place", "tour", "chat", OTHER})
LLM_OUTCOMES = frozenset({"ok", "429", "5xx", "timeout", "blocked", "error"})
CHAT_OUTCOMES = frozenset({"ok", "invalid", "rate_limited", "unavailable", "error"})
INDEXER_EVENTS = frozenset({"tour.published", "tour.unpublished", OTHER})
INDEXER_RESULTS = frozenset({"indexed", "removed", "skipped", "failed"})

# Outcomes after which the primary provider may hand the request to the secondary.
FALLBACK_OUTCOMES = frozenset({"429", "5xx", "timeout"})

# LLM calls take from a fraction of a second to the provider timeout (tens of seconds).
LLM_BUCKETS = (0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 15.0, 30.0, 60.0)

# Routes left out of the HTTP metrics: the scrape itself and the probes.
EXCLUDED_HANDLERS = ("^/metrics$", "^/health$", "^/healthz$", "^/readyz$")

LLM_REQUESTS = Counter(
    "llm_requests_total",
    "LLM provider calls by provider, task and outcome.",
    ("provider", "task", "outcome"),
)
LLM_DURATION = Histogram(
    "llm_request_duration_seconds",
    "Duration of one LLM provider call, success or failure.",
    ("provider", "task"),
    buckets=LLM_BUCKETS,
)
LLM_FALLBACK = Counter(
    "llm_fallback_total",
    "Requests handed from the primary provider to the secondary one.",
    ("from", "to"),
)
CHAT_REQUESTS = Counter(
    "chatbot_requests_total",
    "POST /chat requests by outcome.",
    ("outcome",),
)
CHAT_FIRST_TOKEN = Histogram(
    "chatbot_first_token_seconds",
    "Time from the start of a POST /chat request to its first streamed token.",
    buckets=LLM_BUCKETS,
)
INDEXER_EVENTS_TOTAL = Counter(
    "chatbot_indexer_events_total",
    "Chatbot indexer messages by event and result.",
    ("event", "result"),
)


def _clamp(value: Any, allowed: frozenset[str], default: str = OTHER) -> str:
    text = value if isinstance(value, str) else ""
    text = text.strip().lower()
    return text if text in allowed else default


def provider_label(value: Any) -> str:
    """`gemini`, `groq` or `other` (from a client's `provider` attribute)."""
    return _clamp(value, PROVIDERS)


def task_label(value: Any) -> str:
    return _clamp(value, TASKS)


def llm_outcome(exc: BaseException) -> str:
    """Outcome label of a failed provider call: 429, 5xx, timeout, blocked or error.

    Handles the errors of `app/llm/errors.py` first, then provider SDK errors
    (LangChain chat models) by type name and HTTP status, without reading
    their messages.
    """
    if isinstance(exc, LLMError):
        if isinstance(exc, LLMRateLimitError):
            return "429"
        if isinstance(exc, LLMServerError):
            return "5xx"
        if isinstance(exc, LLMTimeoutError):
            return "timeout"
        if isinstance(exc, LLMBlockedError):
            return "blocked"
        return "error"
    name = type(exc).__name__
    # RetryError: google api_core gave up retrying before its deadline (a fallback case
    # in app/chatbot/models.py), so it counts as a timeout.
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)) or "Timeout" in name \
            or "DeadlineExceeded" in name or name == "RetryError":
        return "timeout"
    status = getattr(exc, "status_code", None)
    if not isinstance(status, int):
        status = getattr(exc, "code", None)
    if isinstance(status, int) and not isinstance(status, bool):
        if status == 429:
            return "429"
        if 500 <= status <= 599:
            return "5xx"
    if name in ("ResourceExhausted", "TooManyRequests", "RateLimitError"):
        return "429"
    if "ServerError" in name or "ServiceUnavailable" in name:
        return "5xx"
    return "error"


def record_llm_call(provider: Any, task: Any, outcome: str, seconds: float) -> None:
    provider, task = provider_label(provider), task_label(task)
    LLM_REQUESTS.labels(provider, task, _clamp(outcome, LLM_OUTCOMES, "error")).inc()
    LLM_DURATION.labels(provider, task).observe(max(0.0, seconds))


def record_fallback(from_provider: Any, to_provider: Any) -> None:
    LLM_FALLBACK.labels(provider_label(from_provider), provider_label(to_provider)).inc()


def record_chat_request(outcome: str) -> None:
    CHAT_REQUESTS.labels(_clamp(outcome, CHAT_OUTCOMES, "error")).inc()


def observe_first_token(seconds: float) -> None:
    CHAT_FIRST_TOKEN.observe(max(0.0, seconds))


def indexer_event_label(routing_key: Any) -> str:
    """`tour.hidden` is handled as an unpublish, so it is counted as one."""
    if routing_key == "tour.hidden":
        return "tour.unpublished"
    return _clamp(routing_key, INDEXER_EVENTS)


def record_indexer_event(routing_key: Any, result: str) -> None:
    INDEXER_EVENTS_TOTAL.labels(
        indexer_event_label(routing_key), _clamp(result, INDEXER_RESULTS, "failed")
    ).inc()


def setup_metrics(app: Any) -> None:
    """HTTP metrics on route templates and `GET /metrics` (no token, not in OpenAPI).

    The internal token is a dependency of the moderation and chat routers only, so
    the `/metrics` route added here on the app itself stays open.
    """
    from prometheus_fastapi_instrumentator import Instrumentator

    Instrumentator(
        should_group_status_codes=True,
        # Unmatched paths (404) would put raw URLs in a label: leave them out.
        should_ignore_untemplated=True,
        excluded_handlers=list(EXCLUDED_HANDLERS),
    ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)

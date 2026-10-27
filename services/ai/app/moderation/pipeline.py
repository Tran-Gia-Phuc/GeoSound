"""Run one moderation request under a time budget and a shared quota (task #AI-30).

- Time budget: MODERATION_TIMEOUT_SECONDS covers waiting for a slot plus the
  LLM work. Exceeding it raises ModerationTimeoutError.
- Quota (decision D13): a process-wide semaphore of MODERATION_MAX_CONCURRENCY
  slots limits how many LLM-backed moderation calls run at the same time.
- Errors: every LLMError that reaches this point (provider down after fallback,
  bad request, malformed model output) becomes ModerationUnavailableError. The
  API answers 503 for both, so Moderation keeps the case and retries.
  LLMBlockedError never gets here: the services turn it into a Reject.

Timeout and semaphore can be injected, so the module is testable without
touching settings.
"""

import asyncio
import weakref
from collections.abc import Awaitable, Callable
from typing import TypeVar

from app.config import get_settings
from app.llm.errors import LLMError

T = TypeVar("T")


class ModerationUnavailableError(Exception):
    """The moderation could not be completed now (temporary, the caller retries)."""


class ModerationTimeoutError(ModerationUnavailableError):
    """The moderation exceeded its total time budget."""


# One semaphore table per event loop: an asyncio.Semaphore must not be shared
# across loops (the TestClient may run each request in its own loop). Keyed by
# the loop object itself, so an entry disappears when its loop is collected.
_semaphores: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, dict[int, asyncio.Semaphore]]" = (
    weakref.WeakKeyDictionary()
)


def shared_semaphore(size: int | None = None) -> asyncio.Semaphore:
    """Return the process-wide moderation semaphore for the running loop."""
    if size is None:
        size = get_settings().moderation_max_concurrency
    size = max(1, size)
    per_loop = _semaphores.setdefault(asyncio.get_running_loop(), {})
    semaphore = per_loop.get(size)
    if semaphore is None:
        semaphore = per_loop[size] = asyncio.Semaphore(size)
    return semaphore


async def run_moderation(
    work: Callable[[], Awaitable[T]],
    *,
    timeout: float | None = None,
    semaphore: asyncio.Semaphore | None = None,
) -> T:
    """Await work() inside a quota slot and the time budget.

    Raises ModerationTimeoutError on timeout and ModerationUnavailableError on
    any LLMError. Other exceptions propagate unchanged.
    """
    if timeout is None:
        timeout = get_settings().moderation_timeout_seconds
    if semaphore is None:
        semaphore = shared_semaphore()
    try:
        async with asyncio.timeout(timeout):
            async with semaphore:
                return await work()
    except TimeoutError as exc:
        raise ModerationTimeoutError(f"moderation exceeded {timeout}s") from exc
    except LLMError as exc:
        # Keep provider text out of this error; the cause stays chained.
        raise ModerationUnavailableError(f"LLM failure: {type(exc).__name__}") from exc

"""Run a moderation coroutine under a hard time limit (task #AI-21).

Raises ModerationTimeout after PIPELINE_TIMEOUT_SECONDS so the API can answer
503 (temporary) and Moderation retries.
"""

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

T = TypeVar("T")
PIPELINE_TIMEOUT_SECONDS = 30.0


class ModerationTimeout(Exception):
    pass


async def run_with_timeout(
    work: Callable[[], Awaitable[T]], timeout: float = PIPELINE_TIMEOUT_SECONDS
) -> T:
    try:
        return await asyncio.wait_for(work(), timeout=timeout)
    except asyncio.TimeoutError as exc:
        raise ModerationTimeout(f"moderation exceeded {timeout}s") from exc

"""Global chat cap (task #AI-47, chatbot-architecture.md section 7).

`CHAT_GLOBAL_RATE_LIMIT_PER_MIN` LLM-backed chat turns per minute across all
users, counted in this process with a sliding window. The gateway applies the
per-user limits; this cap keeps the Gemini quota (shared with moderation) safe
even when many users chat at once. The clock is injectable for tests.
"""

import math
import time
from collections import deque
from collections.abc import Callable


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: float = 60.0,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.limit = limit
        self.window = window_seconds
        self.clock = clock
        self._hits: deque[float] = deque()

    def try_acquire(self) -> tuple[bool, int]:
        """Take one slot. Returns (allowed, retry_after_seconds)."""
        now = self.clock()
        while self._hits and self._hits[0] <= now - self.window:
            self._hits.popleft()
        if self.limit <= 0:
            return False, math.ceil(self.window)
        if len(self._hits) < self.limit:
            self._hits.append(now)
            return True, 0
        return False, max(1, math.ceil(self._hits[0] + self.window - now))


class ChatBusyError(Exception):
    """The chat turn cannot use the LLM now (global cap or no free AI slot): HTTP 429."""

    def __init__(self, retry_after: int, reason: str = "busy") -> None:
        super().__init__(reason)
        self.retry_after = max(1, int(retry_after))
        self.reason = reason

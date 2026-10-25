import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from aio_pika.exceptions import AMQPError
from pydantic import ValidationError

from app.config import get_settings
from app.events.schemas import TourSubmitted, outcome_event
from app.events.tour_client import (
    TourContentError,
    TourNotFoundError,
    TourServiceError,
)
from app.llm.errors import LLMError
from app.moderation.pipeline import run_moderation

logger = logging.getLogger(__name__)

T = TypeVar("T")

_MODERATION_TRANSIENT = (LLMError, TourServiceError)
_PUBLISH_TRANSIENT = (AMQPError, OSError)


class PermanentEventError(Exception):
    """The message can never be processed (bad payload, tour missing or unusable)."""


class TransientEventError(Exception):
    """Retries ran out on a temporary failure (LLM or tour service down)."""


class ModerationEventHandler:
    """Turns one tour.submitted message into a tour.ai_passed / tour.ai_rejected event.

    The shared JS consume() helper drops a message when its handler fails, so
    this handler retries by itself. When it finally raises, the consumer sends
    the message to the dead-letter queue and publishes nothing: the tour then
    stays in "Waiting for AI" (UC#15 E2).
    """

    def __init__(
        self,
        tour_client: Any,
        moderator: Any,
        publisher: Any,
        *,
        max_attempts: int | None = None,
        retry_delay: float | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        settings = get_settings()
        self.tour_client = tour_client
        self.moderator = moderator
        self.publisher = publisher
        self.max_attempts = max_attempts or settings.event_max_attempts
        self.retry_delay = settings.event_retry_delay_seconds if retry_delay is None else retry_delay
        self._sleep = sleep

    async def handle(self, body: bytes) -> None:
        try:
            event = TourSubmitted.model_validate_json(body)
        except ValidationError as exc:
            raise PermanentEventError("Invalid tour.submitted payload") from exc

        response = await self._retry(
            lambda: self._moderate(event.tour_id), "moderate", _MODERATION_TRANSIENT
        )
        name, payload = outcome_event(response)
        await self._retry(
            lambda: self.publisher.publish(name, payload), "publish", _PUBLISH_TRANSIENT
        )
        logger.info("moderated tour=%s verdict=%s -> %s", event.tour_id, response.verdict, name)

    async def _moderate(self, tour_id: str):
        try:
            request = await self.tour_client.fetch_for_moderation(tour_id)
        except (TourNotFoundError, TourContentError) as exc:
            raise PermanentEventError(str(exc)) from exc
        return await run_moderation(self.moderator, request)

    async def _retry(
        self,
        fn: Callable[[], Awaitable[T]],
        label: str,
        transient: tuple[type[BaseException], ...],
    ) -> T:
        last: BaseException | None = None
        for attempt in range(1, self.max_attempts + 1):
            try:
                return await fn()
            except transient as exc:
                last = exc
                logger.warning("%s attempt %d/%d failed: %s", label, attempt, self.max_attempts, exc)
                if attempt < self.max_attempts:
                    await self._sleep(self.retry_delay * 2 ** (attempt - 1))
        raise TransientEventError(
            f"{label} failed after {self.max_attempts} attempts: {last}"
        ) from last

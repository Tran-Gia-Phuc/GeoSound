"""Moderation endpoints (task #AI-30). POST /moderate/tour follows in #AI-31.

Every route requires the internal service token (#AI-28).
422 is raised by FastAPI for invalid input (permanent, do not retry).
503 means the moderation could not finish now (all providers failed, malformed
model output, or the time budget ran out): temporary, Moderation retries.
"""

import logging
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException

from app.middleware.auth import require_internal_token
from app.moderation.pipeline import ModerationUnavailableError, run_moderation
from app.moderation.place_service import PlaceModerator
from app.moderation.schema import PlaceModerationRequest, PlaceModerationResponse

logger = logging.getLogger(__name__)

# Never leak provider details to the caller; they are logged instead.
UNAVAILABLE_DETAIL = "Moderation is temporarily unavailable; retry later"

router = APIRouter(dependencies=[Depends(require_internal_token)])


def describe_failure(exc: BaseException) -> str:
    """Safe log text for a failure: class names, provider and HTTP status only.

    Provider messages are never logged here: they may echo request details.
    """
    cause = exc.__cause__ or exc
    parts = [type(exc).__name__]
    if cause is not exc:
        parts.append(f"cause={type(cause).__name__}")
    provider = getattr(cause, "provider", None)
    if provider:
        parts.append(f"provider={provider}")
    status = getattr(cause, "status_code", None)
    if status:
        parts.append(f"status={status}")
    return " ".join(parts)


@lru_cache
def get_place_moderator() -> PlaceModerator:
    return PlaceModerator()


@router.post("/moderate/place", response_model=PlaceModerationResponse)
async def moderate_place(
    request: PlaceModerationRequest,
    moderator: PlaceModerator = Depends(get_place_moderator),
) -> PlaceModerationResponse:
    """Scan the name and description of one place with one LLM call."""
    try:
        return await run_moderation(lambda: moderator.moderate_place(request))
    except ModerationUnavailableError as exc:
        logger.error("moderation place=%s unavailable: %s", request.place_id, describe_failure(exc))
        raise HTTPException(status_code=503, detail=UNAVAILABLE_DETAIL) from exc

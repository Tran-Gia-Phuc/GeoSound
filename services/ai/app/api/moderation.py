import logging
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException

from app.llm.errors import LLMError
from app.moderation.pipeline import run_moderation
from app.moderation.schema import ModerationRequest, ModerationResponse
from app.moderation.service import TextModerator

logger = logging.getLogger(__name__)

router = APIRouter()


@lru_cache
def get_moderator() -> TextModerator:
    return TextModerator()


@router.post("/moderate", response_model=ModerationResponse)
async def moderate(
    request: ModerationRequest,
    moderator: TextModerator = Depends(get_moderator),
) -> ModerationResponse:
    """Scan the text of a tour and return Pass / Warning / Reject with reasons.

    422 is raised by FastAPI for invalid input. 503 means every LLM provider
    failed, so the caller must keep the tour in "Waiting for AI" (UC#15 E2).
    """
    try:
        response = await run_moderation(moderator, request)
    except LLMError as exc:
        logger.error("moderation tour=%s failed: %s", request.tour_id, exc)
        raise HTTPException(
            status_code=503,
            detail="All LLM providers failed; the tour stays in Waiting for AI",
        ) from exc
    return response

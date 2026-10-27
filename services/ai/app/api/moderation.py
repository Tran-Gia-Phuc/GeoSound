import logging
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException

from app.llm.errors import LLMError
from app.middleware.auth import require_internal_token
from app.moderation.policy import build_response
from app.moderation.schema import ModerationRequest, ModerationResponse
from app.moderation.service import TextModerator

logger = logging.getLogger(__name__)

# Every moderation route requires the internal service token (#AI-28).
router = APIRouter(dependencies=[Depends(require_internal_token)])


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
        findings = await moderator.scan_tour(request)
    except LLMError as exc:
        logger.error("moderation tour=%s failed: %s", request.tour_id, exc)
        raise HTTPException(
            status_code=503,
            detail="All LLM providers failed; the tour stays in Waiting for AI",
        ) from exc
    return build_response(request.tour_id, findings)

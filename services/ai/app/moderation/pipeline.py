import asyncio

from app.config import get_settings
from app.llm.errors import LLMTimeoutError
from app.moderation.policy import build_response
from app.moderation.schema import ModerationRequest, ModerationResponse
from app.moderation.service import TextModerator


async def run_moderation(
    moderator: TextModerator,
    request: ModerationRequest,
    timeout: float | None = None,
) -> ModerationResponse:
    """Scan a whole tour within a hard time limit and build the verdict.

    A timeout raises LLMTimeoutError, so callers handle it like any other
    LLM outage (HTTP 503, or retry/dead-letter for events).
    """
    limit = get_settings().moderation_timeout_seconds if timeout is None else timeout
    try:
        findings = await asyncio.wait_for(moderator.scan_tour(request), timeout=limit)
    except asyncio.TimeoutError as exc:
        raise LLMTimeoutError(
            f"Moderation exceeded {limit}s", provider="moderation"
        ) from exc
    return build_response(request.tour_id, findings)

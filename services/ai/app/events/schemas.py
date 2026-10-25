"""Pydantic mirror of the shared event contract (shared/events/index.js).

The zod schemas in JS and the models below must stay identical: when the
contract changes, update both. Aliases keep the camelCase wire format.
"""

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.moderation.schema import ModerationResponse, Verdict

TOUR_SUBMITTED = "tour.submitted"
TOUR_AI_PASSED = "tour.ai_passed"
TOUR_AI_REJECTED = "tour.ai_rejected"

MAX_REASON_LENGTH = 1000


class _EventBase(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    tour_id: str = Field(alias="tourId", min_length=1)
    at: str | None = None


class TourSubmitted(_EventBase):
    contributor_id: str = Field(alias="contributorId", min_length=1)


class TourAiPassed(_EventBase):
    # Proposed extension (spec 3.5, needs team agreement). zod strips unknown
    # keys, so consumers that do not know them keep working.
    warning: bool | None = None
    reasons: list[str] | None = None


class TourAiRejected(_EventBase):
    reason: str


def utc_now_iso() -> str:
    # zod's z.string().datetime() only accepts the "Z" suffix (no +07:00 offsets).
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _format_reasons(response: ModerationResponse) -> list[str]:
    return [f"{r.field}: {r.message}" for r in response.reasons]


def outcome_event(response: ModerationResponse) -> tuple[str, dict[str, Any]]:
    """Map a moderation response to the (routing key, payload) to publish."""
    now = utc_now_iso()
    if response.verdict == Verdict.REJECT:
        reason = "; ".join(_format_reasons(response))[:MAX_REASON_LENGTH]
        event: _EventBase = TourAiRejected(tour_id=response.tour_id, at=now, reason=reason)
        name = TOUR_AI_REJECTED
    elif response.verdict == Verdict.WARNING:
        event = TourAiPassed(
            tour_id=response.tour_id, at=now, warning=True, reasons=_format_reasons(response)
        )
        name = TOUR_AI_PASSED
    else:
        event = TourAiPassed(tour_id=response.tour_id, at=now)
        name = TOUR_AI_PASSED
    return name, event.model_dump(by_alias=True, exclude_none=True)

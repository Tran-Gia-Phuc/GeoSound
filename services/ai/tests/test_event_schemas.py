import re

import pytest
from pydantic import ValidationError

from app.events.schemas import (
    TOUR_AI_PASSED,
    TOUR_AI_REJECTED,
    TourSubmitted,
    outcome_event,
)
from app.moderation.schema import ModerationResponse

ISO_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

R1 = {"field": "stops[1].description", "category": "scam", "message": "Asks for a deposit"}
R2 = {"field": "title", "category": "misleading", "message": "Fake award"}


def resp(verdict, reasons=()):
    return ModerationResponse(tour_id="t1", verdict=verdict, reasons=list(reasons))


def test_parse_submitted():
    raw = '{"tourId":"t1","contributorId":"u1","at":"2026-10-25T10:00:00.000Z"}'
    ev = TourSubmitted.model_validate_json(raw)
    assert ev.tour_id == "t1"
    assert ev.contributor_id == "u1"


def test_submitted_ignores_unknown_keys():
    ev = TourSubmitted.model_validate({"tourId": "t1", "contributorId": "u1", "extra": 1})
    assert ev.tour_id == "t1"


@pytest.mark.parametrize(
    "payload",
    [{"tourId": "t1"}, {"contributorId": "u1"}, {"tourId": "", "contributorId": "u1"}, {}],
)
def test_submitted_invalid(payload):
    with pytest.raises(ValidationError):
        TourSubmitted.model_validate(payload)


def test_invalid_json_is_rejected():
    with pytest.raises(ValidationError):
        TourSubmitted.model_validate_json("not json")


def test_pass_event():
    name, payload = outcome_event(resp("Pass"))
    assert name == TOUR_AI_PASSED
    assert set(payload) == {"tourId", "at"}
    assert payload["tourId"] == "t1"
    assert ISO_Z.match(payload["at"])


def test_warning_event_carries_flag_and_reasons():
    name, payload = outcome_event(resp("Warning", [R1, R2]))
    assert name == TOUR_AI_PASSED
    assert payload["warning"] is True
    assert payload["reasons"] == [
        "stops[1].description: Asks for a deposit",
        "title: Fake award",
    ]


def test_reject_event_joins_reasons_into_one_string():
    name, payload = outcome_event(resp("Reject", [R1, R2]))
    assert name == TOUR_AI_REJECTED
    assert payload["reason"] == "stops[1].description: Asks for a deposit; title: Fake award"
    assert "warning" not in payload


def test_reject_reason_is_capped():
    long_reason = {**R1, "message": "x" * 500}
    _, payload = outcome_event(resp("Reject", [long_reason] * 5))
    assert len(payload["reason"]) == 1000

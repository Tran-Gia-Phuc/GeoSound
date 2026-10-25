import pytest

from app.moderation.policy import build_response, decide
from app.moderation.schema import Category, Verdict
from app.moderation.service import Finding

REJECT = 0.8
WARNING = 0.4


def mk(severity, field="description", category=Category.SCAM, message="m"):
    return Finding(field=field, category=category, severity=severity, message=message)


def verdict(findings):
    return decide(findings, REJECT, WARNING)


def test_clean_is_pass():
    assert verdict([]) == Verdict.PASS


def test_below_warning_threshold_is_pass():
    assert verdict([mk(0.39)]) == Verdict.PASS


def test_borderline_is_warning():
    assert verdict([mk(0.6)]) == Verdict.WARNING


def test_severe_is_reject():
    assert verdict([mk(0.95, category=Category.VIOLENCE)]) == Verdict.REJECT


def test_threshold_boundaries():
    assert verdict([mk(0.8)]) == Verdict.REJECT
    assert verdict([mk(0.4)]) == Verdict.WARNING


def test_worst_finding_wins():
    findings = [mk(0.5, field="title"), mk(0.9, field="stops[1].description")]
    assert verdict(findings) == Verdict.REJECT


def test_reasons_only_flagged_and_sorted():
    findings = [
        mk(0.2, field="title"),
        mk(0.5, field="description", category=Category.MISLEADING),
        mk(0.9, field="stops[1].description"),
    ]
    resp = build_response("t1", findings, REJECT, WARNING)
    assert resp.verdict == Verdict.REJECT
    assert [r.field for r in resp.reasons] == ["stops[1].description", "description"]


def test_pass_has_no_reasons():
    resp = build_response("t1", [mk(0.1)], REJECT, WARNING)
    assert resp.verdict == Verdict.PASS
    assert resp.reasons == []


def test_custom_thresholds():
    assert decide([mk(0.6)], reject_threshold=0.5, warning_threshold=0.2) == Verdict.REJECT


@pytest.mark.parametrize("reject,warning", [(0.4, 0.8), (0.5, 0.5), (1.2, 0.4)])
def test_invalid_thresholds(reject, warning):
    with pytest.raises(ValueError):
        decide([mk(0.5)], reject_threshold=reject, warning_threshold=warning)

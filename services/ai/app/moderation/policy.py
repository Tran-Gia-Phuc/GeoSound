"""Verdict rules for text moderation.

The LLM only reports findings (category + severity). It never decides. This
module turns findings into Pass / Warning / Reject using two thresholds:

    worst severity >= reject threshold   -> Reject
    worst severity >= warning threshold  -> Warning (a human Admin decides)
    otherwise                            -> Pass

Any doubt ends up with a human (Warning), never with an automatic Pass.
"""

from collections.abc import Sequence

from pydantic import BaseModel

from app.config import get_settings
from app.moderation.schema import Category, Verdict


class Finding(BaseModel):
    """One problem reported by the LLM (before the policy decides)."""

    field: str
    category: Category
    severity: float
    message: str


def resolve_thresholds(
    reject_threshold: float | None = None,
    warning_threshold: float | None = None,
) -> tuple[float, float]:
    """Return (reject, warning), falling back to the environment settings."""
    settings = get_settings()
    reject = settings.moderation_reject_threshold if reject_threshold is None else reject_threshold
    warning = settings.moderation_warning_threshold if warning_threshold is None else warning_threshold
    if not 0.0 <= warning < reject <= 1.0:
        raise ValueError(
            f"Invalid thresholds: need 0 <= warning < reject <= 1 (got warning={warning}, reject={reject})"
        )
    return reject, warning


def decide(
    findings: Sequence[Finding],
    reject_threshold: float | None = None,
    warning_threshold: float | None = None,
) -> Verdict:
    reject, warning = resolve_thresholds(reject_threshold, warning_threshold)
    worst = max_severity(findings)
    if worst >= reject:
        return Verdict.REJECT
    if worst >= warning:
        return Verdict.WARNING
    return Verdict.PASS


def flagged(findings: Sequence[Finding], warning_threshold: float) -> list[Finding]:
    """Findings at or above the warning threshold, worst first (they become reasons)."""
    return sorted(
        (f for f in findings if f.severity >= warning_threshold),
        key=lambda f: f.severity,
        reverse=True,
    )


def max_severity(findings: Sequence[Finding]) -> float:
    return max((f.severity for f in findings), default=0.0)


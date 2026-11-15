"""Tour moderation: ONE text-only LLM call per tour (task #AI-31).

Input: title, description, city, type, duration and, for coherence only, each
place's name, type and the first TOUR_PLACE_SNIPPET (300) characters of its
description. Fields in reasons: "title", "description", "coherence".
A tour scan never rescans its places individually: places are moderated on
their own through POST /moderate/place.

Flow mirrors place_service: build prompt (validator.wrap) -> one LLM call ->
parse findings -> policy decides. LLMBlockedError is a Reject with category
"other"; other LLM errors propagate (the endpoint answers 503, Moderation retries).
"""

import logging
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from app.llm.errors import LLMBlockedError
from app.llm.fallback import FallbackLLM
from app.llm.gemini_client import GeminiClient
from app.moderation import policy
from app.moderation.place_service import (
    blocked_message,
    blocked_model,
    call_llm,
    fallback_message,
    label,
    parse_findings,
)
from app.moderation.policy import Finding
from app.moderation.schema import (
    Category,
    TourModerationRequest,
    TourModerationResponse,
    TourPlaceInput,
    TourReason,
)
from app.moderation.validator import TOUR_PLACE_SNIPPET, clip, sanitize_text, wrap

logger = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).parent / "prompts" / "tour_moderation.txt"

TOUR_FIELDS = ("title", "description", "coherence")
DEFAULT_FIELD = "description"

_LANGUAGE_NAMES = {"vi": "Vietnamese", "en": "English"}

# Tour wording for the categories whose place text would not fit a tour.
_TOUR_FALLBACK_MESSAGES: dict[str, dict[Category, str]] = {
    "en": {Category.IRRELEVANT: "The content does not look like a travel tour."},
    "vi": {Category.IRRELEVANT: "Nội dung không giống một tour du lịch."},
}


def tour_fallback_message(category: Category, language: str) -> str:
    """Message used when the model gives none; tour wording where it differs."""
    messages = _TOUR_FALLBACK_MESSAGES.get(language, _TOUR_FALLBACK_MESSAGES["en"])
    return messages.get(category) or fallback_message(category, language)


def _one_line(text: str | None) -> str:
    """Sanitise user text and collapse it to a single line."""
    return " ".join(sanitize_text(text or "").split())


def render_place(index: int, place: TourPlaceInput) -> str:
    """One stop of the <places> block: name, optional type, description snippet."""
    head = f"{index}. Name: {_one_line(place.name)}"
    place_type = label(place.type)
    if place_type:
        head += f" | Type: {place_type}"
    # Sanitise first, then cut: the snippet limit applies to what the model sees.
    snippet = clip(_one_line(place.description), TOUR_PLACE_SNIPPET)
    return f"{head}\n   Description: {snippet}"


def build_tour_prompt(request: TourModerationRequest) -> str:
    """User message for the single LLM call. Every user value sits inside <tour>."""
    reply_language = _LANGUAGE_NAMES.get(request.language.value, "English")
    lines = [f"Write each finding message in {reply_language}.", "", "<tour>"]
    city = label(request.city)
    tour_type = label(request.type)
    if city:
        lines.append(f"City: {city}")
    if tour_type:
        lines.append(f"Type: {tour_type}")
    if request.duration_minutes is not None:
        lines.append(f"Duration: {request.duration_minutes} minutes")
    # wrap() sanitises the text so it cannot open or close any prompt tag.
    lines.append(wrap("title", request.title))
    lines.append(wrap("description", request.description))
    places = "\n".join(render_place(i, p) for i, p in enumerate(request.places, start=1))
    lines.append(wrap("places", places or "(no places)"))
    lines.append("</tour>")
    return "\n".join(lines)


def build_tour_response(
    tour_id: str,
    findings: Sequence[Finding],
    model: str,
    reject_threshold: float | None = None,
    warning_threshold: float | None = None,
) -> TourModerationResponse:
    reject, warning = policy.resolve_thresholds(reject_threshold, warning_threshold)
    reasons = [
        TourReason(field=f.field, category=f.category, message=f.message)
        for f in policy.flagged(findings, warning)
    ]
    return TourModerationResponse(
        tour_id=tour_id,
        verdict=policy.decide(findings, reject, warning),
        severity=policy.max_severity(findings),
        reasons=reasons,
        model=model,
    )


class TourModerator:
    """Moderates the text of one tour (and its coherence) with exactly one LLM call."""

    def __init__(self, llm: Any = None) -> None:
        # BLOCK_NONE: Gemini must be able to read harmful text in order to flag it.
        self.llm = llm or FallbackLLM(primary=GeminiClient(safety_block_none=True))
        self.system_prompt = PROMPT_PATH.read_text(encoding="utf-8")

    async def scan_tour(self, request: TourModerationRequest) -> tuple[list[Finding], str]:
        """Return (raw findings, model name). Fields are title, description or coherence."""
        language = request.language.value
        prompt = build_tour_prompt(request)
        try:
            data, model = await call_llm(self.llm, prompt, self.system_prompt)
        except LLMBlockedError as exc:
            # Text so harmful that the provider refuses to read it: reject it
            # instead of failing with a retryable infrastructure error.
            logger.warning("moderation tour=%s blocked by provider: %s", request.tour_id, exc)
            blocked = Finding(
                field=DEFAULT_FIELD,
                category=Category.OTHER,
                severity=1.0,
                message=blocked_message(language),
            )
            return [blocked], blocked_model(self.llm, exc)
        findings = parse_findings(
            data,
            language,
            fields=TOUR_FIELDS,
            default_field=DEFAULT_FIELD,
            fallback=tour_fallback_message,
        )
        return findings, model

    async def moderate_tour(self, request: TourModerationRequest) -> TourModerationResponse:
        findings, model = await self.scan_tour(request)
        response = build_tour_response(request.tour_id, findings, model)
        logger.info(
            "moderation tour=%s places=%d verdict=%s severity=%.2f model=%s",
            request.tour_id,
            len(request.places),
            response.verdict,
            response.severity,
            model,
        )
        return response


async def moderate_tour(request: TourModerationRequest, llm: Any = None) -> TourModerationResponse:
    return await TourModerator(llm=llm).moderate_tour(request)

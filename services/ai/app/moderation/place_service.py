"""Place moderation: ONE LLM call for name + description (task #AI-29).

Flow: build prompt (validator.wrap) -> llm.generate_json -> parse findings ->
policy decides. The LLM only reports findings; policy.py decides the verdict.
LLMBlockedError is a Reject with category "other", never an infrastructure error.
Other LLM errors (including malformed output) propagate: the endpoint answers
503 and Moderation owns the retry, so this module never calls the LLM twice.
Phase 2 (#AI-41) adds images through images.py; until then images_checked = 0.
"""

import logging
import math
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from app.llm.errors import LLMBlockedError, LLMResponseError
from app.llm.fallback import FallbackLLM
from app.llm.gemini_client import GeminiClient
from app.moderation import policy
from app.moderation.schema import (
    Category,
    PlaceModerationRequest,
    PlaceModerationResponse,
    PlaceReason,
)
from app.moderation.service import Finding
from app.moderation.validator import sanitize_text, wrap

logger = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).parent / "prompts" / "place_moderation.txt"

PLACE_FIELDS = ("name", "description")
DEFAULT_FIELD = "description"
LABEL_MAX = 100  # type and city are short context labels
MAX_MESSAGE_LENGTH = 500
UNKNOWN_MODEL = "unknown"

_LANGUAGE_NAMES = {"vi": "Vietnamese", "en": "English"}

# Used when the model gives no message, and for provider-blocked text.
_FALLBACK_MESSAGES: dict[str, dict[Category, str]] = {
    "en": {
        Category.HATE: "The content may contain hate speech or discrimination.",
        Category.VIOLENCE: "The content may glorify or incite violence.",
        Category.SEXUAL: "The content may contain sexual material.",
        Category.SCAM: "The content may be a scam or ask travelers for money or personal data.",
        Category.MISLEADING: "The content may contain false or misleading claims.",
        Category.IRRELEVANT: "The content does not look like a travel place.",
        Category.OTHER: "The content needs review by a moderator.",
    },
    "vi": {
        Category.HATE: "Nội dung có thể chứa phát ngôn thù ghét hoặc phân biệt đối xử.",
        Category.VIOLENCE: "Nội dung có thể cổ vũ hoặc kích động bạo lực.",
        Category.SEXUAL: "Nội dung có thể chứa yếu tố tình dục.",
        Category.SCAM: "Nội dung có thể là lừa đảo hoặc yêu cầu tiền, thông tin cá nhân của du khách.",
        Category.MISLEADING: "Nội dung có thể chứa thông tin sai lệch hoặc gây hiểu lầm.",
        Category.IRRELEVANT: "Nội dung không giống một địa điểm du lịch.",
        Category.OTHER: "Nội dung cần được người kiểm duyệt xem xét.",
    },
}
_BLOCKED_MESSAGES = {
    "en": "The AI provider refused to process this text (content policy block).",
    "vi": "Nhà cung cấp AI từ chối xử lý nội dung này (bị chặn theo chính sách nội dung).",
}


def fallback_message(category: Category, language: str) -> str:
    messages = _FALLBACK_MESSAGES.get(language, _FALLBACK_MESSAGES["en"])
    return messages[category]


def _label(text: str | None) -> str:
    """Sanitise a short context label (type, city) and keep it on one line."""
    cleaned = " ".join(sanitize_text(text or "").split())
    return cleaned[:LABEL_MAX]


def build_place_prompt(request: PlaceModerationRequest) -> str:
    """User message for the single LLM call. Every user value sits inside <place>."""
    reply_language = _LANGUAGE_NAMES.get(request.language.value, "English")
    lines = [f"Write each finding message in {reply_language}.", "", "<place>"]
    place_type = _label(request.type)
    city = _label(request.city)
    if place_type:
        lines.append(f"Type: {place_type}")
    if city:
        lines.append(f"City: {city}")
    # wrap() sanitises the text so it cannot open or close any prompt tag.
    lines.append(wrap("name", request.name))
    lines.append(wrap("description", request.description))
    lines.append("</place>")
    return "\n".join(lines)


def _parse_category(value: Any) -> Category:
    if isinstance(value, str):
        try:
            return Category(value.strip().lower())
        except ValueError:
            pass
    return Category.OTHER


def _parse_field(value: Any) -> str:
    if isinstance(value, str) and value.strip().lower() in PLACE_FIELDS:
        return value.strip().lower()
    # Never drop a finding because of a bad field name: keep the signal.
    return DEFAULT_FIELD


def _parse_severity(value: Any) -> float:
    if isinstance(value, bool):
        raise LLMResponseError("Finding severity is not a number", provider="moderation")
    try:
        severity = float(value)
    except (TypeError, ValueError) as exc:
        raise LLMResponseError(
            "Finding severity is not a number", provider="moderation"
        ) from exc
    if math.isnan(severity):
        raise LLMResponseError("Finding severity is not a number", provider="moderation")
    return min(max(severity, 0.0), 1.0)


def parse_findings(data: Any, language: str) -> list[Finding]:
    """Turn the model JSON into findings.

    Lenient where it is safe (unknown category -> "other", unknown field ->
    "description", severity clamped to 0..1, missing message -> fallback text).
    Strict where a lost signal could become a wrong Pass: a body that is not
    {"findings": [...]}, or a finding without a numeric severity, raises
    LLMResponseError (temporary, Moderation retries).
    """
    if not isinstance(data, dict):
        raise LLMResponseError("Model JSON is not an object", provider="moderation")
    raw = data.get("findings", [])
    if raw is None:
        raw = []
    if not isinstance(raw, list):
        raise LLMResponseError("Model JSON findings is not a list", provider="moderation")

    findings: list[Finding] = []
    for item in raw:
        if not isinstance(item, dict):
            raise LLMResponseError("Model finding is not an object", provider="moderation")
        category = _parse_category(item.get("category"))
        message = item.get("message")
        message = message.strip()[:MAX_MESSAGE_LENGTH] if isinstance(message, str) else ""
        findings.append(
            Finding(
                field=_parse_field(item.get("field")),
                category=category,
                severity=_parse_severity(item.get("severity")),
                message=message or fallback_message(category, language),
            )
        )
    return findings


def build_place_response(
    place_id: str,
    findings: Sequence[Finding],
    model: str,
    reject_threshold: float | None = None,
    warning_threshold: float | None = None,
) -> PlaceModerationResponse:
    reject, warning = policy.resolve_thresholds(reject_threshold, warning_threshold)
    reasons = [
        PlaceReason(field=f.field, category=f.category, message=f.message)
        for f in policy.flagged(findings, warning)
    ]
    return PlaceModerationResponse(
        place_id=place_id,
        verdict=policy.decide(findings, reject, warning),
        severity=policy.max_severity(findings),
        reasons=reasons,
        images_checked=0,
        model=model,
    )


class PlaceModerator:
    """Moderates the text of one place with exactly one LLM call."""

    def __init__(self, llm: Any = None) -> None:
        # BLOCK_NONE: Gemini must be able to read harmful text in order to flag it.
        self.llm = llm or FallbackLLM(primary=GeminiClient(safety_block_none=True))
        self.system_prompt = PROMPT_PATH.read_text(encoding="utf-8")

    async def _call_llm(self, prompt: str) -> tuple[Any, str]:
        with_model = getattr(self.llm, "generate_json_with_model", None)
        if with_model is not None:
            return await with_model(prompt, system=self.system_prompt, temperature=0.0)
        data = await self.llm.generate_json(prompt, system=self.system_prompt, temperature=0.0)
        return data, getattr(self.llm, "model", UNKNOWN_MODEL)

    def _blocked_model(self, exc: LLMBlockedError) -> str:
        """Model that refused the text. Blocked content never falls back, so with
        FallbackLLM it is always the primary client's model."""
        primary = getattr(self.llm, "primary", None)
        model = getattr(primary, "model", None) or getattr(self.llm, "model", None)
        return model or exc.provider or UNKNOWN_MODEL

    async def scan_place(self, request: PlaceModerationRequest) -> tuple[list[Finding], str]:
        """Return (raw findings, model name). Fields are "name" or "description"."""
        language = request.language.value
        prompt = build_place_prompt(request)
        try:
            data, model = await self._call_llm(prompt)
        except LLMBlockedError as exc:
            # Text so harmful that the provider refuses to read it: reject it
            # instead of failing with a retryable infrastructure error.
            logger.warning("moderation place=%s blocked by provider: %s", request.place_id, exc)
            blocked = Finding(
                field=DEFAULT_FIELD,
                category=Category.OTHER,
                severity=1.0,
                message=_BLOCKED_MESSAGES.get(language, _BLOCKED_MESSAGES["en"]),
            )
            return [blocked], self._blocked_model(exc)
        return parse_findings(data, language), model

    async def moderate_place(self, request: PlaceModerationRequest) -> PlaceModerationResponse:
        findings, model = await self.scan_place(request)
        response = build_place_response(request.place_id, findings, model)
        logger.info(
            "moderation place=%s verdict=%s severity=%.2f model=%s",
            request.place_id,
            response.verdict,
            response.severity,
            model,
        )
        return response


async def moderate_place(request: PlaceModerationRequest, llm: Any = None) -> PlaceModerationResponse:
    return await PlaceModerator(llm=llm).moderate_place(request)

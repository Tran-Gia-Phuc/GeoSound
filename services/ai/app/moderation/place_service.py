"""Place moderation: ONE LLM call for name + description (task #AI-29).

Flow: build prompt (validator.wrap) -> llm.generate_json -> parse findings ->
policy decides. The LLM only reports findings; policy.py decides the verdict.
LLMBlockedError is a Reject with category "other", never an infrastructure error.
Other LLM errors (including malformed output) propagate: the endpoint answers
503 and Moderation owns the retry, so this module never calls the LLM twice.
Phase 2 (#AI-41): images are fetched first (images.py). A temporary image
problem raises ImagesUnavailableError (503, no LLM call). A permanently
unreadable image is left out and gives a Warning finding on images[n], so a
place is never Passed with unchecked images. The readable images go inline in
the same single LLM call (Gemini only); images_checked counts them.
"""

import logging
import math
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from app.llm.errors import LLMBlockedError, LLMResponseError
from app.llm.fallback import FallbackLLM
from app.llm.gemini_client import GeminiClient
from app.moderation import policy
from app.moderation.images import (
    FetchedImage,
    ImageFetcher,
    ImageProblem,
    ImagesUnavailableError,
    make_image_fetcher,
)
from app.moderation.policy import Finding
from app.moderation.schema import (
    Category,
    PlaceModerationRequest,
    PlaceModerationResponse,
    PlaceReason,
)
from app.moderation.validator import sanitize_text, wrap

logger = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).parent / "prompts" / "place_moderation.txt"

PLACE_FIELDS = ("name", "description")
DEFAULT_FIELD = "description"
LABEL_MAX = 100  # type and city are short context labels
MAX_MESSAGE_LENGTH = 500
UNKNOWN_MODEL = "unknown"
CAPTION_MAX = 300
# Severity of an image that could not be checked: a Warning for a human.
UNCHECKED_IMAGE_SEVERITY = 0.5

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


_UNCHECKED_IMAGE_MESSAGES = {
    "en": "Image {n} could not be checked automatically; a moderator must review it.",
    "vi": "Không thể kiểm tra tự động ảnh {n}; người kiểm duyệt cần xem xét.",
}


def unchecked_image_severity() -> float:
    """At least a Warning under the configured thresholds, never a Reject."""
    reject, warning = policy.resolve_thresholds()
    if warning <= UNCHECKED_IMAGE_SEVERITY < reject:
        return UNCHECKED_IMAGE_SEVERITY
    return warning


def unchecked_image_message(index: int, language: str) -> str:
    """Message for images[index]; the number shown to humans is 1-based."""
    template = _UNCHECKED_IMAGE_MESSAGES.get(language, _UNCHECKED_IMAGE_MESSAGES["en"])
    return template.format(n=index + 1)


def image_field(index: int) -> str:
    return f"images[{index}]"


def fallback_message(category: Category, language: str) -> str:
    messages = _FALLBACK_MESSAGES.get(language, _FALLBACK_MESSAGES["en"])
    return messages[category]


def blocked_message(language: str) -> str:
    return _BLOCKED_MESSAGES.get(language, _BLOCKED_MESSAGES["en"])


def label(text: str | None) -> str:
    """Sanitise a short context label (type, city) and keep it on one line."""
    cleaned = " ".join(sanitize_text(text or "").split())
    return cleaned[:LABEL_MAX]


def build_place_prompt(
    request: PlaceModerationRequest, image_indexes: Sequence[int] = ()
) -> str:
    """User message for the single LLM call. Every user value sits inside <place>.

    `image_indexes` are the original (0-based) indexes of the images attached
    to the call, in attachment order.
    """
    reply_language = _LANGUAGE_NAMES.get(request.language.value, "English")
    lines = [f"Write each finding message in {reply_language}."]
    if image_indexes:
        attached = ", ".join(image_field(i) for i in image_indexes)
        lines.append(
            f"{len(image_indexes)} image(s) are attached after this text, in this order: {attached}."
        )
    else:
        lines.append("No images are attached.")
    lines += ["", "<place>"]
    place_type = label(request.type)
    city = label(request.city)
    if place_type:
        lines.append(f"Type: {place_type}")
    if city:
        lines.append(f"City: {city}")
    # wrap() sanitises the text so it cannot open or close any prompt tag.
    lines.append(wrap("name", request.name))
    lines.append(wrap("description", request.description))
    if image_indexes:
        lines.append("<images>")
        for position, index in enumerate(image_indexes, start=1):
            caption = " ".join(sanitize_text(request.images[index].caption or "").split())
            line = f"Attached image {position} is {image_field(index)}."
            if caption:
                line += f" Caption: {caption[:CAPTION_MAX]}"
            lines.append(line)
        lines.append("</images>")
    lines.append("</place>")
    return "\n".join(lines)


def _parse_category(value: Any) -> Category:
    if isinstance(value, str):
        try:
            return Category(value.strip().lower())
        except ValueError:
            pass
    return Category.OTHER


def _parse_field(value: Any, fields: Sequence[str], default_field: str) -> str:
    if isinstance(value, str) and value.strip().lower() in fields:
        return value.strip().lower()
    # Never drop a finding because of a bad field name: keep the signal.
    return default_field


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


def parse_findings(
    data: Any,
    language: str,
    fields: Sequence[str] = PLACE_FIELDS,
    default_field: str = DEFAULT_FIELD,
    fallback: Callable[[Category, str], str] = fallback_message,
) -> list[Finding]:
    """Turn the model JSON into findings (shared by place and tour scans).

    Lenient where it is safe (unknown category -> "other", field not in
    `fields` -> `default_field`, severity clamped to 0..1, missing message -> fallback text).
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
                field=_parse_field(item.get("field"), fields, default_field),
                category=category,
                severity=_parse_severity(item.get("severity")),
                message=message or fallback(category, language),
            )
        )
    return findings


def build_place_response(
    place_id: str,
    findings: Sequence[Finding],
    model: str,
    reject_threshold: float | None = None,
    warning_threshold: float | None = None,
    images_checked: int = 0,
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
        images_checked=images_checked,
        model=model,
    )


async def call_llm(
    llm: Any, prompt: str, system: str, images: Sequence[tuple[str, bytes]] | None = None
) -> tuple[Any, str]:
    """One LLM call; return (JSON data, name of the model that answered).

    `images` is only passed when there are some, so text-only calls keep
    their exact previous shape (and stay eligible for the Groq fallback).
    """
    kwargs: dict[str, Any] = {"system": system, "temperature": 0.0}
    if images:
        kwargs["images"] = list(images)
    with_model = getattr(llm, "generate_json_with_model", None)
    if with_model is not None:
        return await with_model(prompt, **kwargs)
    data = await llm.generate_json(prompt, **kwargs)
    return data, getattr(llm, "model", UNKNOWN_MODEL)


def blocked_model(llm: Any, exc: LLMBlockedError) -> str:
    """Model that refused the text. Blocked content never falls back, so with
    FallbackLLM it is always the primary client's model."""
    primary = getattr(llm, "primary", None)
    model = getattr(primary, "model", None) or getattr(llm, "model", None)
    return model or exc.provider or UNKNOWN_MODEL


class PlaceModerator:
    """Moderates one place (text and images) with exactly one LLM call."""

    def __init__(self, llm: Any = None, image_fetcher: ImageFetcher | None = None) -> None:
        # BLOCK_NONE: Gemini must be able to read harmful text in order to flag it.
        self.llm = llm or FallbackLLM(primary=GeminiClient(safety_block_none=True))
        self.image_fetcher = image_fetcher or make_image_fetcher()
        self.system_prompt = PROMPT_PATH.read_text(encoding="utf-8")

    async def _call_llm(
        self, prompt: str, images: Sequence[tuple[str, bytes]] | None = None
    ) -> tuple[Any, str]:
        return await call_llm(self.llm, prompt, self.system_prompt, images)

    def _blocked_model(self, exc: LLMBlockedError) -> str:
        return blocked_model(self.llm, exc)

    async def fetch_images(
        self, request: PlaceModerationRequest
    ) -> tuple[list[FetchedImage], list[ImageProblem]]:
        """Fetch the images. Raise ImagesUnavailableError on any temporary problem."""
        if not request.images:
            return [], []
        results = await self.image_fetcher([image.url for image in request.images])
        fetched = [r for r in results if isinstance(r, FetchedImage)]
        problems = [r for r in results if isinstance(r, ImageProblem)]
        temporary = [p.index for p in problems if p.kind == "temporary"]
        if temporary:
            raise ImagesUnavailableError(f"images temporarily unavailable: {temporary}")
        return fetched, problems

    async def scan_place(
        self, request: PlaceModerationRequest, images: Sequence[FetchedImage] = ()
    ) -> tuple[list[Finding], str, int]:
        """Return (raw findings, model name, images checked) for one LLM call.

        Fields are "name", "description" or "images[n]" for an attached image.
        """
        language = request.language.value
        indexes = [image.index for image in images]
        prompt = build_place_prompt(request, indexes)
        inline = [(image.mime_type, image.data) for image in images]
        try:
            data, model = await self._call_llm(prompt, inline or None)
        except LLMBlockedError as exc:
            # Content so harmful that the provider refuses to read it: reject it
            # instead of failing with a retryable infrastructure error.
            logger.warning("moderation place=%s blocked by provider: %s", request.place_id, exc)
            blocked = Finding(
                field=DEFAULT_FIELD,
                category=Category.OTHER,
                severity=1.0,
                message=blocked_message(language),
            )
            # The model refused, so no image was actually analysed.
            return [blocked], self._blocked_model(exc), 0
        fields = PLACE_FIELDS + tuple(image_field(i) for i in indexes)
        return parse_findings(data, language, fields=fields), model, len(images)

    async def moderate_place(self, request: PlaceModerationRequest) -> PlaceModerationResponse:
        fetched, problems = await self.fetch_images(request)
        findings, model, images_checked = await self.scan_place(request, fetched)
        language = request.language.value
        if problems:
            severity = unchecked_image_severity()
            findings += [
                Finding(
                    field=image_field(problem.index),
                    category=Category.OTHER,
                    severity=severity,
                    message=unchecked_image_message(problem.index, language),
                )
                for problem in problems
            ]
        response = build_place_response(
            request.place_id, findings, model, images_checked=images_checked
        )
        logger.info(
            "moderation place=%s verdict=%s severity=%.2f model=%s images=%d checked=%d",
            request.place_id,
            response.verdict,
            response.severity,
            model,
            len(request.images),
            images_checked,
        )
        return response


async def moderate_place(
    request: PlaceModerationRequest, llm: Any = None, image_fetcher: ImageFetcher | None = None
) -> PlaceModerationResponse:
    return await PlaceModerator(llm=llm, image_fetcher=image_fetcher).moderate_place(request)

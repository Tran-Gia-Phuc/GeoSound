import asyncio
import logging
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError, field_validator

from app.llm.errors import LLMBlockedError, LLMError, LLMResponseError
from app.llm.fallback import FallbackLLM
from app.llm.gemini_client import GeminiClient
from app.moderation.schema import Category, ModerationRequest
from app.moderation.validator import wrap

logger = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).parent / "prompts" / "text_moderation.txt"
MAX_ATTEMPTS = 2  # first try + one retry (UC#15 E2)
MAX_PARALLEL = 4
MAX_MESSAGE_LENGTH = 500

_LANGUAGE_NAMES = {"vi": "Vietnamese", "en": "English"}

BLOCKED_MESSAGE = "The AI provider refused to process this text (content policy block)."

#xác định cấu trúc mà AI phải trả về.
class RawFinding(BaseModel):
    category: Category
    severity: float = Field(ge=0.0, le=1.0)
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)

    @field_validator("message", mode="before")
    @classmethod
    def _clip_message(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()[:MAX_MESSAGE_LENGTH]
        return value


class RawScan(BaseModel):
    findings: list[RawFinding] = Field(default_factory=list)

# xác định cấu trúc kết quả mà ứng dụng cần sử dụng.
class Finding(BaseModel):
    field: str
    category: Category
    severity: float
    message: str

# build prompt để gửi cho LLM, bao gồm field, text và language.
def build_prompt(field: str, text: str, language: str) -> str:
    # wrap() sanitizes the text so it cannot open or close the delimiter (#AI-28).
    reply_language = _LANGUAGE_NAMES.get(language, "English")
    return (
        f"Field: {field}\n"
        f"Write each finding message in {reply_language}.\n\n"
        f"{wrap('content', text)}"
    )

# đảm nhiệm ba nhiệm vụ:
# 1. Chuẩn bị LLM và system prompt.
# 2. Quét từng trường văn bản.
# 3. Quét toàn bộ tour và tổng hợp kết quả.
class TextModerator:
    """Scans each text field of a tour with the LLM and returns raw findings.

    The verdict (Pass / Warning / Reject) is decided later by policy.py.
    """

    def __init__(self, llm: Any = None) -> None:
        # BLOCK_NONE: Gemini must be able to read harmful text in order to flag it.
        self.llm = llm or FallbackLLM(primary=GeminiClient(safety_block_none=True))
        self.system_prompt = PROMPT_PATH.read_text(encoding="utf-8")

    async def scan_field(self, field: str, text: str, language: str) -> list[Finding]:
        prompt = build_prompt(field, text, language)
        last_error: LLMError | None = None

        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                data = await self.llm.generate_json(
                    prompt, system=self.system_prompt, temperature=0.0
                )
                scan = RawScan.model_validate(data)
                return [Finding(field=field, **f.model_dump()) for f in scan.findings]
            except ValidationError:
                last_error = LLMResponseError(
                    "Model JSON does not match the expected shape", provider="moderation"
                )
            except LLMResponseError as exc:
                last_error = exc
            except LLMBlockedError as exc:
                # Text so harmful that the provider refuses to read it: reject it
                # instead of failing with a retryable infrastructure error.
                logger.warning("moderation field=%s blocked by provider: %s", field, exc)
                return [
                    Finding(
                        field=field,
                        category=Category.OTHER,
                        severity=1.0,
                        message=BLOCKED_MESSAGE,
                    )
                ]
            except LLMError as exc:
                if not exc.fallback_eligible:
                    raise
                last_error = exc
            logger.warning(
                "moderation scan field=%s attempt=%d/%d failed: %s",
                field,
                attempt,
                MAX_ATTEMPTS,
                last_error,
            )

        assert last_error is not None
        raise last_error

    async def scan_tour(self, request: ModerationRequest) -> list[Finding]:
        items: list[tuple[str, str]] = [("title", request.title)]
        if request.description.strip():
            items.append(("description", request.description))
        for index, stop in enumerate(request.stops):
            items.append((f"stops[{index}].description", stop.description))

        semaphore = asyncio.Semaphore(MAX_PARALLEL)

        async def run(field: str, text: str) -> list[Finding]:
            async with semaphore:
                return await self.scan_field(field, text, request.language.value)

        # If any field cannot be scanned the whole scan fails: a partial scan
        # must never produce a "Pass".
        results = await asyncio.gather(*(run(f, t) for f, t in items))
        return [finding for group in results for finding in group]

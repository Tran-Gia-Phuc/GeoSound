import json
import logging
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from app.llm.errors import LLMError, LLMResponseError
from app.llm.fallback import FallbackLLM
from app.translation.schema import TranslateRequest

logger = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).parent / "prompts" / "translate.txt"
MAX_ATTEMPTS = 2  # first try + one retry when the model returns a bad shape

LANGUAGE_NAMES = {
    "vi": "Vietnamese",
    "en": "English",
    "fr": "French",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese (Simplified)",
    "es": "Spanish",
    "de": "German",
    "th": "Thai",
    "ru": "Russian",
}


class RawTranslations(BaseModel):
    translations: list[str]


def language_name(code: str) -> str:
    return LANGUAGE_NAMES.get(code, code)


def build_prompt(texts: list[str], source: str, target: str, context: str | None) -> str:
    # Remove the closing tag so a text cannot break out of its delimiter.
    payload = json.dumps([t.replace("</texts>", "") for t in texts], ensure_ascii=False)
    lines = [
        f"Source language: {language_name(source)} ({source})",
        f"Target language: {language_name(target)} ({target})",
    ]
    if context:
        lines.append(f"Context: {context.replace('</texts>', '')}")
    lines.append(f"Number of texts: {len(texts)}")
    return "\n".join(lines) + f"\n\n<texts>\n{payload}\n</texts>"


class Translator:
    """Translates tour narration texts with the LLM, keeping order and count."""

    def __init__(self, llm: Any = None) -> None:
        self.llm = llm or FallbackLLM()
        self.system_prompt = PROMPT_PATH.read_text(encoding="utf-8")

    async def translate(self, request: TranslateRequest) -> list[str]:
        if request.source_lang == request.target_lang:
            return list(request.texts)

        # Blank texts stay blank; only real content goes to the model.
        indexes = [i for i, t in enumerate(request.texts) if t.strip()]
        if not indexes:
            return list(request.texts)
        texts = [request.texts[i] for i in indexes]

        translated = await self._translate_batch(
            texts, request.source_lang, request.target_lang, request.context
        )
        result = list(request.texts)
        for i, text in zip(indexes, translated):
            result[i] = text
        return result

    async def _translate_batch(
        self, texts: list[str], source: str, target: str, context: str | None
    ) -> list[str]:
        prompt = build_prompt(texts, source, target, context)
        # Output is roughly as long as the input; leave room for longer languages.
        max_tokens = min(8192, 1024 + sum(len(t) for t in texts))
        last_error: LLMError | None = None

        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                data = await self.llm.generate_json(
                    prompt, system=self.system_prompt, temperature=0.2, max_tokens=max_tokens
                )
                parsed = RawTranslations.model_validate(data)
                if len(parsed.translations) == len(texts) and all(
                    t.strip() for t in parsed.translations
                ):
                    return [t.strip() for t in parsed.translations]
                last_error = LLMResponseError(
                    f"Expected {len(texts)} translations, got {len(parsed.translations)}",
                    provider="translation",
                )
            except ValidationError:
                last_error = LLMResponseError(
                    "Model JSON does not match the expected shape", provider="translation"
                )
            except LLMResponseError as exc:
                last_error = exc
            except LLMError as exc:
                if not exc.fallback_eligible:
                    raise
                last_error = exc
            logger.warning(
                "translate %s->%s attempt=%d/%d failed: %s",
                source,
                target,
                attempt,
                MAX_ATTEMPTS,
                last_error,
            )

        assert last_error is not None
        raise last_error

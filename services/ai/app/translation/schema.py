from pydantic import BaseModel, Field, field_validator

MAX_TEXTS = 50
MAX_TEXT_LENGTH = 5000


class TranslateRequest(BaseModel):
    """Translate a batch of narration texts of one tour into one language (UC#12)."""

    source_lang: str = Field(min_length=2, max_length=10)
    target_lang: str = Field(min_length=2, max_length=10)
    texts: list[str] = Field(min_length=1, max_length=MAX_TEXTS)
    # Optional hint for the model, e.g. the tour title and city.
    context: str | None = Field(default=None, max_length=300)

    @field_validator("source_lang", "target_lang")
    @classmethod
    def _normalize_lang(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("texts")
    @classmethod
    def _limit_length(cls, texts: list[str]) -> list[str]:
        for text in texts:
            if len(text) > MAX_TEXT_LENGTH:
                raise ValueError(f"each text must be at most {MAX_TEXT_LENGTH} characters")
        return texts


class TranslateResponse(BaseModel):
    target_lang: str
    translations: list[str]

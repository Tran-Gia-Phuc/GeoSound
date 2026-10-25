from enum import StrEnum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_ID_LENGTH = 100
MAX_TITLE_LENGTH = 200
MAX_DESCRIPTION_LENGTH = 5000
MAX_STOP_DESCRIPTION_LENGTH = 2000
MAX_STOPS = 50


class Verdict(StrEnum):
    PASS = "Pass"
    WARNING = "Warning"
    REJECT = "Reject"


class Category(StrEnum):
    HATE = "hate"
    VIOLENCE = "violence"
    SEXUAL = "sexual"
    SCAM = "scam"
    MISLEADING = "misleading"
    OTHER = "other"  # provider refused the text, no finer category


class Language(StrEnum):
    VI = "vi"
    EN = "en"


class _Base(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class StopInput(_Base):
    stop_id: str = Field(min_length=1, max_length=MAX_ID_LENGTH)
    # Required for every stop (UC#15).
    description: str = Field(min_length=1, max_length=MAX_STOP_DESCRIPTION_LENGTH)


class ModerationRequest(_Base):
    tour_id: str = Field(min_length=1, max_length=MAX_ID_LENGTH)
    title: str = Field(min_length=1, max_length=MAX_TITLE_LENGTH)
    description: str = Field(default="", max_length=MAX_DESCRIPTION_LENGTH)
    language: Language = Language.VI
    stops: list[StopInput] = Field(default_factory=list, max_length=MAX_STOPS)


FIELD_PATTERN = r"^(title|description|stops\[\d+\]\.description)$"


class Reason(_Base):
    # "title", "description" or "stops[<index>].description"
    field: str = Field(pattern=FIELD_PATTERN)
    category: Category
    message: str = Field(min_length=1, max_length=500)


class ModerationResponse(_Base):
    tour_id: str
    verdict: Verdict
    reasons: list[Reason] = Field(default_factory=list)

    @model_validator(mode="after")
    def _non_pass_needs_reason(self) -> Self:
        if self.verdict != Verdict.PASS and not self.reasons:
            raise ValueError("Warning and Reject verdicts require at least one reason")
        return self

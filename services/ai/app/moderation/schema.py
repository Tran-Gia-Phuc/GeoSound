from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

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

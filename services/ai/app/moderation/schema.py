from enum import StrEnum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.moderation.validator import MAX_IMAGES, PLACE_DESCRIPTION_MAX, PLACE_NAME_MAX

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
    IRRELEVANT = "irrelevant"  # not travel content (spam, off-topic)
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


# ---- Place moderation: POST /moderate/place (task #AI-29) -------------------

MAX_LABEL_LENGTH = 100  # place type and city
MAX_IMAGE_URL_LENGTH = 2048
MAX_CAPTION_LENGTH = 300

PLACE_FIELD_PATTERN = r"^(name|description|images\[\d+\])$"


class ImageInput(_Base):
    url: str = Field(min_length=1, max_length=MAX_IMAGE_URL_LENGTH)
    caption: str | None = Field(default=None, max_length=MAX_CAPTION_LENGTH)


class PlaceModerationRequest(_Base):
    place_id: str = Field(min_length=1, max_length=MAX_ID_LENGTH)
    tour_id: str = Field(min_length=1, max_length=MAX_ID_LENGTH)
    name: str = Field(min_length=1, max_length=PLACE_NAME_MAX)
    type: str | None = Field(default=None, max_length=MAX_LABEL_LENGTH)
    description: str = Field(min_length=1, max_length=PLACE_DESCRIPTION_MAX)
    language: Language
    city: str | None = Field(default=None, max_length=MAX_LABEL_LENGTH)
    # Accepted but not checked in phase 1 (images_checked stays 0).
    images: list[ImageInput] = Field(default_factory=list, max_length=MAX_IMAGES)


class PlaceReason(_Base):
    # "name", "description" or "images[<index>]" (phase 2)
    field: str = Field(pattern=PLACE_FIELD_PATTERN)
    category: Category
    message: str = Field(min_length=1, max_length=500)


class PlaceModerationResponse(_Base):
    place_id: str
    verdict: Verdict
    severity: float = Field(ge=0.0, le=1.0)
    reasons: list[PlaceReason] = Field(default_factory=list)
    images_checked: int = Field(default=0, ge=0)
    model: str

    @model_validator(mode="after")
    def _non_pass_needs_reason(self) -> Self:
        if self.verdict != Verdict.PASS and not self.reasons:
            raise ValueError("Warning and Reject verdicts require at least one reason")
        return self

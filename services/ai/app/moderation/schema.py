from enum import StrEnum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.moderation.validator import (
    MAX_IMAGES,
    MAX_PLACES,
    PLACE_DESCRIPTION_MAX,
    PLACE_NAME_MAX,
    TITLE_MAX,
    TOUR_DESCRIPTION_MAX,
)

MAX_ID_LENGTH = 100


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


# ---- Place moderation: POST /moderate/place (task #AI-29) -------------------

MAX_LABEL_LENGTH = 100  # place/tour type and city
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
    # Checked by Gemini in the same call (phase 2, #AI-41); see images.py.
    images: list[ImageInput] = Field(default_factory=list, max_length=MAX_IMAGES)


class PlaceReason(_Base):
    # "name", "description" or "images[<n>]" (n = 0-based index in the request, phase 2)
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


# ---- Tour moderation: POST /moderate/tour (task #AI-31) ---------------------

TOUR_FIELD_PATTERN = r"^(title|description|coherence)$"


class TourPlaceInput(_Base):
    place_id: str = Field(min_length=1, max_length=MAX_ID_LENGTH)
    name: str = Field(min_length=1, max_length=PLACE_NAME_MAX)
    type: str | None = Field(default=None, max_length=MAX_LABEL_LENGTH)
    # Only used to judge coherence; the AI cuts it to TOUR_PLACE_SNIPPET in the prompt.
    description: str = Field(default="", max_length=PLACE_DESCRIPTION_MAX)


class TourModerationRequest(_Base):
    tour_id: str = Field(min_length=1, max_length=MAX_ID_LENGTH)
    title: str = Field(min_length=1, max_length=TITLE_MAX)
    # Optional (tour.submitted allows it): a missing description is "", never a 422.
    description: str = Field(default="", max_length=TOUR_DESCRIPTION_MAX)
    language: Language
    city: str | None = Field(default=None, max_length=MAX_LABEL_LENGTH)
    type: str | None = Field(default=None, max_length=MAX_LABEL_LENGTH)
    duration_minutes: int | None = Field(default=None, ge=0)
    places: list[TourPlaceInput] = Field(max_length=MAX_PLACES)


class TourReason(_Base):
    # "title", "description" or "coherence" (description vs. places, city)
    field: str = Field(pattern=TOUR_FIELD_PATTERN)
    category: Category
    message: str = Field(min_length=1, max_length=500)


class TourModerationResponse(_Base):
    tour_id: str
    verdict: Verdict
    severity: float = Field(ge=0.0, le=1.0)
    reasons: list[TourReason] = Field(default_factory=list)
    model: str

    @model_validator(mode="after")
    def _non_pass_needs_reason(self) -> Self:
        if self.verdict != Verdict.PASS and not self.reasons:
            raise ValueError("Warning and Reject verdicts require at least one reason")
        return self

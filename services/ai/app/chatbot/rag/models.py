"""Data model of the chatbot index (task #AI-44, issue #185).

`TourDoc` / `PlaceDoc` are the public content carried by `tour.published`
(camelCase on the wire, see shared/events/index.js). `Node`, `Edge` and
`Chunk` mirror the tables of schema `ai` (prisma/schema.prisma and
docs/02-design/chatbot-architecture.md section 4).

Only tour and place content is kept: never a contributor id, email or any
other user field (chatbot-architecture.md section 7).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

# Same limits as the zod schema of tour.published.
TITLE_MAX = 200
TOUR_DESCRIPTION_MAX = 5000
PLACE_NAME_MAX = 200
PLACE_DESCRIPTION_MAX = 2000
TRANSLATION_MAX = 5000
MAX_PLACES = 50

NodeKind = Literal["city", "tour", "place", "type", "topic"]
EdgeKind = Literal["has", "has_stop", "is_a", "near", "about"]
ChunkSource = Literal["description", "translation"]

# Closed topic vocabulary (chatbot-architecture.md section 4, layer 3).
TOPICS = frozenset(
    {"history", "food", "architecture", "nature", "religion", "art", "culture", "shopping", "nightlife", "family"}
)
MAX_TOUR_TOPICS = 5
MAX_PLACE_TOPICS = 3


def tour_node_id(tour_id: str) -> str:
    return f"tour:{tour_id}"


def place_node_id(place_id: str) -> str:
    return f"place:{place_id}"


class InvalidPayload(ValueError):
    """The event payload is malformed. Permanent: retrying will not help."""


def parse_revision(value: str | datetime) -> datetime:
    """Parse an ISO 8601 UTC revision (must end with `Z`) into an aware datetime."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise ValueError("revision must be timezone-aware")
        return value.astimezone(timezone.utc)
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError("revision must be an ISO 8601 string ending with Z")
    return datetime.fromisoformat(value).astimezone(timezone.utc)


@dataclass(frozen=True)
class Translation:
    language: str
    text: str


@dataclass(frozen=True)
class PlaceDoc:
    place_id: str
    name: str
    description: str
    lat: float
    lng: float
    sequence: int
    type: str | None = None
    translations: tuple[Translation, ...] = ()


@dataclass(frozen=True)
class TourDoc:
    tour_id: str
    revision: datetime
    status: str
    title: str
    description: str
    language: str
    type: str
    places: tuple[PlaceDoc, ...] = ()
    city: str | None = None
    duration_minutes: int | None = None
    languages: tuple[str, ...] = ()


@dataclass(frozen=True)
class Node:
    """Graph node. `tour_id` is None for shared nodes (city, type, topic)."""

    id: str
    kind: NodeKind
    name: str
    props: dict[str, Any] = field(default_factory=dict)
    tour_id: str | None = None
    revision: datetime | None = None
    topics_pending: bool = False


@dataclass(frozen=True)
class Edge:
    src: str
    dst: str
    kind: EdgeKind
    props: dict[str, Any] = field(default_factory=dict)

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.src, self.dst, self.kind)


@dataclass(frozen=True)
class Chunk:
    id: str
    node_id: str
    tour_id: str
    lang: str
    source: ChunkSource
    text: str


@dataclass(frozen=True)
class PlaceLocation:
    """An already indexed place, used to compute `near` edges."""

    place_id: str
    tour_id: str
    lat: float
    lng: float


@dataclass(frozen=True)
class TopicAssignment:
    """Topics of one tour and its places, already restricted to TOPICS."""

    tour: tuple[str, ...] = ()
    places: dict[str, tuple[str, ...]] = field(default_factory=dict)


# --- Event payload validation (mirror of the zod schemas, camelCase) ---


class _Event(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)


class _TranslationIn(_Event):
    language: str = Field(min_length=2, max_length=10)
    text: str = Field(max_length=TRANSLATION_MAX)


class _PlaceIn(_Event):
    place_id: str = Field(alias="placeId", min_length=1)
    name: str = Field(min_length=1, max_length=PLACE_NAME_MAX)
    type: str | None = None
    description: str = Field(max_length=PLACE_DESCRIPTION_MAX)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    sequence: int = Field(ge=0)
    translations: list[_TranslationIn] = Field(default_factory=list)


class _TourPublishedIn(_Event):
    tour_id: str = Field(alias="tourId", min_length=1)
    revision: str
    # Kept as a free string so a non-public payload can be handled as an unpublish.
    status: str
    title: str = Field(min_length=1, max_length=TITLE_MAX)
    description: str = Field(max_length=TOUR_DESCRIPTION_MAX)
    language: str = Field(min_length=2, max_length=10)
    city: str | None = None
    type: str
    duration_minutes: int | None = Field(default=None, alias="durationMinutes", ge=0)
    languages: list[str] = Field(default_factory=list)
    places: list[_PlaceIn] = Field(max_length=MAX_PLACES)

    @field_validator("revision")
    @classmethod
    def _utc(cls, value: str) -> str:
        parse_revision(value)
        return value


class _TourUnpublishedIn(_Event):
    tour_id: str = Field(alias="tourId", min_length=1)
    revision: str | None = None
    reason: Literal["unpublished", "edited", "hidden", "restricted", "deleted"]

    @field_validator("revision")
    @classmethod
    def _utc(cls, value: str | None) -> str | None:
        if value is not None:
            parse_revision(value)
        return value


def parse_tour_published(payload: Any) -> TourDoc:
    """Validate a `tour.published` payload. Raises InvalidPayload."""
    try:
        event = _TourPublishedIn.model_validate(payload)
    except (ValidationError, ValueError, TypeError) as exc:
        raise InvalidPayload(f"invalid tour.published payload: {_short(exc)}") from None
    return TourDoc(
        tour_id=event.tour_id,
        revision=parse_revision(event.revision),
        status=event.status,
        title=event.title,
        description=event.description,
        language=event.language,
        type=event.type,
        city=event.city or None,
        duration_minutes=event.duration_minutes,
        languages=tuple(event.languages),
        places=tuple(
            PlaceDoc(
                place_id=p.place_id,
                name=p.name,
                type=p.type or None,
                description=p.description,
                lat=p.lat,
                lng=p.lng,
                sequence=p.sequence,
                translations=tuple(Translation(t.language, t.text) for t in p.translations),
            )
            for p in event.places
        ),
    )


def parse_tour_unpublished(payload: Any) -> tuple[str, datetime | None, str]:
    """Validate a `tour.unpublished` payload into (tour_id, revision, reason)."""
    try:
        event = _TourUnpublishedIn.model_validate(payload)
    except (ValidationError, ValueError, TypeError) as exc:
        raise InvalidPayload(f"invalid tour.unpublished payload: {_short(exc)}") from None
    revision = parse_revision(event.revision) if event.revision else None
    return event.tour_id, revision, event.reason


def _short(exc: Exception) -> str:
    # Field locations only: never echo user text into logs.
    if isinstance(exc, ValidationError):
        return ", ".join(".".join(str(p) for p in err["loc"]) or "payload" for err in exc.errors())[:300]
    return type(exc).__name__

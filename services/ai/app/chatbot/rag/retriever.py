"""Retriever port of the chat agent (task #AI-46, chatbot-architecture.md sections 3.4 and 5).

The agent depends only on the `Retriever` protocol below. The real hybrid
graph + vector retriever over schema `ai` is task #AI-45 (#186); until it
lands, `NullRetriever` is the default (it finds nothing, so the agent answers
"no data"). Tests use a scripted fake.

Every hit comes from the public index only and carries its id so `cite` can
link to it. Pure Python: no LangChain import here.
"""

from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

TourType = Literal["walking", "driving", "cycling", "indoor"]
Language = Literal["vi", "en"]

DEFAULT_K = 5
MAX_K = 10
DEFAULT_RADIUS_M = 500
MAX_RADIUS_M = 1000


@dataclass(frozen=True)
class SearchFilters:
    """Structured filters built by the `plan` node (all optional)."""

    city: str | None = None
    type: TourType | None = None
    max_duration_minutes: int | None = None
    place_type: str | None = None
    topics: tuple[str, ...] = ()
    language: Language | None = None


@dataclass(frozen=True)
class TourHit:
    tour_id: str
    title: str
    city: str | None = None
    type: str | None = None
    duration_minutes: int | None = None
    score: float = 0.0
    snippet: str = ""
    # Graph hops from a vector seed (0 = seed itself).
    hops: int = 0


@dataclass(frozen=True)
class PlaceHit:
    place_id: str
    name: str
    tour_id: str | None = None
    type: str | None = None
    city: str | None = None
    score: float = 0.0
    snippet: str = ""
    # Set by nearby_places only.
    distance_m: float | None = None
    hops: int = 0


@runtime_checkable
class Retriever(Protocol):
    """Read-only access to the public tour/place index."""

    async def search_tours(
        self, query: str, filters: SearchFilters, k: int = DEFAULT_K
    ) -> list[TourHit]: ...

    async def search_places(
        self, query: str, filters: SearchFilters, k: int = DEFAULT_K
    ) -> list[PlaceHit]: ...

    async def nearby_places(
        self,
        *,
        lat: float | None = None,
        lng: float | None = None,
        place_id: str | None = None,
        radius_m: int = DEFAULT_RADIUS_M,
        k: int = DEFAULT_K,
    ) -> list[PlaceHit]: ...


class NullRetriever:
    """Default retriever until #AI-45: the index is empty, every search finds nothing."""

    async def search_tours(self, query, filters, k=DEFAULT_K):
        return []

    async def search_places(self, query, filters, k=DEFAULT_K):
        return []

    async def nearby_places(self, *, lat=None, lng=None, place_id=None,
                            radius_m=DEFAULT_RADIUS_M, k=DEFAULT_K):
        return []

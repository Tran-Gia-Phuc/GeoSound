"""Chat agent tools (task #AI-46, chatbot-architecture.md section 3.4).

Three standard LangChain tools over the `Retriever` port: `search_tours`,
`search_places` and `nearby_places`. Their input JSON schemas are the pydantic
models below, so invalid arguments are rejected before the retriever runs.

The graph calls them deterministically (the `plan` node decides which ones),
not through LLM tool calling: the free Gemini tier allows one LLM call per
normal turn. Because they are plain LangChain tools, a paid tier could bind
them to the model later without changing them.
"""

from typing import Any, Literal

from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.chatbot.rag.retriever import (
    DEFAULT_K,
    DEFAULT_RADIUS_M,
    MAX_K,
    MAX_RADIUS_M,
    Retriever,
    SearchFilters,
)

QUERY_MAX = 200
MAX_TOPICS = 5


class SearchToursArgs(BaseModel):
    """Find public tours matching a text query and optional filters."""

    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=QUERY_MAX)
    city: str | None = Field(default=None, max_length=100)
    type: Literal["walking", "driving", "cycling", "indoor"] | None = None
    max_duration_minutes: int | None = Field(default=None, ge=0)
    topics: list[str] = Field(default_factory=list, max_length=MAX_TOPICS)
    language: Literal["vi", "en"] | None = None
    k: int = Field(default=DEFAULT_K, ge=1, le=MAX_K)


class SearchPlacesArgs(BaseModel):
    """Find public places (tour stops) matching a text query and optional filters."""

    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=QUERY_MAX)
    city: str | None = Field(default=None, max_length=100)
    place_type: str | None = Field(default=None, max_length=50)
    topics: list[str] = Field(default_factory=list, max_length=MAX_TOPICS)
    language: Literal["vi", "en"] | None = None
    k: int = Field(default=DEFAULT_K, ge=1, le=MAX_K)


class NearbyPlacesArgs(BaseModel):
    """Find public places near a place or a coordinate. Give `place_id` or `lat` + `lng`."""

    model_config = ConfigDict(extra="forbid")

    place_id: str | None = Field(default=None, min_length=1, max_length=100)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    radius_m: int = Field(default=DEFAULT_RADIUS_M, ge=1, le=MAX_RADIUS_M)
    k: int = Field(default=DEFAULT_K, ge=1, le=MAX_K)

    @model_validator(mode="after")
    def _anchor(self) -> "NearbyPlacesArgs":
        has_point = self.lat is not None and self.lng is not None
        if (self.lat is None) != (self.lng is None):
            raise ValueError("lat and lng must be given together")
        if not self.place_id and not has_point:
            raise ValueError("one of place_id or lat + lng is required")
        return self


def build_tools(retriever: Retriever) -> dict[str, BaseTool]:
    """Return the three tools bound to `retriever`, keyed by tool name."""

    async def search_tours(**kwargs: Any) -> list[dict]:
        args = SearchToursArgs(**kwargs)
        filters = SearchFilters(
            city=args.city,
            type=args.type,
            max_duration_minutes=args.max_duration_minutes,
            topics=tuple(args.topics),
            language=args.language,
        )
        hits = await retriever.search_tours(args.query, filters, args.k)
        return [
            {
                "tour_id": h.tour_id,
                "title": h.title,
                "city": h.city,
                "type": h.type,
                "duration_minutes": h.duration_minutes,
                "score": h.score,
                "snippet": h.snippet,
                "hops": h.hops,
            }
            for h in hits[: args.k]
        ]

    async def search_places(**kwargs: Any) -> list[dict]:
        args = SearchPlacesArgs(**kwargs)
        filters = SearchFilters(
            city=args.city,
            place_type=args.place_type,
            topics=tuple(args.topics),
            language=args.language,
        )
        hits = await retriever.search_places(args.query, filters, args.k)
        return [
            {
                "place_id": h.place_id,
                "tour_id": h.tour_id,
                "name": h.name,
                "type": h.type,
                "score": h.score,
                "snippet": h.snippet,
                "hops": h.hops,
            }
            for h in hits[: args.k]
        ]

    async def nearby_places(**kwargs: Any) -> list[dict]:
        args = NearbyPlacesArgs(**kwargs)
        hits = await retriever.nearby_places(
            lat=args.lat,
            lng=args.lng,
            place_id=args.place_id,
            radius_m=args.radius_m,
            k=args.k,
        )
        return [
            {
                "place_id": h.place_id,
                "tour_id": h.tour_id,
                "name": h.name,
                "type": h.type,
                "distance_m": h.distance_m,
                # Additive to the section 3.4 table: the answer needs some text.
                "snippet": h.snippet,
                "hops": h.hops,
            }
            for h in hits[: args.k]
            if h.place_id != args.place_id
        ]

    specs = [
        (search_tours, "search_tours", SearchToursArgs),
        (search_places, "search_places", SearchPlacesArgs),
        (nearby_places, "nearby_places", NearbyPlacesArgs),
    ]
    return {
        name: StructuredTool.from_function(
            coroutine=fn,
            name=name,
            description=(schema.__doc__ or "").strip(),
            args_schema=schema,
        )
        for fn, name, schema in specs
    }

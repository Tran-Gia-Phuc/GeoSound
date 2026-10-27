"""Hybrid graph + vector retriever (task #AI-45, issue #186).

Implements the `Retriever` port of the chat agent over any `IndexStore`
(docs/02-design/chatbot-architecture.md section 5):

1. Vector seeds: embed the query, cosine top `k_seed` chunks, best chunk per
   node. The hard filters (city, tour type, max duration, place type) and the
   tombstone check are applied by the store BEFORE the top `k_seed` is taken.
2. Graph expansion, 1 to 2 hops from each seed over `has_stop`, `near`, `about`
   and `has` (so: tour <-> its places, place <-> nearby places, shared topic,
   same city). An expanded node inherits the seed similarity scaled by the
   graph proximity of its path (1, 0.5, 0.25 for 0, 1, 2 hops).
3. Filters again on every candidate, since graph-reached nodes skipped step 1:
   city (canonical names, same alias table as the agent's `rules.py`), tour
   type, max duration, place type are hard filters; topics are soft and only
   raise the score.
4. Rerank without an LLM:
   `score = 0.6 * similarity + 0.2 * graph_proximity + 0.2 * filter_match`.
   Top k, each with its id so `cite` can link to it. `search_tours` and
   `search_places` are separate lists: places of a returned tour are not
   folded under it (the agent merges and deduplicates by (kind, id)).

The index only holds public tours. As a second guard, every hit is checked
against the tour tombstone (`get_revisions(...)`, state `indexed`), so a tour
that was unpublished or deleted is never returned even if rows were left over.

Wiring: #188 builds `HybridRetriever(PgVectorIndexStore(...), LocalE5Embedder())`
once #219 lands. There is no factory here on purpose: an in-memory store with a
fake embedder must never reach production.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Iterable

from app.chatbot.graph import rules
from app.chatbot.rag.embedder import Embedder
from app.chatbot.rag.graph_builder import slugify
from app.chatbot.rag.models import Chunk, Node
from app.chatbot.rag.retriever import (
    DEFAULT_K,
    MAX_K,
    MAX_RADIUS_M,
    PlaceHit,
    SearchFilters,
    TourHit,
)
from app.chatbot.rag.store import IndexStore
from app.moderation.validator import clip

W_VECTOR = 0.6
W_GRAPH = 0.2
W_FILTER = 0.2
HOP_PROXIMITY = (1.0, 0.5, 0.25)
EXPANSION_EDGES = ("has_stop", "near", "about", "has")
SNIPPET_MAX = 300


def _city_of(tour: Node | None) -> str | None:
    return tour.props.get("city") if tour is not None else None


def proximity(hops: int) -> float:
    return HOP_PROXIMITY[hops] if 0 <= hops < len(HOP_PROXIMITY) else 0.0


@dataclass
class _Candidate:
    node_id: str
    core: float  # W_VECTOR * similarity + W_GRAPH * proximity of the best path
    hops: int
    chunk: Chunk | None = None  # best seed chunk, for the snippet
    topics: set[str] = field(default_factory=set)


class HybridRetriever:
    """Graph + vector retriever over the public chatbot index."""

    def __init__(
        self,
        store: IndexStore,
        embedder: Embedder,
        k_seed: int = 20,
        k_final: int = DEFAULT_K,
        *,
        max_hops: int = 2,
        min_similarity: float = 0.0,
        city_aliases: dict[str, str] | None = None,
    ) -> None:
        if store.dimension != embedder.dimension:
            raise ValueError(
                f"embedder dimension {embedder.dimension} does not match store dimension {store.dimension}"
            )
        if k_seed <= 0 or k_final <= 0:
            raise ValueError("k_seed and k_final must be positive")
        if not 0 <= max_hops < len(HOP_PROXIMITY):
            raise ValueError(f"max_hops must be in [0, {len(HOP_PROXIMITY) - 1}]")
        self.store = store
        self.embedder = embedder
        self.k_seed = k_seed
        self.k_final = k_final
        self.max_hops = max_hops
        self.min_similarity = min_similarity
        self.city_aliases = dict(city_aliases) if city_aliases else dict(rules.CITY_ALIASES)

    # ---------- port ----------

    async def search_tours(self, query: str, filters: SearchFilters, k: int = DEFAULT_K) -> list[TourHit]:
        k = self._k(k)
        candidates = await self._candidates(query, "tour", filters)
        if not candidates:
            return []
        nodes = await self.store.get_nodes(candidates)
        live = await self._live_tours(n.tour_id for n in nodes.values())
        kept = [nodes[i] for i in candidates if i in nodes and nodes[i].kind == "tour"
                and nodes[i].tour_id in live and self._tour_matches(nodes[i], filters)]
        # Topics of a tour = its own and those of its places.
        topics = await self._topics([n.id for n in kept], ("about", "has_stop"), 2)
        scored = []
        for node in kept:
            cand = candidates[node.id]
            match = self._filter_match(filters, topics.get(node.id, set()), tour=True)
            scored.append((round(cand.core + W_FILTER * match, 4), cand, node))
        scored.sort(key=lambda s: (-s[0], s[1].hops, s[2].id))
        top = scored[:k]
        snippets = await self._snippets([c for _, c, _ in top], filters.language)
        return [
            TourHit(
                tour_id=node.tour_id,
                title=node.name,
                city=node.props.get("city"),
                type=node.props.get("type"),
                duration_minutes=node.props.get("duration_minutes"),
                score=score,
                snippet=snippets.get(node.id, ""),
                hops=cand.hops,
            )
            for score, cand, node in top
        ]

    async def search_places(self, query: str, filters: SearchFilters, k: int = DEFAULT_K) -> list[PlaceHit]:
        k = self._k(k)
        candidates = await self._candidates(query, "place", filters)
        if not candidates:
            return []
        nodes = await self.store.get_nodes(candidates)
        places = [nodes[i] for i in candidates if i in nodes and nodes[i].kind == "place"]
        tours = await self.store.get_nodes(f"tour:{p.tour_id}" for p in places if p.tour_id)
        live = await self._live_tours(p.tour_id for p in places)
        kept = []
        for place in places:
            tour = tours.get(f"tour:{place.tour_id}")
            if place.tour_id not in live or tour is None:
                continue
            if not self._place_matches(place, tour, filters):
                continue
            kept.append((place, tour))
        own = await self._topics([p.id for p, _ in kept], ("about",), 1)
        tour_topics = await self._topics({t.id for _, t in kept}, ("about",), 1)
        scored = []
        for place, tour in kept:
            cand = candidates[place.id]
            topics = own.get(place.id, set()) | tour_topics.get(tour.id, set())
            match = self._filter_match(filters, topics, tour=False)
            scored.append((round(cand.core + W_FILTER * match, 4), cand, place, tour))
        scored.sort(key=lambda s: (-s[0], s[1].hops, s[2].id))
        top = scored[:k]
        snippets = await self._snippets([c for _, c, _, _ in top], filters.language)
        return [
            PlaceHit(
                place_id=place.id.removeprefix("place:"),
                name=place.name,
                tour_id=place.tour_id,
                type=place.props.get("type"),
                city=tour.props.get("city"),
                score=score,
                snippet=snippets.get(place.id, ""),
                hops=cand.hops,
            )
            for score, cand, place, tour in top
        ]

    async def nearby_places(
        self,
        *,
        lat: float | None = None,
        lng: float | None = None,
        place_id: str | None = None,
        radius_m: int = 500,
        k: int = DEFAULT_K,
    ) -> list[PlaceHit]:
        k = self._k(k)
        radius = max(1, min(int(radius_m), MAX_RADIUS_M))
        anchor_id = None
        hops = 0
        if place_id:
            anchor_id = f"place:{place_id}"
            anchor = (await self.store.get_nodes([anchor_id])).get(anchor_id)
            if anchor is None or anchor.kind != "place" or not await self._live_tours([anchor.tour_id]):
                return []
            lat, lng = anchor.props.get("lat"), anchor.props.get("lng")
            hops = 1
        if lat is None or lng is None:
            return []
        found = [p for p in await self.store.places_near(lat, lng, radius) if p.node.id != anchor_id]
        live = await self._live_tours(p.node.tour_id for p in found)
        found = [p for p in found if p.node.tour_id in live][:k]
        tours = await self.store.get_nodes(f"tour:{p.node.tour_id}" for p in found)
        snippets = await self._snippets(
            [_Candidate(p.node.id, 0.0, hops) for p in found], None
        )
        return [
            PlaceHit(
                place_id=p.node.id.removeprefix("place:"),
                name=p.node.name,
                tour_id=p.node.tour_id,
                type=p.node.props.get("type"),
                city=_city_of(tours.get(f"tour:{p.node.tour_id}")),
                score=round(1.0 - p.distance_m / radius, 4),
                snippet=snippets.get(p.node.id, ""),
                distance_m=round(p.distance_m, 1),
                hops=hops,
            )
            for p in found
        ]

    # ---------- helpers ----------

    async def city_aliases_from_index(self) -> dict[str, str]:
        """Alias table for `ChatAgent(city_aliases=...)`: rules.CITY_ALIASES plus City node names.

        A City node whose name is a known alias maps to that canonical name; an
        unknown city maps to its own name, so the agent can still filter on it.
        """
        table = dict(self.city_aliases)
        for node in await self.store.list_nodes("city"):
            name = node.name.strip()
            if name and rules.fold(name) not in {rules.fold(a) for a in table}:
                table[name.lower()] = rules.find_city(name, self.city_aliases) or name
        return table

    def _k(self, k: int | None) -> int:
        return max(1, min(int(k or self.k_final), MAX_K))

    def _city_key(self, value: str | None) -> str:
        if not value:
            return ""
        return slugify(rules.find_city(value, self.city_aliases) or value)

    def _tour_matches(self, node: Node, filters: SearchFilters) -> bool:
        props = node.props
        if filters.city and self._city_key(props.get("city")) != self._city_key(filters.city):
            return False
        if filters.type and props.get("type") != filters.type:
            return False
        if filters.max_duration_minutes is not None:
            duration = props.get("duration_minutes")
            if duration is None or duration > filters.max_duration_minutes:
                return False
        return True

    def _place_matches(self, place: Node, tour: Node, filters: SearchFilters) -> bool:
        if filters.city and self._city_key(tour.props.get("city")) != self._city_key(filters.city):
            return False
        if filters.place_type and slugify(place.props.get("type") or "") != slugify(filters.place_type):
            return False
        return True

    @staticmethod
    def _filter_match(filters: SearchFilters, topics: set[str], *, tour: bool) -> float:
        """Share of requested constraints met (hard filters are met once a node is kept)."""
        wanted = {t.strip().lower() for t in filters.topics if t and t.strip()}
        hard = [filters.city, filters.type if tour else filters.place_type]
        if tour:
            hard.append(filters.max_duration_minutes)
        requested = len(wanted) + sum(1 for h in hard if h is not None and h != "")
        if requested == 0:
            return 0.0
        met = len(wanted & topics) + sum(1 for h in hard if h is not None and h != "")
        return met / requested

    def _city_keys(self, city: str | None) -> set[str] | None:
        """Every `slugify` form of the requested city: canonical name and all its aliases."""
        if not city:
            return None
        canonical = rules.find_city(city, self.city_aliases) or city
        keys = {slugify(city), slugify(canonical)}
        keys |= {slugify(alias) for alias, name in self.city_aliases.items() if name == canonical}
        return {k for k in keys if k}

    async def _candidates(self, query: str, kind: str, filters: SearchFilters) -> dict[str, _Candidate]:
        """Filtered seeds plus graph expansion, best path per node, restricted to `kind` nodes.

        Hard filters run inside the vector search (before its top k), so other
        cities cannot crowd out the matching ones; graph-reached nodes are
        filtered again by the caller.
        """
        if not query or not query.strip():
            return {}
        vector = await asyncio.to_thread(self.embedder.embed_query, query)
        is_tour = kind == "tour"
        hits = await self.store.vector_search(
            vector,
            self.k_seed,
            kinds=("tour", "place"),
            city_keys=self._city_keys(filters.city),
            tour_type=filters.type if is_tour else None,
            max_duration_minutes=filters.max_duration_minutes if is_tour else None,
            place_type=None if is_tour else filters.place_type,
        )
        seeds: dict[str, tuple[float, Chunk]] = {}
        for hit in hits:
            if hit.score <= self.min_similarity:
                continue
            best = seeds.get(hit.chunk.node_id)
            if best is None or hit.score > best[0]:
                seeds[hit.chunk.node_id] = (hit.score, hit.chunk)
        if not seeds:
            return {}

        out: dict[str, _Candidate] = {}

        def offer(node_id: str, similarity: float, hops: int, chunk: Chunk | None) -> None:
            prox = proximity(hops)
            core = W_VECTOR * similarity * prox + W_GRAPH * prox
            current = out.get(node_id)
            if current is None or core > current.core or (core == current.core and hops < current.hops):
                out[node_id] = _Candidate(node_id, core, hops, chunk)

        for node_id, (sim, chunk) in seeds.items():
            offer(node_id, sim, 0, chunk)
        if self.max_hops:
            for reach in await self.store.neighbours(list(seeds), EXPANSION_EDGES, self.max_hops):
                offer(reach.node_id, seeds[reach.seed][0], reach.hops, None)
        prefix = f"{kind}:"
        return {i: c for i, c in out.items() if i.startswith(prefix)}

    async def _topics(self, node_ids: Iterable[str], edges: tuple[str, ...], hops: int) -> dict[str, set[str]]:
        ids = list(node_ids)
        if not ids:
            return {}
        out: dict[str, set[str]] = {}
        for reach in await self.store.neighbours(ids, edges, hops):
            if reach.node_id.startswith("topic:"):
                out.setdefault(reach.seed, set()).add(reach.node_id.removeprefix("topic:"))
        return out

    async def _live_tours(self, tour_ids: Iterable[str | None]) -> set[str]:
        """Tour ids whose index state is `indexed` (skips tombstones and unknown tours)."""
        ids = {t for t in tour_ids if t}
        if not ids:
            return set()
        states = await self.store.get_revisions(ids)
        return {t for t, state in states.items() if state.state == "indexed"}

    async def _snippets(self, candidates: list[_Candidate], language: str | None) -> dict[str, str]:
        out = {c.node_id: clip(c.chunk.text, SNIPPET_MAX) for c in candidates if c.chunk}
        missing = [c.node_id for c in candidates if c.node_id not in out]
        if missing:
            by_node: dict[str, list[Chunk]] = {}
            for chunk in await self.store.get_chunks(missing):
                by_node.setdefault(chunk.node_id, []).append(chunk)
            for node_id, chunks in by_node.items():
                chunks.sort(key=lambda c: (c.lang != language, c.source != "description", c.id))
                out[node_id] = clip(chunks[0].text, SNIPPET_MAX)
        return out

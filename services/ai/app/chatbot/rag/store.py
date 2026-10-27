"""Storage of the chatbot index (task #AI-44).

`IndexStore` is the port used by the indexer (writes) and by the hybrid
retriever (reads, task #AI-45). Two implementations:

- `InMemoryIndexStore`: complete, used by tests (and handy for local demos).
- `PgVectorIndexStore`: pgvector in the shared Postgres, schema `ai`
  (decision 6a, DDL in sql/schema.sql). Skeleton only: no DB driver is in
  requirements.txt yet. TODO(#185 follow-up).

Rules every implementation keeps:

- `upsert_tour` replaces the whole tour in ONE transaction: delete its nodes,
  every edge touching them, its chunks, then insert the new rows. It re-checks
  the revision inside that transaction and returns False (nothing written)
  when the stored revision is the same or newer.
- `delete_tour` removes the tour, its places, their chunks and every edge
  touching them in one transaction, and keeps a tombstone (`ai.tour_index`)
  so a late, older `tour.published` cannot bring the tour back.
- Shared nodes (city, type, topic) left without any edge are removed.
- Nothing but public tour and place content is stored.
"""

from __future__ import annotations

import asyncio
import math
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from typing import Collection, Iterable, Literal, Protocol, Sequence

from app.chatbot.rag.graph_builder import BBox, haversine_m, near_bbox, slugify
from app.chatbot.rag.models import Chunk, Edge, EdgeKind, Node, NodeKind, PlaceLocation, TourDoc

TourState = Literal["indexed", "deleted"]


@dataclass(frozen=True)
class TourIndexState:
    """Last revision seen for a tour; `deleted` = tombstone after an unpublish."""

    revision: datetime | None
    state: TourState


@dataclass(frozen=True)
class ScoredChunk:
    """A chunk found by vector search; `score` = cosine similarity in [-1, 1]."""

    chunk: Chunk
    score: float


@dataclass(frozen=True)
class Reach:
    """`node_id` is reachable from `seed` in `hops` edges (minimum, undirected)."""

    seed: str
    node_id: str
    hops: int


@dataclass(frozen=True)
class NearPlace:
    node: Node
    distance_m: float


class IndexStore(Protocol):
    """Write side (indexer, #AI-44) and read side (HybridRetriever, #AI-45)."""

    dimension: int

    async def get_revision(self, tour_id: str) -> TourIndexState | None: ...

    # --- read side (#AI-45) ---

    async def get_revisions(self, tour_ids: Iterable[str]) -> dict[str, TourIndexState]:
        """Index state of several tours in one call; unknown tours are absent."""
        ...

    async def vector_search(
        self,
        query_vector: Sequence[float],
        k: int,
        kinds: Iterable[NodeKind] | None = None,
        *,
        city_keys: Collection[str] | None = None,
        tour_type: str | None = None,
        max_duration_minutes: int | None = None,
        place_type: str | None = None,
    ) -> list[ScoredChunk]:
        """Top `k` chunks by cosine similarity, best first.

        Only chunks of indexed (not tombstoned) tours are searched. The filters
        apply to the owning node BEFORE the top `k` is taken:
        `kinds` = owning node kind; `city_keys` = accepted `slugify(city)` of the
        owning tour (the caller expands aliases); `tour_type` and
        `max_duration_minutes` (a tour without duration fails) on the owning
        tour; `place_type` (slug) on place nodes only, tour chunks are kept.
        """
        ...

    async def get_nodes(self, ids: Iterable[str]) -> dict[str, Node]:
        """Nodes by id; unknown ids are absent from the result."""
        ...

    async def get_chunks(self, node_ids: Iterable[str]) -> list[Chunk]:
        """All chunks of the given nodes."""
        ...

    async def list_nodes(self, kind: NodeKind) -> list[Node]:
        """Every node of one kind (used for City names)."""
        ...

    async def neighbours(
        self, node_ids: Iterable[str], kinds: Iterable[EdgeKind], max_hops: int = 1
    ) -> list[Reach]:
        """Nodes within `max_hops` of each seed over edges of `kinds`, both directions.

        One row per (seed, reached node) with the minimum hop count; seeds themselves excluded.
        """
        ...

    async def places_near(self, lat: float, lng: float, radius_m: float) -> list[NearPlace]:
        """Place nodes within `radius_m` meters of a point, nearest first."""
        ...

    async def places_in_bbox(self, box: BBox, exclude_tour_id: str) -> list[PlaceLocation]: ...

    async def upsert_tour(
        self,
        doc: TourDoc,
        nodes: Sequence[Node],
        edges: Sequence[Edge],
        chunks: Sequence[Chunk],
        vectors: Sequence[Sequence[float]],
        revision: datetime,
    ) -> bool: ...

    async def delete_tour(self, tour_id: str, revision: datetime | None = None) -> bool: ...


def _is_newer(new: datetime | None, old: datetime | None) -> bool:
    return old is None or (new is not None and new > old)


class InMemoryIndexStore:
    """Dict-backed store. A lock makes each write atomic for concurrent tasks."""

    def __init__(self, dimension: int) -> None:
        self.dimension = dimension
        self.nodes: dict[str, Node] = {}
        self.edges: dict[tuple[str, str, str], Edge] = {}
        self.chunks: dict[str, Chunk] = {}
        self.vectors: dict[str, list[float]] = {}
        self.tours: dict[str, TourIndexState] = {}
        self._lock = asyncio.Lock()

    async def get_revision(self, tour_id: str) -> TourIndexState | None:
        return self.tours.get(tour_id)

    async def places_in_bbox(self, box: BBox, exclude_tour_id: str) -> list[PlaceLocation]:
        out = []
        for node in self.nodes.values():
            if node.kind != "place" or node.tour_id == exclude_tour_id:
                continue
            lat, lng = node.props.get("lat"), node.props.get("lng")
            if lat is not None and lng is not None and box.contains(lat, lng):
                out.append(PlaceLocation(node.id.removeprefix("place:"), node.tour_id, lat, lng))
        return out

    async def upsert_tour(self, doc, nodes, edges, chunks, vectors, revision) -> bool:
        if len(chunks) != len(vectors):
            raise ValueError("one vector per chunk")
        if any(len(v) != self.dimension for v in vectors):
            raise ValueError(f"vector dimension must be {self.dimension}")
        async with self._lock:
            current = self.tours.get(doc.tour_id)
            if current is not None and not _is_newer(revision, current.revision):
                return False
            self._remove(doc.tour_id)
            for node in nodes:
                if node.tour_id is None:  # shared node: keep the existing row
                    self.nodes.setdefault(node.id, node)
                else:
                    self.nodes[node.id] = node
            for edge in edges:
                # A neighbour removed meanwhile: skip the dangling edge (FK in Postgres).
                if edge.src in self.nodes and edge.dst in self.nodes:
                    self.edges[edge.key] = edge
            for chunk, vector in zip(chunks, vectors):
                self.chunks[chunk.id] = chunk
                self.vectors[chunk.id] = list(vector)
            self._drop_orphans()
            self.tours[doc.tour_id] = TourIndexState(revision, "indexed")
            return True

    async def delete_tour(self, tour_id: str, revision: datetime | None = None) -> bool:
        async with self._lock:
            removed = self._remove(tour_id)
            self._drop_orphans()
            current = self.tours.get(tour_id)
            old = current.revision if current else None
            keep = revision if _is_newer(revision, old) else old
            self.tours[tour_id] = TourIndexState(keep, "deleted")
            return removed

    # --- read side (#AI-45) ---

    async def get_revisions(self, tour_ids) -> dict[str, TourIndexState]:
        return {t: self.tours[t] for t in tour_ids if t in self.tours}

    async def vector_search(
        self,
        query_vector,
        k,
        kinds=None,
        *,
        city_keys=None,
        tour_type=None,
        max_duration_minutes=None,
        place_type=None,
    ) -> list[ScoredChunk]:
        if k <= 0:
            return []
        if len(query_vector) != self.dimension:
            raise ValueError(f"vector dimension must be {self.dimension}")
        wanted = set(kinds) if kinds is not None else None
        cities = set(city_keys) if city_keys is not None else None
        place_key = slugify(place_type) if place_type else None
        q_norm = math.sqrt(sum(v * v for v in query_vector)) or 1.0
        scored: list[ScoredChunk] = []
        for cid, chunk in self.chunks.items():
            node = self.nodes.get(chunk.node_id)
            if node is None or (wanted is not None and node.kind not in wanted):
                continue
            state = self.tours.get(chunk.tour_id)
            if state is None or state.state != "indexed":
                continue
            tour = node if node.kind == "tour" else self.nodes.get(f"tour:{node.tour_id}")
            if tour is None:
                continue
            props = tour.props
            if cities is not None and slugify(props.get("city") or "") not in cities:
                continue
            if tour_type and props.get("type") != tour_type:
                continue
            if max_duration_minutes is not None and (
                props.get("duration_minutes") is None or props["duration_minutes"] > max_duration_minutes
            ):
                continue
            if place_key and node.kind == "place" and slugify(node.props.get("type") or "") != place_key:
                continue
            vec = self.vectors[cid]
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            cos = sum(a * b for a, b in zip(query_vector, vec)) / (q_norm * norm)
            scored.append(ScoredChunk(chunk, cos))
        scored.sort(key=lambda s: (-s.score, s.chunk.id))
        return scored[:k]

    async def get_nodes(self, ids) -> dict[str, Node]:
        return {i: self.nodes[i] for i in ids if i in self.nodes}

    async def get_chunks(self, node_ids) -> list[Chunk]:
        wanted = set(node_ids)
        return sorted((c for c in self.chunks.values() if c.node_id in wanted), key=lambda c: c.id)

    async def list_nodes(self, kind) -> list[Node]:
        return sorted((n for n in self.nodes.values() if n.kind == kind), key=lambda n: n.id)

    async def neighbours(self, node_ids, kinds, max_hops=1) -> list[Reach]:
        allowed = set(kinds)
        adjacency: dict[str, set[str]] = {}
        for (src, dst, kind) in self.edges:
            if kind in allowed:
                adjacency.setdefault(src, set()).add(dst)
                adjacency.setdefault(dst, set()).add(src)
        out: list[Reach] = []
        for seed in dict.fromkeys(node_ids):
            seen = {seed: 0}
            queue = deque([seed])
            while queue:
                current = queue.popleft()
                if seen[current] >= max_hops:
                    continue
                for nxt in sorted(adjacency.get(current, ())):
                    if nxt not in seen:
                        seen[nxt] = seen[current] + 1
                        queue.append(nxt)
                        out.append(Reach(seed, nxt, seen[nxt]))
        return out

    async def places_near(self, lat, lng, radius_m) -> list[NearPlace]:
        box = near_bbox([(lat, lng)], radius_m)
        out = []
        for node in self.nodes.values():
            if node.kind != "place":
                continue
            plat, plng = node.props.get("lat"), node.props.get("lng")
            if plat is None or plng is None or not box.contains(plat, plng):
                continue
            meters = haversine_m(lat, lng, plat, plng)
            if meters <= radius_m:
                out.append(NearPlace(node, meters))
        out.sort(key=lambda p: (p.distance_m, p.node.id))
        return out

    def _remove(self, tour_id: str) -> bool:
        owned = {nid for nid, n in self.nodes.items() if n.tour_id == tour_id}
        for nid in owned:
            del self.nodes[nid]
        for key in [k for k in self.edges if k[0] in owned or k[1] in owned]:
            del self.edges[key]
        for cid in [cid for cid, c in self.chunks.items() if c.tour_id == tour_id]:
            del self.chunks[cid]
            self.vectors.pop(cid, None)
        return bool(owned)

    def _drop_orphans(self) -> None:
        used = {k[0] for k in self.edges} | {k[1] for k in self.edges}
        for nid in [nid for nid, n in self.nodes.items() if n.tour_id is None and nid not in used]:
            del self.nodes[nid]


class PgVectorIndexStore:
    """pgvector store in schema `ai` (sql/schema.sql).

    TODO(#185 follow-up): implement with an async driver (asyncpg or
    psycopg 3 + pgvector), once `DATABASE_URL_AI` and the pgvector Postgres
    image (ai-integration-requests.md section 3) are merged. Plan:

    - upsert_tour: one transaction; `SELECT ... FROM ai.tour_index WHERE tour_id = $1 FOR UPDATE`
      (insert the row if missing) to serialise writers and re-check the revision; delete chunks,
      edges touching the tour's nodes, the nodes; insert nodes (shared ones with ON CONFLICT DO NOTHING),
      edges whose endpoints exist, chunks with vectors; delete orphan shared nodes; update ai.tour_index.
    - delete_tour: same transaction shape, then write the tombstone.
    - places_in_bbox: `kind = 'place' AND lat BETWEEN .. AND lng BETWEEN .. AND tour_id <> $1`.
    - on startup: check `ai.index_meta` (model, dimension) against the embedder; refuse to mix models.
    """

    def __init__(self, dsn: str, dimension: int) -> None:
        raise NotImplementedError("PgVectorIndexStore is not implemented yet: TODO(#185 follow-up)")

    # --- read side, TODO(#219): SQL sketches for the HybridRetriever (#AI-45) ---

    async def get_revisions(self, tour_ids) -> dict[str, TourIndexState]:
        """TODO(#219): SELECT tour_id, revision, state FROM ai.tour_index WHERE tour_id = ANY($1)."""
        raise NotImplementedError("TODO(#219)")

    async def vector_search(
        self, query_vector, k, kinds=None, *, city_keys=None, tour_type=None,
        max_duration_minutes=None, place_type=None,
    ) -> list[ScoredChunk]:
        """TODO(#219): filters in the WHERE clause, before the LIMIT:
        SELECT c.*, 1 - (c.embedding <=> $1) AS score
        FROM ai.chunks c
        JOIN ai.nodes n ON n.id = c.node_id
        JOIN ai.nodes t ON t.id = 'tour:' || c.tour_id
        JOIN ai.tour_index ti ON ti.tour_id = c.tour_id AND ti.state = 'indexed'
        WHERE ($3::text[] IS NULL OR n.kind = ANY($3))
          AND ($4::text[] IS NULL OR EXISTS (SELECT 1 FROM ai.edges e WHERE e.kind = 'has'
               AND e.dst = t.id AND e.src = ANY(SELECT 'city:' || unnest($4))))
          AND ($5::text IS NULL OR t.props->>'type' = $5)
          AND ($6::int IS NULL OR (t.props->>'duration_minutes')::int <= $6)
          AND ($7::text IS NULL OR n.kind <> 'place' OR EXISTS (SELECT 1 FROM ai.edges e
               WHERE e.kind = 'is_a' AND e.src = n.id AND e.dst = 'type:' || $7))
        ORDER BY c.embedding <=> $1 LIMIT $2
        (HNSW cosine index with filters: set hnsw.ef_search well above k, or
        hnsw.iterative_scan = relaxed_order on pgvector >= 0.8, so filtered rows do not starve the top k.)
        """
        raise NotImplementedError("TODO(#219)")

    async def get_nodes(self, ids) -> dict[str, Node]:
        """TODO(#219): SELECT * FROM ai.nodes WHERE id = ANY($1)."""
        raise NotImplementedError("TODO(#219)")

    async def get_chunks(self, node_ids) -> list[Chunk]:
        """TODO(#219): SELECT id, node_id, tour_id, lang, source, text FROM ai.chunks WHERE node_id = ANY($1)."""
        raise NotImplementedError("TODO(#219)")

    async def list_nodes(self, kind) -> list[Node]:
        """TODO(#219): SELECT * FROM ai.nodes WHERE kind = $1 ORDER BY id."""
        raise NotImplementedError("TODO(#219)")

    async def neighbours(self, node_ids, kinds, max_hops=1) -> list[Reach]:
        """TODO(#219): recursive CTE carrying the seed, undirected over ai.edges:
        WITH RECURSIVE walk(seed, node, hops) AS (
          SELECT s, s, 0 FROM unnest($1::text[]) s
          UNION
          SELECT w.seed, CASE WHEN e.src = w.node THEN e.dst ELSE e.src END, w.hops + 1
          FROM walk w JOIN ai.edges e ON (e.src = w.node OR e.dst = w.node) AND e.kind = ANY($2)
          WHERE w.hops < $3)
        SELECT seed, node, min(hops) FROM walk WHERE node <> seed GROUP BY seed, node
        (cap the rows per seed: a city or topic node can fan out to many tours).
        """
        raise NotImplementedError("TODO(#219)")

    async def places_near(self, lat, lng, radius_m) -> list[NearPlace]:
        """TODO(#219): bounding-box prefilter on nodes_place_geo_idx, exact haversine in SQL:
        SELECT *, <haversine(lat, lng, $1, $2)> AS d FROM ai.nodes WHERE kind = 'place'
        AND lat BETWEEN $3 AND $4 AND lng BETWEEN $5 AND $6 AND <d> <= $7 ORDER BY d.
        """
        raise NotImplementedError("TODO(#219)")

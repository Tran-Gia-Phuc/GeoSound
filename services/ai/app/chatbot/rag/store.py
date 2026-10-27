"""Storage of the chatbot index (task #AI-44).

`IndexStore` is the port used by the indexer. Two implementations:

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
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol, Sequence

from app.chatbot.rag.graph_builder import BBox
from app.chatbot.rag.models import Chunk, Edge, Node, PlaceLocation, TourDoc

TourState = Literal["indexed", "deleted"]


@dataclass(frozen=True)
class TourIndexState:
    """Last revision seen for a tour; `deleted` = tombstone after an unpublish."""

    revision: datetime | None
    state: TourState


class IndexStore(Protocol):
    dimension: int

    async def get_revision(self, tour_id: str) -> TourIndexState | None: ...

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

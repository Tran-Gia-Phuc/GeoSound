"""Storage of the chatbot index (task #AI-44).

`IndexStore` is the port used by the indexer (writes) and by the hybrid
retriever (reads, task #AI-45). Two implementations:

- `InMemoryIndexStore`: complete, used by tests (and handy for local demos).
- `PgVectorIndexStore`: pgvector in the shared Postgres, schema `ai`
  (decision 6a, DDL in services/ai/prisma/schema.prisma and post-push.sql), asyncpg
  (issue #219). Integration tests run only when `AI_TEST_DATABASE_URL` is set.

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
import json
import math
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from typing import Collection, Iterable, Literal, Protocol, Sequence
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

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


# ---------------------------------------------------------------------------
# pgvector store (issue #219)
# ---------------------------------------------------------------------------

E5_MODEL_NAME = "intfloat/multilingual-e5-small"

# Query parameters asyncpg understands. Anything else in the URL (Prisma-only keys such as
# `schema`, `pgbouncer`, `connection_limit`) would be sent to the server as a setting and fail.
_DSN_KEEP = frozenset(
    {"sslmode", "sslrootcert", "sslcert", "sslkey", "sslpassword", "sslcrl", "passfile",
     "target_session_attrs", "application_name"}
)
# One advisory lock serialises every index writer (shared city/type/topic nodes are
# touched by several tours). Writes are rare: one per tour.published / unpublished.
_WRITE_LOCK_KEY = 7_219_000_001
_EF_SEARCH_MIN = 40
_EF_SEARCH_MAX = 1000
_COSINE = "OPERATOR(extensions.<=>)"
_NODE_COLS = "id, kind, name, props, tour_id, revision, topics_pending"
_CHUNK_COLS = "id, node_id, tour_id, lang, source, text"


class IndexMetaMismatch(ValueError):
    """`ai.index_meta` records another embedding model or dimension: refuse to mix vectors."""


def clean_dsn(url: str) -> str:
    """Drop the query keys asyncpg does not understand (Prisma's `schema`, `pgbouncer`, ...)."""
    if not url or not url.strip():
        raise ValueError("database url is empty")
    parts = urlsplit(url.strip())
    if parts.scheme not in ("postgres", "postgresql"):
        raise ValueError("database url must use the postgresql scheme")
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k in _DSN_KEEP]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ""))


def encode_vector(values: Sequence[float]) -> str:
    """pgvector text format '[0.1,0.2,...]'. NaN and infinity are refused (pgvector would too)."""
    out = []
    for value in values:
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("vector values must be finite")
        out.append(repr(number))
    return "[" + ",".join(out) + "]"


def decode_vector(text: str) -> list[float]:
    body = text.strip()
    if not (body.startswith("[") and body.endswith("]")):
        raise ValueError("not a pgvector text value")
    body = body[1:-1].strip()
    return [float(x) for x in body.split(",")] if body else []


def _rows_affected(status: str) -> int:
    try:
        return int(status.rsplit(" ", 1)[-1])
    except (ValueError, AttributeError):
        return 0


def _node_from_row(row) -> Node:
    return Node(
        id=row["id"],
        kind=row["kind"],
        name=row["name"],
        props=dict(row["props"] or {}),
        tour_id=row["tour_id"],
        revision=row["revision"],
        topics_pending=row["topics_pending"],
    )


def _chunk_from_row(row) -> Chunk:
    return Chunk(row["id"], row["node_id"], row["tour_id"], row["lang"], row["source"], row["text"])


async def _init_connection(conn) -> None:
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
    await conn.set_type_codec("json", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


class PgVectorIndexStore:
    """pgvector store in schema `ai` (services/ai/prisma/schema.prisma, post-push.sql).

    - The asyncpg pool is created lazily on first use, from `DATABASE_URL_AI` cleaned of
      Prisma-only query keys. `statement_cache_size=0` because the URL goes through the
      Supabase transaction pooler (pgbouncer mode). Tables, the vector type and the cosine
      operator are schema-qualified, so the queries do not depend on `search_path`.
    - Vectors are sent as pgvector text ('[...]') and cast with `::extensions.vector`.
    - `ai.index_meta` (model, dimension) is checked when the pool opens and written on the
      first upsert; a mismatch raises IndexMetaMismatch (never mix two embedding models).
    - Writes take one transaction-scoped advisory lock and re-check the revision inside it.
    - Results equal InMemoryIndexStore's (same dataclasses, same filters, same ordering:
      chunks and nodes by id, near places by distance then id).
    """

    def __init__(
        self,
        dsn: str,
        dimension: int,
        *,
        embedding_model: str = E5_MODEL_NAME,
        min_size: int = 1,
        max_size: int = 5,
    ) -> None:
        if dimension <= 0:
            raise ValueError("dimension must be positive")
        self._dsn = clean_dsn(dsn)
        self.dimension = dimension
        self.embedding_model = embedding_model
        self._min_size = min_size
        self._max_size = max_size
        self._pool = None
        self._pool_lock = asyncio.Lock()

    def __repr__(self) -> str:  # never show the DSN: it holds the password
        return f"PgVectorIndexStore(dimension={self.dimension}, model={self.embedding_model!r})"

    # --- connection ---

    async def _get_pool(self):
        if self._pool is not None:
            return self._pool
        async with self._pool_lock:
            if self._pool is None:
                import asyncpg  # lazy: the in-memory store and the unit tests need no driver

                pool = await asyncpg.create_pool(
                    dsn=self._dsn,
                    min_size=self._min_size,
                    max_size=self._max_size,
                    statement_cache_size=0,  # transaction pooler: no prepared statements; no startup search_path
                    init=_init_connection,
                )
                try:
                    async with pool.acquire() as conn:
                        await self._check_meta(conn, write=False)
                except BaseException:
                    await pool.close()
                    raise
                self._pool = pool
        return self._pool

    async def aclose(self) -> None:
        """Close the pool (call on app shutdown). Safe when the pool was never opened."""
        pool, self._pool = self._pool, None
        if pool is not None:
            await pool.close()

    async def _check_meta(self, conn, *, write: bool) -> None:
        if write:
            await conn.execute(
                "INSERT INTO ai.index_meta (id, embedding_model, dimension) VALUES (1, $1, $2) "
                "ON CONFLICT (id) DO NOTHING",
                self.embedding_model,
                self.dimension,
            )
        row = await conn.fetchrow("SELECT embedding_model, dimension FROM ai.index_meta WHERE id = 1")
        if row is None:
            return
        if row["dimension"] != self.dimension or row["embedding_model"] != self.embedding_model:
            raise IndexMetaMismatch(
                f"index built with {row['embedding_model']} ({row['dimension']}), "
                f"store configured for {self.embedding_model} ({self.dimension})"
            )

    def _check_dimension(self, vector: Sequence[float]) -> None:
        if len(vector) != self.dimension:
            raise ValueError(f"vector dimension must be {self.dimension}")

    # --- write side ---

    async def get_revision(self, tour_id: str) -> TourIndexState | None:
        return (await self.get_revisions([tour_id])).get(tour_id)

    async def upsert_tour(self, doc, nodes, edges, chunks, vectors, revision) -> bool:
        if len(chunks) != len(vectors):
            raise ValueError("one vector per chunk")
        for vector in vectors:
            self._check_dimension(vector)
        encoded = [encode_vector(v) for v in vectors]
        pool = await self._get_pool()
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock($1::bigint)", _WRITE_LOCK_KEY)
            await self._check_meta(conn, write=True)
            current = await conn.fetchrow(
                "SELECT revision FROM ai.tour_index WHERE tour_id = $1 FOR UPDATE", doc.tour_id
            )
            if current is not None and not _is_newer(revision, current["revision"]):
                return False
            await self._remove(conn, doc.tour_id)

            shared = [n for n in nodes if n.tour_id is None]
            owned = [n for n in nodes if n.tour_id is not None]
            insert_node = (
                f"INSERT INTO ai.nodes ({_NODE_COLS}, lat, lng) "
                "VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9) "
            )
            if shared:  # shared node (city, type, topic): keep the existing row
                await conn.executemany(
                    insert_node + "ON CONFLICT (id) DO NOTHING", [self._node_args(n) for n in shared]
                )
            if owned:
                await conn.executemany(
                    insert_node
                    + "ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, name = EXCLUDED.name, "
                    "props = EXCLUDED.props, tour_id = EXCLUDED.tour_id, revision = EXCLUDED.revision, "
                    "topics_pending = EXCLUDED.topics_pending, lat = EXCLUDED.lat, lng = EXCLUDED.lng",
                    [self._node_args(n) for n in owned],
                )
            if edges:  # an endpoint removed meanwhile: skip the dangling edge, like the in-memory store
                await conn.executemany(
                    "INSERT INTO ai.edges (src, dst, kind, props) "
                    "SELECT $1::text, $2::text, $3::text, $4::jsonb "
                    "WHERE EXISTS (SELECT 1 FROM ai.nodes WHERE id = $1::text) "
                    "AND EXISTS (SELECT 1 FROM ai.nodes WHERE id = $2::text) "
                    "ON CONFLICT (src, dst, kind) DO UPDATE SET props = EXCLUDED.props",
                    [(e.src, e.dst, e.kind, dict(e.props)) for e in edges],
                )
            if chunks:
                await conn.executemany(
                    f"INSERT INTO ai.chunks ({_CHUNK_COLS}, embedding) "
                    "VALUES ($1, $2, $3, $4, $5, $6, $7::extensions.vector) "
                    "ON CONFLICT (id) DO UPDATE SET node_id = EXCLUDED.node_id, tour_id = EXCLUDED.tour_id, "
                    "lang = EXCLUDED.lang, source = EXCLUDED.source, text = EXCLUDED.text, "
                    "embedding = EXCLUDED.embedding",
                    [(c.id, c.node_id, c.tour_id, c.lang, c.source, c.text, v) for c, v in zip(chunks, encoded)],
                )
            await self._drop_orphans(conn)
            await self._set_state(conn, doc.tour_id, revision, "indexed")
            await conn.execute("UPDATE ai.index_meta SET updated_at = now() WHERE id = 1")
            return True

    async def delete_tour(self, tour_id: str, revision: datetime | None = None) -> bool:
        pool = await self._get_pool()
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock($1::bigint)", _WRITE_LOCK_KEY)
            current = await conn.fetchrow(
                "SELECT revision FROM ai.tour_index WHERE tour_id = $1 FOR UPDATE", tour_id
            )
            removed = await self._remove(conn, tour_id)
            await self._drop_orphans(conn)
            old = current["revision"] if current is not None else None
            keep = revision if _is_newer(revision, old) else old
            await self._set_state(conn, tour_id, keep, "deleted")
            return removed

    @staticmethod
    def _node_args(node: Node) -> tuple:
        lat = lng = None
        if node.kind == "place":
            lat, lng = node.props.get("lat"), node.props.get("lng")
        return (node.id, node.kind, node.name, dict(node.props), node.tour_id, node.revision,
                node.topics_pending, lat, lng)

    @staticmethod
    async def _remove(conn, tour_id: str) -> bool:
        await conn.execute("DELETE FROM ai.chunks WHERE tour_id = $1", tour_id)
        await conn.execute(
            "DELETE FROM ai.edges e USING ai.nodes n "
            "WHERE n.tour_id = $1 AND (e.src = n.id OR e.dst = n.id)",
            tour_id,
        )
        return _rows_affected(await conn.execute("DELETE FROM ai.nodes WHERE tour_id = $1", tour_id)) > 0

    @staticmethod
    async def _drop_orphans(conn) -> None:
        await conn.execute(
            "DELETE FROM ai.nodes n WHERE n.tour_id IS NULL AND NOT EXISTS "
            "(SELECT 1 FROM ai.edges e WHERE e.src = n.id OR e.dst = n.id)"
        )

    @staticmethod
    async def _set_state(conn, tour_id: str, revision: datetime | None, state: TourState) -> None:
        await conn.execute(
            "INSERT INTO ai.tour_index (tour_id, revision, state, updated_at) VALUES ($1, $2, $3, now()) "
            "ON CONFLICT (tour_id) DO UPDATE SET revision = EXCLUDED.revision, state = EXCLUDED.state, "
            "updated_at = now()",
            tour_id,
            revision,
            state,
        )

    # --- read side (#AI-45) ---

    async def get_revisions(self, tour_ids) -> dict[str, TourIndexState]:
        ids = list(dict.fromkeys(tour_ids))
        if not ids:
            return {}
        pool = await self._get_pool()
        rows = await pool.fetch(
            "SELECT tour_id, revision, state FROM ai.tour_index WHERE tour_id = ANY($1::text[])", ids
        )
        return {r["tour_id"]: TourIndexState(r["revision"], r["state"]) for r in rows}

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
        self._check_dimension(query_vector)
        vector = encode_vector(query_vector)
        kind_list = list(kinds) if kinds is not None else None
        city_ids = [f"city:{key}" for key in city_keys] if city_keys is not None else None
        # Slug in Python: SQL cannot reproduce slugify() (accents, đ).
        type_key = slugify(place_type) if place_type else ""
        type_id = f"type:{type_key}" if type_key else None
        sql = f"""
            SELECT c.id, c.node_id, c.tour_id, c.lang, c.source, c.text,
                   1 - (c.embedding {_COSINE} $1::extensions.vector) AS score
            FROM ai.chunks c
            JOIN ai.nodes n ON n.id = c.node_id
            JOIN ai.tour_index ti ON ti.tour_id = c.tour_id AND ti.state = 'indexed'
            JOIN ai.nodes t ON t.id = 'tour:' || n.tour_id
            WHERE ($3::text[] IS NULL OR n.kind = ANY($3::text[]))
              AND ($4::text[] IS NULL OR EXISTS (
                    SELECT 1 FROM ai.edges e
                    WHERE e.kind = 'has' AND e.dst = t.id AND e.src = ANY($4::text[])))
              AND ($5::text IS NULL OR t.props->>'type' = $5::text)
              AND ($6::int IS NULL OR (t.props->>'duration_minutes')::numeric <= $6::int)
              AND ($7::text IS NULL OR n.kind <> 'place' OR EXISTS (
                    SELECT 1 FROM ai.edges e
                    WHERE e.kind = 'is_a' AND e.src = n.id AND e.dst = $7::text))
            ORDER BY c.embedding {_COSINE} $1::extensions.vector, c.id
            LIMIT $2
        """
        # HNSW + WHERE filters: widen the candidate list so filtered rows do not starve the top k.
        ef_search = str(min(_EF_SEARCH_MAX, max(_EF_SEARCH_MIN, k * 10)))
        duration = None if max_duration_minutes is None else int(max_duration_minutes)
        pool = await self._get_pool()
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT set_config('hnsw.ef_search', $1, true)", ef_search)
            # pgvector >= 0.8: keep scanning until the WHERE filters leave k rows (ignored by older versions).
            await conn.execute("SELECT set_config('hnsw.iterative_scan', 'strict_order', true)")
            rows = await conn.fetch(
                sql, vector, k, kind_list, city_ids, tour_type or None, duration, type_id
            )
        return [ScoredChunk(_chunk_from_row(r), float(r["score"])) for r in rows]

    async def get_nodes(self, ids) -> dict[str, Node]:
        wanted = list(dict.fromkeys(ids))
        if not wanted:
            return {}
        pool = await self._get_pool()
        rows = await pool.fetch(f"SELECT {_NODE_COLS} FROM ai.nodes WHERE id = ANY($1::text[])", wanted)
        return {r["id"]: _node_from_row(r) for r in rows}

    async def get_chunks(self, node_ids) -> list[Chunk]:
        wanted = list(dict.fromkeys(node_ids))
        if not wanted:
            return []
        pool = await self._get_pool()
        rows = await pool.fetch(
            f"SELECT {_CHUNK_COLS} FROM ai.chunks WHERE node_id = ANY($1::text[]) ORDER BY id", wanted
        )
        return [_chunk_from_row(r) for r in rows]

    async def list_nodes(self, kind) -> list[Node]:
        pool = await self._get_pool()
        rows = await pool.fetch(f"SELECT {_NODE_COLS} FROM ai.nodes WHERE kind = $1 ORDER BY id", kind)
        return [_node_from_row(r) for r in rows]

    async def neighbours(self, node_ids, kinds, max_hops=1) -> list[Reach]:
        seeds = list(dict.fromkeys(node_ids))
        edge_kinds = list(dict.fromkeys(kinds))
        if not seeds or not edge_kinds or max_hops <= 0:
            return []
        # Undirected walk carrying its seed; UNION dedupes rows, the hop bound stops cycles.
        sql = """
            WITH RECURSIVE walk(pos, seed, node, hops) AS (
                SELECT s.pos, s.seed, s.seed, 0
                FROM unnest($1::text[]) WITH ORDINALITY AS s(seed, pos)
              UNION
                SELECT w.pos, w.seed, CASE WHEN e.src = w.node THEN e.dst ELSE e.src END, w.hops + 1
                FROM walk w
                JOIN ai.edges e ON (e.src = w.node OR e.dst = w.node) AND e.kind = ANY($2::text[])
                WHERE w.hops < $3
            )
            SELECT pos, seed, node, min(hops) AS hops
            FROM walk WHERE node <> seed
            GROUP BY pos, seed, node
            ORDER BY pos, hops, node
        """
        pool = await self._get_pool()
        rows = await pool.fetch(sql, seeds, edge_kinds, int(max_hops))
        return [Reach(r["seed"], r["node"], int(r["hops"])) for r in rows]

    async def places_near(self, lat, lng, radius_m) -> list[NearPlace]:
        box = near_bbox([(lat, lng)], radius_m)
        pool = await self._get_pool()
        # Bounding-box prefilter (nodes_place_geo_idx); exact haversine in Python, same formula
        # as the in-memory store.
        rows = await pool.fetch(
            f"SELECT {_NODE_COLS}, lat, lng FROM ai.nodes WHERE kind = 'place' "
            "AND lat BETWEEN $1 AND $2 AND lng BETWEEN $3 AND $4",
            box.min_lat, box.max_lat, box.min_lng, box.max_lng,
        )
        out = []
        for row in rows:
            meters = haversine_m(lat, lng, row["lat"], row["lng"])
            if meters <= radius_m:
                out.append(NearPlace(_node_from_row(row), meters))
        out.sort(key=lambda p: (p.distance_m, p.node.id))
        return out

    async def places_in_bbox(self, box: BBox, exclude_tour_id: str) -> list[PlaceLocation]:
        pool = await self._get_pool()
        rows = await pool.fetch(
            "SELECT id, tour_id, lat, lng FROM ai.nodes WHERE kind = 'place' "
            "AND lat BETWEEN $1 AND $2 AND lng BETWEEN $3 AND $4 "
            "AND tour_id IS DISTINCT FROM $5 ORDER BY id",
            box.min_lat, box.max_lat, box.min_lng, box.max_lng, exclude_tour_id,
        )
        return [PlaceLocation(r["id"].removeprefix("place:"), r["tour_id"], r["lat"], r["lng"]) for r in rows]

"""Ingest of public tours into the chatbot index (task #AI-44, issue #185).

`Indexer` handles `tour.published` and `tour.unpublished` (D21). Guards
(docs/02-design/chatbot-architecture.md section 6b):

- only `status == 'public'` is indexed; any other status is handled as an unpublish
- idempotent by revision: same revision -> no-op, older revision -> ignored,
  newer revision -> the whole tour is replaced in one store transaction
- `tour.unpublished` deletes the tour, its places, their chunks and edges, and
  leaves a tombstone so a late older `tour.published` is ignored

The handlers never raise. They return an outcome string; only `OUTCOME_ERROR`
is worth a retry (store or embedder failure). Invalid payloads are permanent.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from app.chatbot.rag.chunker import build_chunks
from app.chatbot.rag.embedder import Embedder
from app.chatbot.rag.graph_builder import TopicExtractor, build_graph, near_bbox
from app.chatbot.rag.models import InvalidPayload, parse_tour_published, parse_tour_unpublished
from app.chatbot.rag.store import IndexStore, TourIndexState

log = logging.getLogger(__name__)

OUTCOME_INDEXED = "indexed"
OUTCOME_DUPLICATE = "duplicate"  # same revision already handled
OUTCOME_STALE = "stale"  # older than what the index already knows
OUTCOME_DELETED = "deleted"
OUTCOME_NOT_FOUND = "not_found"  # unpublish of a tour that was not indexed (tombstone written)
OUTCOME_NOT_PUBLIC = "not_public"  # tour.published with a status other than public: removed
OUTCOME_INVALID = "invalid"  # malformed payload, permanent
OUTCOME_ERROR = "error"  # temporary failure, retry later

RETRYABLE = frozenset({OUTCOME_ERROR})


def _compare(revision: datetime | None, known: TourIndexState | None) -> str | None:
    """OUTCOME_DUPLICATE / OUTCOME_STALE when `revision` must be ignored, else None."""
    if known is None or known.revision is None or revision is None:
        return None
    if revision == known.revision:
        return OUTCOME_DUPLICATE
    if revision < known.revision:
        return OUTCOME_STALE
    return None


class Indexer:
    def __init__(
        self,
        store: IndexStore,
        embedder: Embedder,
        topic_extractor: TopicExtractor | None = None,
    ) -> None:
        if store.dimension != embedder.dimension:
            raise ValueError(
                f"embedder dimension {embedder.dimension} does not match store dimension {store.dimension}"
            )
        self.store = store
        self.embedder = embedder
        self.topic_extractor = topic_extractor

    async def handle_published(self, payload: Any) -> str:
        try:
            doc = parse_tour_published(payload)
        except InvalidPayload as exc:
            log.warning("chatbot index: %s", exc)
            return OUTCOME_INVALID
        try:
            known = await self.store.get_revision(doc.tour_id)
            skip = _compare(doc.revision, known)
            if skip:
                log.info("chatbot index: tour %s %s revision ignored", doc.tour_id, skip)
                return skip

            if doc.status != "public":
                await self.store.delete_tour(doc.tour_id, doc.revision)
                log.info("chatbot index: tour %s not public, removed", doc.tour_id)
                return OUTCOME_NOT_PUBLIC

            topics, pending = None, True
            if self.topic_extractor is not None:
                try:
                    topics = await self.topic_extractor.extract(doc)
                    pending = topics is None
                except Exception:  # noqa: BLE001 - topics are optional, index without them
                    log.warning("chatbot index: topic extraction failed for tour %s", doc.tour_id)

            box = near_bbox((p.lat, p.lng) for p in doc.places)
            neighbours = await self.store.places_in_bbox(box, doc.tour_id) if box else []
            nodes, edges = build_graph(doc, neighbours, topics, topics_pending=pending)
            chunks = build_chunks(doc)
            # The real model is CPU bound: keep it off the event loop.
            texts = [c.text for c in chunks]
            vectors = await asyncio.to_thread(self.embedder.embed_documents, texts) if texts else []

            written = await self.store.upsert_tour(doc, nodes, edges, chunks, vectors, doc.revision)
        except Exception as exc:  # noqa: BLE001 - never raise: the consumer decides on retry
            log.error("chatbot index: indexing tour failed (%s)", type(exc).__name__)
            return OUTCOME_ERROR
        if not written:  # a concurrent writer stored the same or a newer revision
            return OUTCOME_DUPLICATE
        log.info(
            "chatbot index: tour %s indexed (%d nodes, %d edges, %d chunks)",
            doc.tour_id,
            len(nodes),
            len(edges),
            len(chunks),
        )
        return OUTCOME_INDEXED

    async def handle_unpublished(self, payload: Any) -> str:
        try:
            tour_id, revision, reason = parse_tour_unpublished(payload)
        except InvalidPayload as exc:
            log.warning("chatbot index: %s", exc)
            return OUTCOME_INVALID
        try:
            known = await self.store.get_revision(tour_id)
            # Only an unpublish strictly older than an indexed revision is ignored:
            # the tour was published again after it. Without a revision, always delete.
            if (
                known is not None
                and known.state == "indexed"
                and _compare(revision, known) == OUTCOME_STALE
            ):
                return OUTCOME_STALE
            removed = await self.store.delete_tour(tour_id, revision)
        except Exception as exc:  # noqa: BLE001
            log.error("chatbot index: removing tour failed (%s)", type(exc).__name__)
            return OUTCOME_ERROR
        log.info("chatbot index: tour %s removed (%s)", tour_id, reason)
        return OUTCOME_DELETED if removed else OUTCOME_NOT_FOUND

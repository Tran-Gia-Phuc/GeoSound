"""RabbitMQ entry point of the chatbot indexer (task #AI-44, D21).

The chatbot indexer is the ONLY RabbitMQ consumer of the AI service; moderation
stays HTTP only. It is off unless `CHATBOT_INDEXER_ENABLED=true`.

This module holds the transport-free part: `IndexEventDispatcher` decodes a
message body and routes it by routing key to the `Indexer`, and
`should_requeue` tells the transport what to do with the outcome.

TODO(#188): wire a real transport. No AMQP client (aio-pika / pika) is in
requirements.txt yet, and the pgvector store and the local embedder are still
TODO(#185 follow-up), so `start_indexer` only logs that the indexer is not
wired. The transport will bind a durable queue (e.g. `ai.chatbot-index`) to
the topic exchange `RABBITMQ_EXCHANGE` with the keys in `ROUTING_KEYS`, ack
every outcome except `error`, and retry `error` later (never a tight requeue loop).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.chatbot.rag.indexer import OUTCOME_INVALID, RETRYABLE, Indexer

log = logging.getLogger(__name__)

TOUR_PUBLISHED = "tour.published"
TOUR_UNPUBLISHED = "tour.unpublished"
# tour.hidden is consumed too once a service publishes it (ai-integration-requests.md).
TOUR_HIDDEN = "tour.hidden"
ROUTING_KEYS = (TOUR_PUBLISHED, TOUR_UNPUBLISHED)

OUTCOME_IGNORED = "ignored"  # routing key this consumer does not handle


def should_requeue(outcome: str) -> bool:
    """True only for temporary failures; everything else is acked."""
    return outcome in RETRYABLE


class IndexEventDispatcher:
    def __init__(self, indexer: Indexer) -> None:
        self.indexer = indexer

    async def dispatch(self, routing_key: str, body: bytes | str | dict[str, Any]) -> str:
        """Handle one message. Never raises."""
        if routing_key not in ROUTING_KEYS:
            return OUTCOME_IGNORED
        if isinstance(body, dict):
            payload: Any = body
        else:
            try:
                payload = json.loads(body)
            except (ValueError, TypeError):
                log.warning("chatbot index: %s body is not JSON", routing_key)
                return OUTCOME_INVALID
        if routing_key == TOUR_PUBLISHED:
            return await self.indexer.handle_published(payload)
        return await self.indexer.handle_unpublished(payload)


def start_indexer(settings) -> object | None:
    """Start the indexer consumer when the flag is on. Returns a handle or None.

    With `chatbot_indexer_enabled` false (the default) nothing is created.
    """
    if not getattr(settings, "chatbot_indexer_enabled", False):
        return None
    # TODO(#188): build PgVectorIndexStore + LocalE5Embedder + Indexer and an AMQP consumer here.
    log.warning("CHATBOT_INDEXER_ENABLED is true but the indexer transport is not wired yet (TODO #219)")
    return None

"""RabbitMQ entry point of the chatbot indexer (task #AI-44, D21, issue #219).

The chatbot indexer is the ONLY RabbitMQ consumer of the AI service; moderation
stays HTTP only. It is off unless `CHATBOT_INDEXER_ENABLED=true`.

- `IndexEventDispatcher` decodes a message body and routes it by routing key to
  the `Indexer` (`tour.hidden` is handled as an unpublish).
- `handle_message` turns the outcome into an AMQP decision: every outcome except
  `error` is acked (invalid JSON / payload is rejected without requeue). An
  `error` is retried at most `CHATBOT_INDEXER_MAX_RETRIES` times: after a short
  delay the message is re-sent to this queue only (default exchange, routing key
  = queue name) with the header `x-retry-count` + 1, then the original is acked.
  A plain `nack(requeue=True)` cannot count attempts and would loop tightly, so
  it is only the fallback when the re-send itself fails. Past the limit the
  message is rejected without requeue and one error line is logged.
- `start_indexer` connects (aio-pika, robust connection), declares the topic
  exchange `RABBITMQ_EXCHANGE` (durable) and the durable queue
  `CHATBOT_INDEXER_QUEUE` bound to `ROUTING_KEYS`, with prefetch 1.

Logs never contain the message body, user text or connection strings.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from app.chatbot.rag.indexer import OUTCOME_INVALID, RETRYABLE, Indexer

log = logging.getLogger(__name__)

TOUR_PUBLISHED = "tour.published"
TOUR_UNPUBLISHED = "tour.unpublished"
# tour.hidden is handled as an unpublish (reason "hidden") when a service publishes it.
TOUR_HIDDEN = "tour.hidden"
ROUTING_KEYS = (TOUR_PUBLISHED, TOUR_UNPUBLISHED, TOUR_HIDDEN)

OUTCOME_IGNORED = "ignored"  # routing key this consumer does not handle

RETRY_HEADER = "x-retry-count"

# Message-level decisions returned by handle_message (for logs and tests).
ACKED = "acked"
REJECTED = "rejected"
RETRIED = "retried"
REQUEUED = "requeued"


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
        if routing_key == TOUR_HIDDEN and isinstance(payload, dict):
            payload = {**payload, "reason": payload.get("reason") or "hidden"}
        return await self.indexer.handle_unpublished(payload)


def retry_count(message: Any) -> int:
    headers = getattr(message, "headers", None) or {}
    try:
        return max(0, int(headers.get(RETRY_HEADER, 0)))
    except (TypeError, ValueError):
        return 0


Resend = Callable[[Any, int], Awaitable[None]]


async def handle_message(
    dispatcher: IndexEventDispatcher,
    message: Any,
    *,
    resend: Resend,
    max_retries: int,
    retry_delay: float = 0.0,
) -> str:
    """Process one AMQP message and settle it. Never raises.

    `message` needs `routing_key`, `body`, `headers`, `ack()`, `reject(requeue=)`
    and `nack(requeue=)` (aio-pika's IncomingMessage). `resend(message, count)`
    re-sends the body to this queue with `x-retry-count = count`.
    """
    key = message.routing_key or ""
    try:
        outcome = await dispatcher.dispatch(key, message.body)
    except Exception as exc:  # noqa: BLE001 - dispatch never raises; belt and braces
        log.error("chatbot index: %s handler failed (%s)", key, type(exc).__name__)
        outcome = "error"

    if outcome == OUTCOME_INVALID:
        await message.reject(requeue=False)
        return REJECTED
    if not should_requeue(outcome):
        await message.ack()
        return ACKED

    attempts = retry_count(message)
    if attempts >= max_retries:
        log.error("chatbot index: %s failed after %d retries, dropped", key, attempts)
        await message.reject(requeue=False)
        return REJECTED
    if retry_delay > 0:
        await asyncio.sleep(retry_delay)  # no tight loop while the store is down
    try:
        await resend(message, attempts + 1)
    except Exception as exc:  # noqa: BLE001 - broker trouble: let RabbitMQ redeliver
        log.warning("chatbot index: re-send failed (%s), requeued", type(exc).__name__)
        await message.nack(requeue=True)
        return REQUEUED
    await message.ack()
    log.info("chatbot index: %s retry %d/%d scheduled", key, attempts + 1, max_retries)
    return RETRIED


class IndexerHandle:
    """Running consumer. `aclose()` stops consuming, closes AMQP, then the store pool."""

    def __init__(self, connection: Any, queue: Any, consumer_tag: Any, store: Any) -> None:
        self.connection = connection
        self.queue = queue
        self.consumer_tag = consumer_tag
        self.store = store

    async def aclose(self) -> None:
        for step in (self._cancel, self._close_connection, self._close_store):
            try:
                await step()
            except Exception as exc:  # noqa: BLE001 - shutdown must finish
                log.warning("chatbot index: shutdown step failed (%s)", type(exc).__name__)

    async def _cancel(self) -> None:
        if self.queue is not None and self.consumer_tag is not None:
            await self.queue.cancel(self.consumer_tag)

    async def _close_connection(self) -> None:
        if self.connection is not None:
            await self.connection.close()

    async def _close_store(self) -> None:
        close = getattr(self.store, "aclose", None)
        if close is not None:
            await close()


def build_indexer(settings) -> tuple[Indexer, Any] | None:
    """(Indexer, store) over pgvector, or None with one clear log line."""
    if not (settings.database_url_ai or "").strip():
        log.error("chatbot indexer not started: DATABASE_URL_AI is empty")
        return None
    try:
        from app.chatbot.rag.embedder import build_embedder
        from app.chatbot.rag.store import PgVectorIndexStore

        embedder = build_embedder(settings)
        store = PgVectorIndexStore(settings.database_url_ai, embedder.dimension)
        return Indexer(store, embedder), store
    except Exception as exc:  # noqa: BLE001 - never echo the DSN, only the error type
        log.error("chatbot indexer not started: embedder or store unavailable (%s)",
                  type(exc).__name__)
        return None


async def start_indexer(settings, *, connect: Callable[..., Awaitable[Any]] | None = None
                        ) -> IndexerHandle | None:
    """Start the indexer consumer when the flag is on. Returns a handle or None.

    With `chatbot_indexer_enabled` false (the default) nothing is created. Without
    DATABASE_URL_AI or a working embedder nothing is started either (one log line).
    """
    if not getattr(settings, "chatbot_indexer_enabled", False):
        return None
    built = build_indexer(settings)
    if built is None:
        return None
    indexer, store = built

    import aio_pika

    connect = connect or aio_pika.connect_robust
    try:
        connection = await connect(settings.rabbitmq_url)
    except Exception as exc:  # noqa: BLE001 - never log the URL (it holds credentials)
        log.error("chatbot indexer not started: RabbitMQ connection failed (%s)", type(exc).__name__)
        try:
            await store.aclose()
        except Exception as close_exc:  # noqa: BLE001 - startup must not fail because of cleanup
            log.warning("chatbot indexer store close failed (%s)", type(close_exc).__name__)
        return None

    try:
        channel = await connection.channel()
        await channel.set_qos(prefetch_count=1)
        exchange = await channel.declare_exchange(
            settings.rabbitmq_exchange, aio_pika.ExchangeType.TOPIC, durable=True)
        queue_name = settings.chatbot_indexer_queue
        queue = await channel.declare_queue(queue_name, durable=True)
        for key in ROUTING_KEYS:
            await queue.bind(exchange, routing_key=key)

        async def resend(message: Any, count: int) -> None:
            headers = dict(message.headers or {})
            headers[RETRY_HEADER] = count
            headers["x-original-routing-key"] = message.routing_key
            copy = aio_pika.Message(
                body=message.body,
                headers=headers,
                content_type=message.content_type,
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            )
            await channel.default_exchange.publish(copy, routing_key=queue_name)

        dispatcher = IndexEventDispatcher(indexer)

        async def on_message(message: Any) -> None:
            original = (message.headers or {}).get("x-original-routing-key")
            if original:  # a re-sent retry arrives with routing key = queue name
                message = _Rerouted(message, str(original))
            await handle_message(
                dispatcher, message, resend=resend,
                max_retries=settings.chatbot_indexer_max_retries,
                retry_delay=settings.chatbot_indexer_retry_delay_seconds,
            )

        tag = await queue.consume(on_message)
    except Exception as exc:  # noqa: BLE001
        log.error("chatbot indexer not started: queue setup failed (%s)", type(exc).__name__)
        await IndexerHandle(connection, None, None, store).aclose()
        return None

    log.info("chatbot indexer started on queue %s (%s)", queue_name, ", ".join(ROUTING_KEYS))
    return IndexerHandle(connection, queue, tag, store)


class _Rerouted:
    """A re-sent message seen with its original routing key."""

    def __init__(self, message: Any, routing_key: str) -> None:
        self._message = message
        self.routing_key = routing_key

    def __getattr__(self, name: str) -> Any:
        return getattr(self._message, name)

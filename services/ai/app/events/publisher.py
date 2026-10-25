import json
import logging
from typing import Any

from aio_pika import DeliveryMode, Message

logger = logging.getLogger(__name__)


class EventPublisher:
    """Publishes events to the shared topic exchange (routing key = event name)."""

    def __init__(self, exchange: Any) -> None:
        self._exchange = exchange

    async def publish(self, event_name: str, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        message = Message(
            body,
            content_type="application/json",
            delivery_mode=DeliveryMode.PERSISTENT,
        )
        await self._exchange.publish(message, routing_key=event_name)
        logger.info("event -> %s tour=%s", event_name, payload.get("tourId"))

import asyncio
import json

from aio_pika import DeliveryMode

from app.events.publisher import EventPublisher


class FakeExchange:
    def __init__(self):
        self.sent = []

    async def publish(self, message, routing_key):
        self.sent.append((routing_key, message))


def test_publish_sends_json_with_routing_key():
    exchange = FakeExchange()
    payload = {"tourId": "t1", "reason": "Lừa đảo"}
    asyncio.run(EventPublisher(exchange).publish("tour.ai_rejected", payload))

    key, message = exchange.sent[0]
    assert key == "tour.ai_rejected"
    assert json.loads(message.body.decode("utf-8")) == payload
    assert message.content_type == "application/json"
    assert message.delivery_mode == DeliveryMode.PERSISTENT

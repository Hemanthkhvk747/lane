import json

import redis

from app.config import settings

CHANNEL = "lane.orders"


def publish_order_event(payload: dict) -> None:
    client = redis.from_url(settings.redis_url, decode_responses=True)
    try:
        client.publish(CHANNEL, json.dumps(payload))
    except Exception:
        return
    finally:
        client.close()

import asyncio
import json
from contextlib import suppress

import redis.asyncio as aioredis
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from jwt import InvalidTokenError
from sqlalchemy import select
from starlette.websockets import WebSocketState

from app.config import settings
from app.db import SessionLocal
from app.events import CHANNEL
from app.models import Store, User
from app.security import decode_access_token

router = APIRouter()


def _session_user(token: str) -> tuple[int, str, int | None] | None:
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except (InvalidTokenError, KeyError, ValueError, TypeError):
        return None
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None:
            return None
        store_id = None
        if user.role == "store":
            store = db.scalar(select(Store).where(Store.owner_user_id == user.id))
            store_id = store.id if store else None
        return user.id, user.role, store_id
    finally:
        db.close()


@router.websocket("/ws")
async def order_feed(websocket: WebSocket, token: str = Query(...)):
    session = _session_user(token)
    if session is None:
        await websocket.close(code=1008)
        return
    user_id, role, store_id = session
    await websocket.accept()
    client = aioredis.from_url(settings.redis_url, decode_responses=True)
    pubsub = client.pubsub()
    await pubsub.subscribe(CHANNEL)
    try:
        # Poll so uvicorn --reload can exit instead of blocking on listen().
        while websocket.client_state == WebSocketState.CONNECTED:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message is None or message.get("type") != "message":
                continue
            data = json.loads(message.get("data"))
            if role == "customer" and int(data.get("customer_user_id", -1)) != user_id:
                continue
            if role == "store" and int(data.get("store_id", -1)) != (store_id or -1):
                continue
            if role == "rider":
                if data.get("status") not in ("preparing", "out_for_delivery", "delivered"):
                    continue
            elif role not in ("customer", "store"):
                continue
            await websocket.send_text(json.dumps(data))
    except WebSocketDisconnect:
        pass
    except asyncio.CancelledError:
        raise
    finally:
        with suppress(Exception):
            await pubsub.unsubscribe(CHANNEL)
        with suppress(Exception):
            await pubsub.aclose()
        with suppress(Exception):
            await client.aclose()

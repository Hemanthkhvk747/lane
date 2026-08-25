from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.events import publish_order_event
from app.models import Order, PaymentEvent
from app.schemas import PaymentWebhook

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/payment")
def payment_webhook(body: PaymentWebhook, db: Annotated[Session, Depends(get_db)]):
    existing = db.get(PaymentEvent, body.event_id)
    if existing:
        return {"duplicate": True, "event_id": body.event_id, "order_id": existing.order_id}

    order = db.get(Order, body.order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    db.add(PaymentEvent(event_id=body.event_id, order_id=order.id))
    db.commit()
    publish_order_event(
        {
            "order_id": order.id,
            "status": order.status,
            "store_id": order.store_id,
            "customer_user_id": order.customer_user_id,
            "rider_user_id": order.rider_user_id,
            "total_rupees": order.total_rupees,
            "payment_event_id": body.event_id,
        }
    )
    return {"duplicate": False, "event_id": body.event_id, "order_id": order.id}

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.deps import require_role
from app.events import publish_order_event
from app.models import MenuItem, Order, OrderLine, Store, User
from app.schemas import DispatchBoard, OrderCreate, OrderPublic, OrderStatusPatch, RiderStatusPatch

router = APIRouter(prefix="/orders", tags=["orders"])

ALLOWED_NEXT = {
    "placed": {"accepted", "rejected"},
    "accepted": {"preparing"},
}

RIDER_NEXT = {
    "preparing": {"out_for_delivery"},
    "out_for_delivery": {"delivered"},
}


def _order_query(db: Session):
    return select(Order).options(selectinload(Order.lines)).order_by(Order.id.desc())


def _emit(order: Order, db: Session) -> None:
    customer = db.get(User, order.customer_user_id)
    publish_order_event(
        {
            "order_id": order.id,
            "status": order.status,
            "store_id": order.store_id,
            "customer_user_id": order.customer_user_id,
            "rider_user_id": order.rider_user_id,
            "customer_email": customer.email if customer else None,
            "total_rupees": order.total_rupees,
        }
    )


@router.post("", response_model=OrderPublic, status_code=status.HTTP_201_CREATED)
def create_order(
    body: OrderCreate,
    user: Annotated[User, Depends(require_role("customer"))],
    db: Annotated[Session, Depends(get_db)],
):
    store = db.get(Store, body.store_id)
    if store is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found")

    wanted: dict[int, int] = {}
    for line in body.items:
        wanted[line.menu_item_id] = wanted.get(line.menu_item_id, 0) + line.quantity

    locked = list(
        db.scalars(
            select(MenuItem)
            .where(MenuItem.store_id == store.id, MenuItem.id.in_(wanted.keys()))
            .with_for_update()
        ).all()
    )
    by_id = {item.id: item for item in locked}
    if len(by_id) != len(wanted):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Item is not on this store menu")

    order = Order(customer_user_id=user.id, store_id=store.id, status="placed", total_rupees=0)
    db.add(order)
    db.flush()

    total = 0
    for item_id, qty in wanted.items():
        item = by_id[item_id]
        if item.stock < qty:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Not enough stock for {item.name}",
            )
        item.stock -= qty
        total += item.price_rupees * qty
        db.add(
            OrderLine(
                order_id=order.id,
                menu_item_id=item.id,
                name=item.name,
                quantity=qty,
                unit_price_rupees=item.price_rupees,
            )
        )

    order.total_rupees = total
    db.commit()
    saved = db.scalar(_order_query(db).where(Order.id == order.id))
    _emit(saved, db)
    return saved


@router.get("/me", response_model=list[OrderPublic])
def my_orders(
    user: Annotated[User, Depends(require_role("customer"))],
    db: Annotated[Session, Depends(get_db)],
):
    return list(db.scalars(_order_query(db).where(Order.customer_user_id == user.id)).all())


@router.get("/inbox", response_model=list[OrderPublic])
def store_inbox(
    user: Annotated[User, Depends(require_role("store"))],
    db: Annotated[Session, Depends(get_db)],
):
    store = db.scalar(select(Store).where(Store.owner_user_id == user.id))
    if store is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No store yet")
    return list(db.scalars(_order_query(db).where(Order.store_id == store.id)).all())


@router.get("/board", response_model=DispatchBoard)
def rider_board(
    user: Annotated[User, Depends(require_role("rider"))],
    db: Annotated[Session, Depends(get_db)],
):
    available = list(
        db.scalars(
            _order_query(db).where(Order.status == "preparing", Order.rider_user_id.is_(None))
        ).all()
    )
    mine = list(db.scalars(_order_query(db).where(Order.rider_user_id == user.id)).all())
    return DispatchBoard(available=available, mine=mine)


@router.patch("/{order_id}", response_model=OrderPublic)
def patch_order(
    order_id: int,
    body: OrderStatusPatch,
    user: Annotated[User, Depends(require_role("store"))],
    db: Annotated[Session, Depends(get_db)],
):
    store = db.scalar(select(Store).where(Store.owner_user_id == user.id))
    if store is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No store yet")

    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if order is None or order.store_id != store.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if body.status not in ALLOWED_NEXT.get(order.status, set()):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot move from {order.status} to {body.status}",
        )

    lines = list(db.scalars(select(OrderLine).where(OrderLine.order_id == order.id)).all())
    if body.status == "rejected":
        item_ids = [line.menu_item_id for line in lines]
        items = {
            item.id: item
            for item in db.scalars(select(MenuItem).where(MenuItem.id.in_(item_ids)).with_for_update()).all()
        }
        for line in lines:
            items[line.menu_item_id].stock += line.quantity

    order.status = body.status
    db.commit()
    saved = db.scalar(_order_query(db).where(Order.id == order.id))
    _emit(saved, db)
    return saved


@router.post("/{order_id}/claim", response_model=OrderPublic)
def claim_order(
    order_id: int,
    user: Annotated[User, Depends(require_role("rider"))],
    db: Annotated[Session, Depends(get_db)],
):
    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if order.status != "preparing":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Order is not ready for pickup",
        )
    if order.rider_user_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another rider already claimed this order",
        )
    order.rider_user_id = user.id
    db.commit()
    saved = db.scalar(_order_query(db).where(Order.id == order.id))
    _emit(saved, db)
    return saved


@router.patch("/{order_id}/rider", response_model=OrderPublic)
def rider_patch_order(
    order_id: int,
    body: RiderStatusPatch,
    user: Annotated[User, Depends(require_role("rider"))],
    db: Annotated[Session, Depends(get_db)],
):
    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if order is None or order.rider_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if body.status not in RIDER_NEXT.get(order.status, set()):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot move from {order.status} to {body.status}",
        )
    order.status = body.status
    db.commit()
    saved = db.scalar(_order_query(db).where(Order.id == order.id))
    _emit(saved, db)
    return saved

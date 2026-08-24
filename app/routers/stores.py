from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, require_role
from app.models import MenuItem, Store, User
from app.schemas import (
    MenuItemCreate,
    MenuItemPatch,
    MenuItemPublic,
    StoreCreate,
    StorePublic,
)

router = APIRouter(prefix="/stores", tags=["stores"])


def _store_or_404(db: Session, store_id: int) -> Store:
    store = db.get(Store, store_id)
    if store is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found")
    return store


def _require_owner(store: Store, user: User) -> None:
    if store.owner_user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not own this store",
        )


@router.get("", response_model=list[StorePublic])
def list_stores(
    _user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    return list(db.scalars(select(Store).order_by(Store.id)).all())


@router.get("/me", response_model=StorePublic)
def my_store(
    user: Annotated[User, Depends(require_role("store"))],
    db: Annotated[Session, Depends(get_db)],
):
    store = db.scalar(select(Store).where(Store.owner_user_id == user.id))
    if store is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No store yet")
    return store


@router.post("", response_model=StorePublic, status_code=status.HTTP_201_CREATED)
def create_store(
    body: StoreCreate,
    user: Annotated[User, Depends(require_role("store"))],
    db: Annotated[Session, Depends(get_db)],
):
    existing = db.scalar(select(Store).where(Store.owner_user_id == user.id))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You already have a store")

    store = Store(owner_user_id=user.id, name=body.name.strip())
    db.add(store)
    db.commit()
    db.refresh(store)
    return store


@router.get("/{store_id}", response_model=StorePublic)
def get_store(
    store_id: int,
    _user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    return _store_or_404(db, store_id)


@router.get("/{store_id}/items", response_model=list[MenuItemPublic])
def list_items(
    store_id: int,
    _user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    _store_or_404(db, store_id)
    return list(
        db.scalars(select(MenuItem).where(MenuItem.store_id == store_id).order_by(MenuItem.id)).all()
    )


@router.post("/{store_id}/items", response_model=MenuItemPublic, status_code=status.HTTP_201_CREATED)
def add_item(
    store_id: int,
    body: MenuItemCreate,
    user: Annotated[User, Depends(require_role("store"))],
    db: Annotated[Session, Depends(get_db)],
):
    store = _store_or_404(db, store_id)
    _require_owner(store, user)
    item = MenuItem(
        store_id=store.id,
        name=body.name.strip(),
        price_rupees=body.price_rupees,
        stock=body.stock,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{store_id}/items/{item_id}", response_model=MenuItemPublic)
def patch_item(
    store_id: int,
    item_id: int,
    body: MenuItemPatch,
    user: Annotated[User, Depends(require_role("store"))],
    db: Annotated[Session, Depends(get_db)],
):
    store = _store_or_404(db, store_id)
    _require_owner(store, user)
    item = db.get(MenuItem, item_id)
    if item is None or item.store_id != store.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        data["name"] = data["name"].strip()
    for key, value in data.items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item

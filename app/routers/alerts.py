import json
from typing import Annotated
from urllib.error import URLError, HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import get_current_user
from app.models import Store, User

router = APIRouter(tags=["alerts"])


@router.get("/alerts")
def list_alerts(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    params: dict[str, int] = {}
    if user.role == "customer":
        params["customer_user_id"] = user.id
    elif user.role == "rider":
        params["rider_user_id"] = user.id
    elif user.role == "store":
        store = db.scalar(select(Store).where(Store.owner_user_id == user.id))
        if store is None:
            return {"relay": "live", "jobs": []}
        params["store_id"] = store.id
    else:
        return {"relay": "live", "jobs": []}

    url = f"{settings.relay_url.rstrip('/')}/jobs?{urlencode(params)}"
    try:
        req = Request(url, headers={"Accept": "application/json"})
        with urlopen(req, timeout=2) as resp:
            return json.loads(resp.read().decode())
    except (URLError, HTTPError, TimeoutError, json.JSONDecodeError):
        return {"relay": "offline", "jobs": []}

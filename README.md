# Lane

Live order-and-dispatch backend (Python, FastAPI, PostgreSQL, Redis, Docker).
A thin real-world slice: customer, store, and rider share one order.

Product UI: http://localhost:8000/

## Run

Docker Desktop must be running.

```bash
copy .env.example .env
docker compose up --build
```

1. Create a **store** account → open a store → add menu items.
2. Sign out, create a **customer** account → open a store and read the menu.
3. Sign out, create a **rider** account. When a store marks an order **preparing**, claim it, then mark **Out** and **Delivered**.
4. Watch **Relay notifications** on the desk after each status change. Relay is Node on port 8001. If that container is down, Lane still takes orders.

## Layout

| Path | Job |
| --- | --- |
| `app/routers/auth.py` | Register, login, current user |
| `app/routers/stores.py` | Stores and menu items |
| `app/routers/orders.py` | Checkout, stock locks, status machine |
| `app/routers/live.py` | WebSocket order feed |
| `app/events.py` | Redis pub/sub |
| `relay/` | Node worker: Redis ingest, job retries, dead-letter |


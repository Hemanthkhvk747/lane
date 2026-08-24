# Lane

Live order-and-dispatch backend (Python, FastAPI, PostgreSQL, Redis, Docker).
A thin real-world slice: customer, store, and rider share one order.

Product UI: http://localhost:8000/ (Swagger is off)

## Status

- Week 1 — JWT auth, roles, sign-in desk
- Week 2 — Stores, menus, stock, role checks (401 vs 403)
- Week 3 — Checkout: row-level stock lock, store accept/reject

## Run

Docker Desktop must be running.

```bash
copy .env.example .env
docker compose up --build
```

1. Create a **store** account → open a store → add menu items.
2. Sign out, create a **customer** account → open a store and read the menu.

## Layout

| Path | Job |
| --- | --- |
| `app/routers/auth.py` | Register, login, current user |
| `app/routers/stores.py` | Stores and menu items |
| `app/security.py` | Password hash (Argon2) and JWT |
| `app/web/` | Product UI |

Do not commit `.env`. Use `.env.example`.

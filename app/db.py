from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def ensure_schema() -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE orders ADD COLUMN IF NOT EXISTS "
                "rider_user_id INTEGER REFERENCES users(id)"
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_orders_rider_user_id ON orders (rider_user_id)"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

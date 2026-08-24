from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.db import Base, engine
from app.models import MenuItem, Store, User  # noqa: F401
from app.routers import auth, health, stores

WEB_DIR = Path(__file__).parent / "web"
ASSETS_DIR = WEB_DIR / "static"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Lane", version="0.1.0", docs_url=None, redoc_url=None, lifespan=lifespan)
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(stores.router)
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


@app.get("/")
def home():
    return FileResponse(WEB_DIR / "index.html")

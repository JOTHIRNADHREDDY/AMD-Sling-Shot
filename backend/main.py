from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from core.database import engine, Base
from api.v1 import queue, map, voice, registration, storage, lab_tests

# Import all models so Base.metadata knows about them
import models.domain  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create DB tables on startup (dev convenience)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan,
)

# Set all CORS enabled origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "healthy", "service": settings.PROJECT_NAME}

# API Routers
app.include_router(queue.router, prefix=f"{settings.API_V1_STR}/queue", tags=["queue"])
app.include_router(map.router, prefix=f"{settings.API_V1_STR}/map", tags=["map"])
app.include_router(voice.router, prefix=f"{settings.API_V1_STR}/voice", tags=["voice"])
app.include_router(registration.router, prefix=f"{settings.API_V1_STR}/registration", tags=["registration"])
app.include_router(storage.router, prefix=f"{settings.API_V1_STR}/storage", tags=["storage"])
app.include_router(lab_tests.router, prefix=f"{settings.API_V1_STR}/lab-tests", tags=["lab-tests"])
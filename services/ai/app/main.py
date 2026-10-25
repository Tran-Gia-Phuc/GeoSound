from fastapi import FastAPI

from app.api import health, moderation
from app.config import get_settings

settings = get_settings()

app = FastAPI(title="GeoSound AI Service", version="0.1.0")

app.include_router(health.router)
app.include_router(moderation.router)

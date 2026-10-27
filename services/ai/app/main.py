from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import health, moderation, translation
from app.config import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Chatbot indexer (D21): only when CHATBOT_INDEXER_ENABLED=true; nothing runs otherwise.
    if settings.chatbot_indexer_enabled:
        from app.chatbot.rag.consumer import start_indexer

        app.state.chatbot_indexer = start_indexer(settings)
    yield


app = FastAPI(title="GeoSound AI Service", version="0.1.0", lifespan=lifespan)

app.include_router(health.router)
app.include_router(moderation.router)
app.include_router(translation.router)

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import chat, health, moderation, translation
from app.config import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Chatbot indexer (D21): only when CHATBOT_INDEXER_ENABLED=true; nothing runs otherwise.
    app.state.chatbot_indexer = None
    if settings.chatbot_indexer_enabled:
        from app.chatbot.rag.consumer import start_indexer

        app.state.chatbot_indexer = await start_indexer(settings)
    try:
        yield
    finally:
        indexer = app.state.chatbot_indexer
        app.state.chatbot_indexer = None
        if indexer is not None:
            await indexer.aclose()
        # The chat service (and its pgvector pool) exists only after a first chat request.
        await chat.close_chat_service()


app = FastAPI(title="GeoSound AI Service", version="0.1.0", lifespan=lifespan)

app.include_router(health.router)
app.include_router(moderation.router)
app.include_router(translation.router)
# Chat (#AI-47): 404 unless CHATBOT_ENABLED=true; the agent is built on the first request.
app.include_router(chat.router)

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import chat, health, moderation, translation
from app.config import get_settings

settings = get_settings()


async def open_chat_memory_at_startup() -> None:
    """Fail fast on a wrong chat memory setup (no silent in-process fallback).

    With CHAT_MEMORY_BACKEND=postgres the chat service is built now, so its pool is
    opened and the `ai_chat` tables are set up once, before the first request.
    """
    if not settings.chatbot_enabled:
        return
    from app.chatbot.memory import resolve_backend

    if resolve_backend(settings) == "postgres":
        await chat.get_chat_service()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await open_chat_memory_at_startup()
    # Chatbot indexer (D21): only when CHATBOT_INDEXER_ENABLED=true; nothing runs otherwise.
    app.state.chatbot_indexer = None
    try:
        if settings.chatbot_indexer_enabled:
            from app.chatbot.rag.consumer import start_indexer

            app.state.chatbot_indexer = await start_indexer(settings)
        yield
    finally:
        indexer = app.state.chatbot_indexer
        app.state.chatbot_indexer = None
        if indexer is not None:
            await indexer.aclose()
        # Closes the pgvector and chat memory pools, if the chat service was built.
        await chat.close_chat_service()


app = FastAPI(title="GeoSound AI Service", version="0.1.0", lifespan=lifespan)

app.include_router(health.router)
app.include_router(moderation.router)
app.include_router(translation.router)
# Chat (#AI-47): 404 unless CHATBOT_ENABLED=true; the agent is built on the first request
# (at startup with CHAT_MEMORY_BACKEND=postgres).
app.include_router(chat.router)

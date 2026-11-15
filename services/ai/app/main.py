import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from app.api import chat, health, moderation, translation
from app.config import get_settings

settings = get_settings()


def configure_logging(level: str) -> None:
    """Show `app.*` logs (indexer, chat, moderation) next to uvicorn's own logs.

    Without a handler Python drops every INFO line of the app (issue #238).
    """
    app_logger = logging.getLogger("app")
    app_logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    if not app_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s: %(message)s"))
        app_logger.addHandler(handler)


configure_logging(settings.ai_log_level)


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


async def run_indexer(app: FastAPI) -> None:
    """Start the chatbot indexer in the background; its handle lands in app.state once connected.

    `start_indexer` waits for RabbitMQ as long as it takes (#375). Meanwhile the app serves
    requests and /readyz answers 503 (no handle yet).
    """
    from app.chatbot.rag.consumer import start_indexer

    try:
        app.state.chatbot_indexer = await start_indexer(settings)
    except Exception as exc:  # noqa: BLE001 - a background task must not die silently
        logging.getLogger("app.chatbot.rag.consumer").error(
            "chatbot indexer not started (%s)", type(exc).__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await open_chat_memory_at_startup()
    # Chatbot indexer (D21): only when CHATBOT_INDEXER_ENABLED=true; nothing runs otherwise.
    app.state.chatbot_indexer = None
    indexer_start = None
    try:
        if settings.chatbot_indexer_enabled:
            indexer_start = asyncio.create_task(run_indexer(app), name="chatbot-indexer-start")
        yield
    finally:
        if indexer_start is not None and not indexer_start.done():
            indexer_start.cancel()  # still waiting for RabbitMQ: start_indexer closes its store
            with suppress(asyncio.CancelledError):
                await indexer_start
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

"""Chat endpoints: POST /chat (SSE) and GET /chat/history (task #AI-47, issue #188).

Contract: docs/02-design/chatbot-architecture.md section 8 (snake_case on the wire).

- CHATBOT_ENABLED=false (default): both routes answer 404, before the token
  check, and nothing of the chatbot is built or imported.
- Every route requires x-internal-token (added by the gateway): 401 otherwise.
- The whole agent turn (classify, retrieve, one LLM call, cite) runs BEFORE
  the stream starts. So errors are plain JSON statuses (422, 429 with
  Retry-After, 503), and only the CLEANED answer is streamed: `cite` has
  already removed invented `[tour:ID]` / `[place:ID]` markers.
- Markers of retrieved items are kept in the `token` text (same as the stored
  history), and the `citations` event lists them so the client can render
  them as links or hide them. Tokens are split on whitespace and markers
  contain none, so a marker is never split across two `token` events.
- SSE events, in order: `meta`, `token` (0..n), `citations`, `done`; an
  `error` event replaces the rest if something fails mid-stream.
"""

import asyncio
import json
import logging
import re
import uuid
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

from app.api.moderation import describe_failure
from app.chatbot.limits import ChatBusyError
from app.config import get_settings
from app.middleware.auth import require_internal_token
from app.moderation.validator import sanitize_text

logger = logging.getLogger(__name__)

UNAVAILABLE_DETAIL = "Chat is temporarily unavailable; retry later"
BUSY_DETAIL = "Chat is busy; retry later"
NOT_FOUND_DETAIL = "Not Found"
UNKNOWN_SESSION_DETAIL = "unknown session"
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}

_TOKENS = re.compile(r"\S+\s*|\s+")


async def require_chat_enabled() -> None:
    if not get_settings().chatbot_enabled:
        raise HTTPException(status_code=404, detail=NOT_FOUND_DETAIL)


# Order matters: a disabled chatbot looks absent (404) even without a token.
router = APIRouter(dependencies=[Depends(require_chat_enabled), Depends(require_internal_token)])


class ChatLocation(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    session_id: UUID | None = None
    language: Literal["vi", "en"] | None = None
    location: ChatLocation | None = None

    @field_validator("message")
    @classmethod
    def _message_limits(cls, value: str) -> str:
        limit = get_settings().chat_message_max_chars
        if len(value) > limit:
            raise ValueError(f"message must be at most {limit} characters")
        if not sanitize_text(value).strip():
            raise ValueError("message is empty")
        return value


_service: Any = None


_service_lock: asyncio.Lock | None = None


async def get_chat_service():
    """The ChatService, built on the first request (never at import)."""
    global _service, _service_lock
    if _service is None:
        if _service_lock is None:
            _service_lock = asyncio.Lock()
        async with _service_lock:
            if _service is None:
                from app.chatbot.service import abuild_chat_service

                _service = await abuild_chat_service(get_settings())
    return _service


async def close_chat_service() -> None:
    """Close the chat service's store pool on shutdown, if the service was built."""
    global _service
    service, _service = _service, None
    if service is not None and hasattr(service, "aclose"):
        await service.aclose()


def split_tokens(text: str) -> list[str]:
    """Whitespace-delimited chunks; joined they give `text` back, markers stay whole."""
    return _TOKENS.findall(text)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def stream_turn(result: dict[str, Any]):
    try:
        yield sse("meta", {"session_id": result["session_id"], "lang": result["lang"]})
        for chunk in split_tokens(result["answer"]):
            yield sse("token", {"text": chunk})
        yield sse("citations", {"items": result.get("citations", [])})
        yield sse("done", {"finish_reason": result["finish_reason"],
                           "llm_calls": result["llm_calls"]})
    except Exception as exc:
        logger.error("chat stream failed: %s", type(exc).__name__)
        yield sse("error", {"code": "internal", "message": UNAVAILABLE_DETAIL})


@router.post("/chat")
async def chat(request: ChatRequest, service=Depends(get_chat_service)):
    session_id = str(request.session_id or uuid.uuid4())
    location = request.location.model_dump() if request.location else None
    try:
        result = await service.turn(session_id, request.message,
                                    location=location, language=request.language)
    except ChatBusyError as exc:
        logger.warning("chat turn refused: %s", exc.reason)
        return JSONResponse(status_code=429, content={"detail": BUSY_DETAIL},
                            headers={"Retry-After": str(exc.retry_after)})
    except Exception as exc:
        # Class names only: provider messages may echo the user text.
        logger.error("chat turn unavailable: %s", describe_failure(exc))
        raise HTTPException(status_code=503, detail=UNAVAILABLE_DETAIL) from exc
    return StreamingResponse(stream_turn(result), media_type="text/event-stream",
                             headers=SSE_HEADERS)


@router.get("/chat/history")
async def chat_history(session_id: UUID = Query(...), service=Depends(get_chat_service)):
    messages = await service.history(str(session_id))
    if messages is None:
        raise HTTPException(status_code=404, detail=UNKNOWN_SESSION_DETAIL)
    return {"session_id": str(session_id), "messages": messages}

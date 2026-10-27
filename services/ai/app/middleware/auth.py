"""Internal service auth for /moderate/* (task #AI-28).

Require header x-internal-token == settings.internal_service_token, else 401.
/health and /translate* stay open. Fail closed: an empty configured token
rejects every request.
"""

import hmac

from fastapi import Header, HTTPException

from app.config import get_settings

INVALID_TOKEN_DETAIL = "invalid internal token"


async def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    # Settings are read per request so tests can swap them (get_settings.cache_clear()).
    expected = get_settings().internal_service_token
    if not expected or not x_internal_token:
        raise HTTPException(status_code=401, detail=INVALID_TOKEN_DETAIL)
    if not hmac.compare_digest(x_internal_token.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail=INVALID_TOKEN_DETAIL)

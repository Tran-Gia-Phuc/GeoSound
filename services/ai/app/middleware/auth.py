"""Internal service auth for /moderate/* (task #AI-12).

Require header x-internal-token == settings.internal_service_token, else 401.
/health and /translate* stay open. Use hmac.compare_digest.
"""

from fastapi import Header


async def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    raise NotImplementedError("#AI-12")

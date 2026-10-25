import logging
from typing import Any
from urllib.parse import quote

import httpx
from pydantic import ValidationError

from app.config import get_settings
from app.moderation.schema import ModerationRequest

logger = logging.getLogger(__name__)

SUPPORTED_LANGUAGES = {"vi", "en"}
REQUEST_TIMEOUT_SECONDS = 5.0


class TourNotFoundError(Exception):
    """The tour does not exist. Permanent: retrying will not help."""


class TourContentError(Exception):
    """The tour content cannot be moderated (malformed or over the limits). Permanent."""


class TourServiceError(Exception):
    """The tour service is unreachable, slow or failing. Transient."""


def _describe(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        return "; ".join(
            f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}"
            for e in exc.errors(include_input=False)
        )
    return f"{type(exc).__name__}: {exc}"


def to_moderation_request(tour_id: str, data: Any) -> ModerationRequest:
    """Map the tour service payload (camelCase) to the moderation request."""
    if not isinstance(data, dict):
        raise TourContentError("Tour service returned an unexpected body")

    language = str(data.get("language") or "").lower()[:2]
    if language not in SUPPORTED_LANGUAGES:
        language = "en"  # only affects the language of the finding messages

    try:
        return ModerationRequest.model_validate(
            {
                "tour_id": tour_id,
                "title": data.get("title"),
                "description": data.get("description") or "",
                "language": language,
                "stops": [
                    {"stop_id": s.get("stopId"), "description": s.get("description")}
                    for s in (data.get("stops") or [])
                ],
            }
        )
    except (ValidationError, AttributeError, TypeError) as exc:
        raise TourContentError(
            f"Tour {tour_id} cannot be moderated: {_describe(exc)}"
        ) from exc


class TourClient:
    """Reads the text of a tour from the tour service internal endpoint."""

    def __init__(
        self,
        base_url: str | None = None,
        token: str | None = None,
        timeout: float = REQUEST_TIMEOUT_SECONDS,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.tour_service_url).rstrip("/")
        self.token = settings.internal_service_token if token is None else token
        self.timeout = timeout
        self._transport = transport  # injectable for tests

    async def fetch_for_moderation(self, tour_id: str) -> ModerationRequest:
        url = f"{self.base_url}/internal/tours/{quote(tour_id, safe='')}/moderation-content"
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout, transport=self._transport
            ) as client:
                response = await client.get(url, headers={"x-internal-token": self.token})
        except httpx.TransportError as exc:  # includes timeouts
            raise TourServiceError(
                f"Tour service unreachable: {type(exc).__name__}"
            ) from exc

        if response.status_code == 404:
            raise TourNotFoundError(f"Tour {tour_id} not found")
        if response.status_code >= 400:
            raise TourServiceError(f"Tour service answered HTTP {response.status_code}")

        try:
            data = response.json()
        except ValueError as exc:
            raise TourContentError("Tour service returned a non-JSON body") from exc

        return to_moderation_request(tour_id, data)

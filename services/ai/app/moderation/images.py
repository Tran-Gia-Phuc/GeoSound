"""Phase 2 (task #AI-41): fetch and validate place images before Gemini sees them.

Rules: https only, host in the allowlist (IMAGE_ALLOWED_HOSTS, else the host of
SUPABASE_URL), no userinfo, port 443 only, no redirects, jpeg/png/webp (declared
content type AND magic bytes), at most IMAGE_MAX_BYTES each, at most 5 images
(the schema enforces the count).

Each image gives either a FetchedImage or an ImageProblem:
- permanent: the image can never be read as sent (bad URL, host, redirect,
  404/403/410, wrong type, too large). The place gets a Warning, never a Pass.
- temporary: 429, 5xx, timeout, network error. The whole request answers 503
  and Moderation retries later.

Logs carry the image index and host only, never the full URL (query strings
may hold tokens).
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

import httpx

from app.config import get_settings
from app.moderation.pipeline import ModerationUnavailableError

logger = logging.getLogger(__name__)

ALLOWED_MIME_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})

ProblemKind = Literal["permanent", "temporary"]


@dataclass(frozen=True)
class FetchedImage:
    index: int
    url: str
    mime_type: str
    data: bytes


@dataclass(frozen=True)
class ImageProblem:
    index: int
    kind: ProblemKind
    reason: str


ImageResult = FetchedImage | ImageProblem
ImageFetcher = Callable[[Sequence[str]], Awaitable[list[ImageResult]]]


class ImagesUnavailableError(ModerationUnavailableError):
    """At least one image could not be fetched now (temporary): answer 503."""


def sniff_mime_type(data: bytes) -> str | None:
    """Image type from magic bytes, or None when it is not jpeg/png/webp."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _safe_host(url: str) -> str:
    try:
        return urlsplit(url).hostname or "?"
    except ValueError:
        return "?"


def check_url(url: str, allowed_hosts: frozenset[str]) -> str | None:
    """Return a reason when the URL is not allowed, else None."""
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError:
        return "invalid url"
    if parts.scheme.lower() != "https":
        return "scheme is not https"
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        return "userinfo is not allowed"
    host = (parts.hostname or "").rstrip(".")
    if not host:
        return "missing host"
    if host not in allowed_hosts:
        return "host is not allowed"
    if port not in (None, 443):
        return "port is not allowed"
    return None


def _declared_mime(response: httpx.Response) -> str:
    return response.headers.get("content-type", "").split(";")[0].strip().lower()


async def _download(
    client: httpx.AsyncClient, index: int, url: str, max_bytes: int
) -> ImageResult:
    async with client.stream("GET", url, follow_redirects=False) as response:
        status = response.status_code
        if 300 <= status < 400:
            return ImageProblem(index, "permanent", f"redirect {status} not followed")
        if status == 429 or status >= 500:
            return ImageProblem(index, "temporary", f"status {status}")
        if status != 200:
            return ImageProblem(index, "permanent", f"status {status}")

        declared = _declared_mime(response)
        if declared not in ALLOWED_MIME_TYPES:
            return ImageProblem(index, "permanent", "content type not allowed")

        length = response.headers.get("content-length")
        if length is not None and length.isdigit() and int(length) > max_bytes:
            return ImageProblem(index, "permanent", "image too large")

        chunks: list[bytes] = []
        size = 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > max_bytes:
                return ImageProblem(index, "permanent", "image too large")
            chunks.append(chunk)

    data = b"".join(chunks)
    if not data:
        return ImageProblem(index, "permanent", "empty image")
    if sniff_mime_type(data) != declared:
        return ImageProblem(index, "permanent", "content does not match its type")
    return FetchedImage(index=index, url=url, mime_type=declared, data=data)


async def _fetch_one(
    client: httpx.AsyncClient,
    index: int,
    url: str,
    allowed_hosts: frozenset[str],
    max_bytes: int,
    timeout: float,
) -> ImageResult:
    reason = check_url(url, allowed_hosts)
    if reason is not None:
        result: ImageResult = ImageProblem(index, "permanent", reason)
    else:
        try:
            # Total budget per image, so a slow trickle cannot hold the request.
            async with asyncio.timeout(timeout):
                result = await _download(client, index, url, max_bytes)
        except (TimeoutError, httpx.TimeoutException):
            result = ImageProblem(index, "temporary", "timeout")
        except httpx.InvalidURL:
            result = ImageProblem(index, "permanent", "invalid url")
        except httpx.TransportError as exc:
            result = ImageProblem(index, "temporary", f"network error {type(exc).__name__}")

    if isinstance(result, ImageProblem):
        logger.warning(
            "image index=%d host=%s %s: %s", index, _safe_host(url), result.kind, result.reason
        )
    else:
        logger.info(
            "image index=%d host=%s ok type=%s bytes=%d",
            index,
            _safe_host(url),
            result.mime_type,
            len(result.data),
        )
    return result


async def fetch_images(
    urls: Sequence[str],
    *,
    client: httpx.AsyncClient,
    allowed_hosts: frozenset[str] | set[str],
    max_bytes: int,
    timeout: float,
) -> list[ImageResult]:
    """Fetch all images concurrently; one result per URL, in input order."""
    hosts = frozenset(h.lower() for h in allowed_hosts)
    return list(
        await asyncio.gather(
            *(
                _fetch_one(client, index, url, hosts, max_bytes, timeout)
                for index, url in enumerate(urls)
            )
        )
    )


def make_image_fetcher(
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    allowed_hosts: frozenset[str] | set[str] | None = None,
    max_bytes: int | None = None,
    timeout: float | None = None,
) -> ImageFetcher:
    """Build the fetcher used by the place moderator.

    Defaults come from settings at call time; `transport` is injectable so
    tests use httpx.MockTransport and never touch the network.
    """

    async def fetcher(urls: Sequence[str]) -> list[ImageResult]:
        settings = get_settings()
        hosts = settings.allowed_image_hosts() if allowed_hosts is None else allowed_hosts
        limit = settings.image_max_bytes if max_bytes is None else max_bytes
        seconds = settings.image_fetch_timeout_seconds if timeout is None else timeout
        async with httpx.AsyncClient(
            transport=transport, follow_redirects=False, timeout=seconds, trust_env=False
        ) as client:
            return await fetch_images(
                urls, client=client, allowed_hosts=hosts, max_bytes=limit, timeout=seconds
            )

    return fetcher

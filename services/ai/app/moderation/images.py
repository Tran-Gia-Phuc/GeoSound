"""Phase 2 (task #AI-24): fetch and validate place images before Gemini sees them.

Rules: https only, host in IMAGE_ALLOWED_HOSTS, no redirects, jpeg/png/webp,
max 3 MB each, at most 5 images. A permanently unreadable image yields a
Warning, never a Pass. Gemini only; no Groq fallback for requests with images.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class FetchedImage:
    url: str
    mime_type: str
    data: bytes


async def fetch_images(urls: list[str]) -> list[FetchedImage]:
    raise NotImplementedError("#AI-24")

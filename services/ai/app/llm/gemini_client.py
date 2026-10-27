import base64
import json
import logging
import re
from collections.abc import Sequence
from typing import Any

import httpx

from app.config import get_settings
from app.llm.errors import (
    LLMBadRequestError,
    LLMBlockedError,
    LLMConnectionError,
    LLMRateLimitError,
    LLMResponseError,
    LLMServerError,
    LLMTimeoutError,
)

logger = logging.getLogger(__name__)

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
_BLOCK_REASONS = {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"}
# (mime_type, raw bytes) of one inline image, e.g. ("image/jpeg", b"...").
InlineImage = tuple[str, bytes]
_SAFETY_CATEGORIES = (
    "HARM_CATEGORY_HARASSMENT",
    "HARM_CATEGORY_HATE_SPEECH",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    "HARM_CATEGORY_DANGEROUS_CONTENT",
)


def _parts(prompt: str, images: Sequence[InlineImage] | None) -> list[dict[str, Any]]:
    """Text part first, then one inline_data part per image (base64)."""
    parts: list[dict[str, Any]] = [{"text": prompt}]
    for mime_type, data in images or ():
        parts.append(
            {
                "inline_data": {
                    "mime_type": mime_type,
                    "data": base64.b64encode(data).decode("ascii"),
                }
            }
        )
    return parts


class GeminiClient:
    """Minimal async client for the Gemini generateContent REST API."""

    provider = "gemini"

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
        safety_block_none: bool = False,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        settings = get_settings()
        self.api_key = settings.gemini_api_key if api_key is None else api_key
        self.model = model or settings.gemini_model
        self.timeout = settings.llm_timeout_seconds if timeout is None else timeout
        # Moderation must read harmful text without Gemini refusing the prompt.
        self.safety_block_none = safety_block_none
        self._transport = transport  # injectable for tests

    async def generate_text(
        self,
        prompt: str,
        *,
        system: str | None = None,
        temperature: float = 0.3,
        max_tokens: int = 2048,
    ) -> str:
        return await self._generate(
            prompt,
            system=system,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=False,
        )

    async def generate_json(
        self,
        prompt: str,
        *,
        system: str | None = None,
        temperature: float = 0.0,
        max_tokens: int = 2048,
        images: Sequence[InlineImage] | None = None,
    ) -> Any:
        """JSON answer. `images` are sent as inline parts after the prompt, in order."""
        text = await self._generate(
            prompt,
            system=system,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=True,
            images=images,
        )
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise LLMResponseError(
                f"Model returned invalid JSON: {exc.msg}", provider=self.provider
            ) from exc

    async def _generate(
        self,
        prompt: str,
        *,
        system: str | None,
        temperature: float,
        max_tokens: int,
        json_mode: bool,
        images: Sequence[InlineImage] | None = None,
    ) -> str:
        if not self.api_key:
            raise LLMBadRequestError("GEMINI_API_KEY is not set", provider=self.provider)

        generation_config: dict[str, Any] = {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        }
        if json_mode:
            generation_config["responseMimeType"] = "application/json"

        body: dict[str, Any] = {
            "contents": [{"role": "user", "parts": _parts(prompt, images)}],
            "generationConfig": generation_config,
        }
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        if self.safety_block_none:
            body["safetySettings"] = [
                {"category": c, "threshold": "BLOCK_NONE"} for c in _SAFETY_CATEGORIES
            ]

        url = f"{BASE_URL}/models/{self.model}:generateContent"
        headers = {"x-goog-api-key": self.api_key}

        try:
            async with httpx.AsyncClient(
                timeout=self.timeout, transport=self._transport
            ) as client:
                response = await client.post(url, json=body, headers=headers)
        except httpx.TimeoutException as exc:
            raise LLMTimeoutError(
                f"Request timed out after {self.timeout}s", provider=self.provider
            ) from exc
        except httpx.TransportError as exc:
            raise LLMConnectionError(
                f"Connection failed: {type(exc).__name__}", provider=self.provider
            ) from exc

        self._raise_for_status(response)

        try:
            data = response.json()
        except ValueError as exc:
            raise LLMResponseError(
                "Response body is not JSON", provider=self.provider
            ) from exc

        text = self._extract_text(data)
        logger.info(
            "gemini ok model=%s json_mode=%s images=%d chars=%d",
            self.model,
            json_mode,
            len(images or ()),
            len(text),
        )
        return text

    def _raise_for_status(self, response: httpx.Response) -> None:
        status = response.status_code
        if status < 400:
            return
        try:
            message = response.json()["error"]["message"]
        except (ValueError, KeyError, TypeError):
            message = response.text[:200] or "request failed"

        kwargs = {"provider": self.provider, "status_code": status}
        logger.warning("gemini error status=%d message=%s", status, message)
        if status == 429:
            raise LLMRateLimitError(message, **kwargs)
        if status >= 500:
            raise LLMServerError(message, **kwargs)
        raise LLMBadRequestError(message, **kwargs)

    def _extract_text(self, data: dict[str, Any]) -> str:
        block_reason = (data.get("promptFeedback") or {}).get("blockReason")
        if block_reason:
            raise LLMBlockedError(
                f"Prompt blocked: {block_reason}", provider=self.provider
            )

        candidates = data.get("candidates") or []
        if not candidates:
            raise LLMResponseError("No candidates in response", provider=self.provider)

        candidate = candidates[0]
        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts)
        if text.strip():
            return text

        finish = candidate.get("finishReason", "UNKNOWN")
        if finish in _BLOCK_REASONS:
            raise LLMBlockedError(
                f"Response blocked: {finish}", provider=self.provider
            )
        raise LLMResponseError(
            f"Empty response (finishReason={finish})", provider=self.provider
        )

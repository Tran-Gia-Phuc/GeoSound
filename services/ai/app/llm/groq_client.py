import json
import logging
import re
from typing import Any

import httpx

from app.config import get_settings
from app.llm.errors import (
    LLMBadRequestError,
    LLMConnectionError,
    LLMRateLimitError,
    LLMResponseError,
    LLMServerError,
    LLMTimeoutError,
)

logger = logging.getLogger(__name__)

BASE_URL = "https://api.groq.com/openai/v1"


class GroqClient:
    """Minimal async client for the Groq chat completions API (OpenAI-compatible)."""

    provider = "groq"

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        settings = get_settings()
        self.api_key = settings.groq_api_key if api_key is None else api_key
        self.model = model or settings.groq_model
        self.timeout = settings.llm_timeout_seconds if timeout is None else timeout
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
    ) -> Any:
        text = await self._generate(
            prompt,
            system=system,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=True,
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
    ) -> str:
        if not self.api_key:
            raise LLMBadRequestError("GROQ_API_KEY is not set", provider=self.provider)

        messages: list[dict[str, str]] = []
        system_text = system or ""
        if json_mode:
            # Groq JSON mode requires the word "JSON" to appear in the messages.
            system_text = (system_text + "\nRespond only with a valid JSON object.").strip()
        if system_text:
            messages.append({"role": "system", "content": system_text})
        messages.append({"role": "user", "content": prompt})

        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        if "gpt-oss" in self.model:
            # Reasoning tokens count toward max_tokens; keep them small.
            body["reasoning_effort"] = "low"

        headers = {"Authorization": f"Bearer {self.api_key}"}

        try:
            async with httpx.AsyncClient(
                timeout=self.timeout, transport=self._transport
            ) as client:
                response = await client.post(
                    f"{BASE_URL}/chat/completions", json=body, headers=headers
                )
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
            text = data["choices"][0]["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise LLMResponseError(
                "Malformed response body", provider=self.provider
            ) from exc

        if not text.strip():
            raise LLMResponseError("Empty response", provider=self.provider)

        logger.info("groq ok model=%s json_mode=%s chars=%d", self.model, json_mode, len(text))
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
        logger.warning("groq error status=%d message=%s", status, message)
        if status == 429:
            raise LLMRateLimitError(message, **kwargs)
        if status >= 500:
            raise LLMServerError(message, **kwargs)
        raise LLMBadRequestError(message, **kwargs)

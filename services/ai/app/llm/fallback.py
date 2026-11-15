import logging
import time
from typing import Any

from app import metrics
from app.llm.errors import LLMError
from app.llm.gemini_client import GeminiClient
from app.llm.groq_client import GroqClient

logger = logging.getLogger(__name__)


class FallbackLLM:
    """Try the primary provider (Gemini); on timeout, 429 or 5xx use the secondary (Groq).

    Non-retryable errors (bad request, blocked content, malformed output) are
    raised as is, because another provider would not fix them.
    Requests with images (phase 2, #AI-41) go to the primary only: Groq is text only.

    `task` (`place`, `tour`, `chat` or `other`, the default) only labels the
    Prometheus metrics of each provider call (deployment task 4.3).
    """

    def __init__(self, primary: Any = None, secondary: Any = None, task: str = "other") -> None:
        self.primary = primary or GeminiClient()
        self.secondary = secondary or GroqClient()
        self.task = metrics.task_label(task)

    async def generate_text(self, prompt: str, **kwargs: Any) -> str:
        result, _ = await self._run("generate_text", prompt, **kwargs)
        return result

    async def generate_json(self, prompt: str, **kwargs: Any) -> Any:
        result, _ = await self._run("generate_json", prompt, **kwargs)
        return result

    async def generate_json_with_model(self, prompt: str, **kwargs: Any) -> tuple[Any, str]:
        """Like generate_json, but also return the model name that answered."""
        result, client = await self._run("generate_json", prompt, **kwargs)
        return result, getattr(client, "model", client.provider)

    async def _call(self, client: Any, method: str, prompt: str, **kwargs: Any) -> Any:
        """One provider call, counted in llm_requests_total and timed."""
        provider = getattr(client, "provider", None)
        started = time.perf_counter()
        try:
            result = await getattr(client, method)(prompt, **kwargs)
        except Exception as exc:
            metrics.record_llm_call(provider, self.task, metrics.llm_outcome(exc),
                                    time.perf_counter() - started)
            raise
        metrics.record_llm_call(provider, self.task, "ok", time.perf_counter() - started)
        return result

    async def _run(self, method: str, prompt: str, **kwargs: Any) -> tuple[Any, Any]:
        try:
            result = await self._call(self.primary, method, prompt, **kwargs)
            logger.info("llm provider=%s fallback=false", self.primary.provider)
            return result, self.primary
        except LLMError as exc:
            primary_error = exc
            if not exc.fallback_eligible:
                raise
            if kwargs.get("images"):
                logger.warning(
                    "llm primary=%s failed (%s); no fallback for a request with images",
                    self.primary.provider,
                    exc,
                )
                raise
            if not getattr(self.secondary, "api_key", ""):
                logger.warning(
                    "llm primary=%s failed (%s) and secondary has no API key",
                    self.primary.provider,
                    exc,
                )
                raise
            logger.warning(
                "llm primary=%s failed (%s); falling back to %s",
                self.primary.provider,
                exc,
                self.secondary.provider,
            )

        metrics.record_fallback(getattr(self.primary, "provider", None),
                                getattr(self.secondary, "provider", None))
        try:
            result = await self._call(self.secondary, method, prompt, **kwargs)
        except LLMError as exc:
            logger.error("llm all providers failed: primary=%s secondary=%s", primary_error, exc)
            raise exc from primary_error
        logger.info("llm provider=%s fallback=true", self.secondary.provider)
        return result, self.secondary

class LLMError(Exception):
    """Base class for all LLM provider errors."""

    # True when the fallback provider should be tried (timeout, 429, 5xx).
    fallback_eligible: bool = False

    def __init__(
        self,
        message: str,
        *,
        provider: str = "unknown",
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.provider = provider
        self.status_code = status_code

    def __str__(self) -> str:
        code = f" (HTTP {self.status_code})" if self.status_code else ""
        return f"[{self.provider}] {self.message}{code}"


class LLMTimeoutError(LLMError):
    fallback_eligible = True


class LLMConnectionError(LLMError):
    fallback_eligible = True


class LLMRateLimitError(LLMError):
    """HTTP 429."""

    fallback_eligible = True


class LLMServerError(LLMError):
    """HTTP 5xx."""

    fallback_eligible = True


class LLMBadRequestError(LLMError):
    """HTTP 4xx other than 429 (bad key, bad model, invalid request)."""


class LLMBlockedError(LLMError):
    """The provider refused to answer (safety filter)."""


class LLMResponseError(LLMError):
    """Empty or malformed response (including invalid JSON in JSON mode)."""

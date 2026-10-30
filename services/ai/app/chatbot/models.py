"""LangChain chat model of the chat agent (task #AI-46, chatbot-architecture.md section 3.3).

Gemini (`ChatGoogleGenerativeAI`) with `.with_fallbacks([ChatGroq])`, built
lazily from settings: the provider packages are imported only when
`build_chat_model()` runs, so importing the chatbot never needs a key or the
network. Tests never call this factory; they inject a fake chat model.

Fallback to Groq happens only on timeout, 429 and 5xx (same rule as
`app/llm/fallback.py`). Bad requests (4xx) and blocked content are not
retried on another provider; blocked content comes back as an empty message,
which the `answer` node turns into a polite refusal. Chat is text only, so
Groq is allowed. Keys are read from settings and never logged.
"""

from typing import Any

from app.config import Settings, get_settings

# Short answers keep the prompt+output budget small (section 7).
MAX_OUTPUT_TOKENS = 512
TEMPERATURE = 0.3
# gemini-2.5-flash counts thinking tokens in max_output_tokens: with thinking on, a
# 512-token budget is spent on reasoning and the answer is cut (issue #238).
THINKING_BUDGET = 0


def fallback_exceptions() -> tuple[type[BaseException], ...]:
    """Gemini errors that justify trying Groq: timeout, 429 and 5xx."""
    from google.api_core import exceptions as gexc

    return (
        TimeoutError,
        gexc.ResourceExhausted,  # 429 (gRPC)
        gexc.TooManyRequests,  # 429 (HTTP)
        gexc.ServerError,  # every 5xx, including DeadlineExceeded (504)
        gexc.RetryError,  # api_core retry deadline reached
    )


def build_chat_model(settings: Settings | None = None) -> Any:
    """Gemini chat model with a Groq fallback (when GROQ_API_KEY is set)."""
    settings = settings or get_settings()
    from langchain_google_genai import ChatGoogleGenerativeAI

    primary = ChatGoogleGenerativeAI(
        model=settings.gemini_model,
        google_api_key=settings.gemini_api_key,
        temperature=TEMPERATURE,
        max_output_tokens=MAX_OUTPUT_TOKENS,
        thinking_budget=THINKING_BUDGET,
        timeout=settings.llm_timeout_seconds,
        # One attempt: retries would spend the shared 5 requests per minute.
        max_retries=1,
    )
    if not settings.groq_api_key:
        return primary

    secondary = build_groq_chat_model(settings)
    return primary.with_fallbacks([secondary], exceptions_to_handle=fallback_exceptions())


def build_groq_chat_model(settings: Settings | None = None) -> Any:
    """Groq-only chat model (text only). Also used alone when the global Gemini
    chat cap is reached (chatbot-architecture.md section 7), so overflow turns
    never spend the Gemini quota shared with moderation."""
    settings = settings or get_settings()
    from langchain_groq import ChatGroq

    return ChatGroq(
        model=settings.groq_model,
        api_key=settings.groq_api_key,
        temperature=TEMPERATURE,
        max_tokens=MAX_OUTPUT_TOKENS,
        timeout=settings.llm_timeout_seconds,
        max_retries=0,
    )

from functools import lru_cache
from urllib.parse import urlsplit

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings, loaded from environment variables (or a local .env)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",  # the shared root .env holds keys of other services
    )

    port: int = 3004

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-20b"
    llm_timeout_seconds: float = 10.0

    rabbitmq_url: str = "amqp://guest:guest@rabbitmq:5672"
    rabbitmq_exchange: str = "geosound.events"
    tour_service_url: str = "http://tour:3002"
    database_url: str = ""

    jwt_access_secret: str = ""
    # Shared secret checked on /moderate/* (header x-internal-token). Empty = reject all.
    internal_service_token: str = ""

    moderation_reject_threshold: float = 0.8
    moderation_warning_threshold: float = 0.4
    # Total time budget of one /moderate/* request (slot wait + LLM work).
    moderation_timeout_seconds: float = 30.0
    # Concurrent LLM-backed moderation calls in this process (quota, D13).
    moderation_max_concurrency: int = 2

    # Place images (phase 2, #AI-41). Comma-separated hosts; empty = host of SUPABASE_URL.
    image_allowed_hosts: str = ""
    # Only its host is used (image allowlist fallback); never log this value.
    supabase_url: str = ""
    image_max_bytes: int = 3 * 1024 * 1024
    image_fetch_timeout_seconds: float = 10.0

    # Optional LangSmith tracing of moderation calls (#AI-32). Off by default;
    # `langsmith` is only imported when this is true. The key is a SecretStr so
    # it never shows up in a repr, a log line or a settings dump.
    langsmith_tracing: bool = False
    langsmith_project: str = "geosound-ai"
    langsmith_api_key: SecretStr = SecretStr("")

    # Chatbot indexer (#AI-44, D21): the only RabbitMQ consumer of the AI service.
    # Off by default; nothing is started when false.
    chatbot_indexer_enabled: bool = False

    def allowed_image_hosts(self) -> frozenset[str]:
        """Hosts images may be fetched from. Empty set = every image is refused."""
        hosts = {h.strip().lower().rstrip(".") for h in self.image_allowed_hosts.split(",")}
        hosts.discard("")
        if hosts:
            return frozenset(hosts)
        try:
            host = urlsplit(self.supabase_url.strip()).hostname
        except ValueError:
            host = None
        return frozenset({host.rstrip(".")}) if host else frozenset()


@lru_cache
def get_settings() -> Settings:
    return Settings()

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

    # Chatbot (phase 3, #AI-46): user turns kept in memory and sent to the LLM.
    chat_memory_turns: int = 6
    # Chatbot indexer (#AI-44, D21): the only RabbitMQ consumer of the AI service.
    # Off by default; nothing is started when false.
    chatbot_indexer_enabled: bool = False
    # Durable queue bound to tour.published / tour.unpublished / tour.hidden.
    chatbot_indexer_queue: str = "ai.chatbot-indexer"
    # Temporary indexing failures are re-sent at most this many times, each after the delay.
    chatbot_indexer_max_retries: int = 3
    chatbot_indexer_retry_delay_seconds: float = 5.0
    # Chat API (#AI-47, #188). Off by default: /chat and /chat/history answer 404
    # and nothing of the chatbot is built.
    chatbot_enabled: bool = False
    # LLM-backed chat turns per minute across all users (in-process sliding window),
    # so chat never eats the Gemini quota shared with moderation. Over it: 429.
    chat_global_rate_limit_per_min: int = 2
    # Idle sessions are forgotten after this many hours (checked on each request).
    chat_session_ttl_hours: float = 24.0
    chat_message_max_chars: int = 1000
    # Chat memory (#219): `memory` = in this process (default, tests); `postgres` = LangGraph
    # Postgres checkpointer + message metadata in schema `ai_chat`, shared by every replica.
    # `postgres` needs DATABASE_URL_DIRECT_AI and fails at startup without it.
    chat_memory_backend: str = "memory"
    # Session pooler URL (5432) of the AI database, `?schema=ai` style; Prisma-only query keys
    # are dropped before connecting. Used by `prisma db push` and the Postgres chat memory.
    # Never log this value.
    database_url_direct_ai: str = ""
    # pgvector store of the chatbot index (D22). Empty = the chat agent runs over an
    # empty retriever and the indexer does not start. Never log this value.
    database_url_ai: str = ""
    # Chatbot embeddings (decision 6c, #219). `local` = ONNX multilingual-e5-small baked
    # into the image under EMBEDDING_CACHE_DIR at build time; `fake` = tests only.
    # Changing the model means a full re-embed of the index.
    embedding_provider: str = "local"
    embedding_model: str = "intfloat/multilingual-e5-small"
    embedding_cache_dir: str = "/app/models"
    embedding_batch_size: int = 16

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

from functools import lru_cache

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

    moderation_reject_threshold: float = 0.8
    moderation_warning_threshold: float = 0.4
    # Hard cap for scanning one whole tour (the spec target is 15 s).
    moderation_timeout_seconds: float = 30.0

    # RabbitMQ consumer: attempts per message, base delay, unacked messages in flight.
    event_max_attempts: int = 3
    event_retry_delay_seconds: float = 2.0
    event_prefetch: int = 2

    # Shared secret for service-to-service calls (header x-internal-token).
    internal_service_token: str = ""

    # Set to false to run the API without the RabbitMQ consumer.
    events_enabled: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()

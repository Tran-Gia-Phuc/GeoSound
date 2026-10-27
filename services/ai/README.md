# AI Service

Stateless FastAPI service (Python 3.11, port 3004) of GeoSound. It moderates places (text and images) and tours
(text and coherence) for the Moderation service over HTTP, hosts translation, and later the travel chatbot.
It does not listen to RabbitMQ. Spec: `docs/02-design/ai-service-spec.md`.

| Endpoint | Purpose |
| --- | --- |
| `POST /moderate/place` | One LLM call for the name, description and images of one place |
| `POST /moderate/tour` | One LLM call for the title, description and place coherence of one tour |
| `POST /translate` | Translation (owned by another teammate) |

`/moderate/*` requires the header `x-internal-token` (`INTERNAL_SERVICE_TOKEN`).

## Run

```bash
docker compose up -d --build ai
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build ai   # dev, mounts app/
```

## Test

Tests never call a real LLM or the network (`FakeLLM`, fake image fetcher, fake `langsmith` module).

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "E:/CNPM/git/CNPM-main/services/ai:/src:ro" -w /src -e PYTHONDONTWRITEBYTECODE=1 \
  --entrypoint sh cnpm-main-ai:latest -c "pip install -q pytest; python -m pytest tests -q -p no:cacheprovider"
```

## Environment variables

Values live in the root `.env` (never committed); `services/ai/.env.example` lists the names.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | | Gemini key (secret) |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Primary model |
| `GROQ_API_KEY` | | Groq key (secret), text-only fallback |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Fallback model |
| `LLM_TIMEOUT_SECONDS` | `10` | Timeout of one provider call |
| `INTERNAL_SERVICE_TOKEN` | | Shared token checked on `/moderate/*` (secret); empty rejects every call |
| `MODERATION_REJECT_THRESHOLD` | `0.8` | Severity at or above which the verdict is Reject |
| `MODERATION_WARNING_THRESHOLD` | `0.4` | Severity at or above which the verdict is Warning |
| `MODERATION_TIMEOUT_SECONDS` | `30` | Total time budget of one moderation request |
| `MODERATION_MAX_CONCURRENCY` | `2` | Moderation LLM calls running at the same time |
| `IMAGE_ALLOWED_HOSTS` | | Comma-separated image hosts; empty = host of `SUPABASE_URL` |
| `SUPABASE_URL` | | Only its host is used (image allowlist fallback) |
| `IMAGE_MAX_BYTES` | `3145728` | Max size of one image |
| `IMAGE_FETCH_TIMEOUT_SECONDS` | `10` | Total fetch time of one image |
| `LANGSMITH_TRACING` | `false` | `true` traces each moderation call in LangSmith; when `false` the `langsmith` package is not even imported |
| `LANGSMITH_API_KEY` | | LangSmith key (secret, never logged); empty with tracing on = untraced plus one warning |
| `LANGSMITH_PROJECT` | `geosound-ai` | LangSmith project of the traces |

## LangSmith tracing

With `LANGSMITH_TRACING=true` each `/moderate/place` or `/moderate/tour` call is one LangSmith run
(`moderate_place` or `moderate_tour`, run type `chain`). Inputs are a summary only: ids, language, text lengths and
the number of places or images; no user text, prompt or key. Outputs: verdict, severity, categories, model,
`images_checked` (place) and `latency_ms`; model, verdict and latency are also run metadata. A failed call records
only the exception class name. If `langsmith` is missing, the key is empty or the tracer fails, the call runs
untraced and one warning is logged: tracing never fails a moderation.

Set `LANGSMITH_TRACING` in the process environment (compose `env_file` does this): the `langsmith` client itself reads it from the environment, so a value only in a local `.env` read by the settings class is not enough. A failed call is recorded as a normal run whose output holds only the error class name.

# AI scenario tests and moderation evaluation

Two additions to the AI service tests (`services/ai`), on top of the unit tests in `tests/test_*.py`:

1. **Scenario tests** (`tests/scenarios/`): realistic inputs and provider answers run through the production
   code paths. No LLM, no network (`httpx.MockTransport`, fake chat model). They run with the other tests.
2. **Moderation evaluation** (`eval/run_moderation_eval.py`): a labelled set of place and tour contents for
   measuring the real model. Real runs are manual and on request only, never in CI.

## Scenario tests

| File | What it checks |
| --- | --- |
| `test_llm_providers.py` | `GeminiClient`, `GroqClient`, `FallbackLLM` over HTTP: request shape (key in a header, system prompt, JSON mode, safety filters off for moderation, Groq JSON hint), every provider answer mapped to its error type (429, 5xx, 4xx, timeout, connection, non-JSON, empty, blocked), fallback only on temporary errors and only without images, both providers failing |
| `test_moderation_wiring.py` | `POST /moderate/place` and `/moderate/tour` with the real clients: Vietnamese and English contents (scam, hate, sexual, misleading, off-topic, war-history trap), quota or outage answered by Groq, blocked text = Reject `other` without Groq, every unfinished case = 503 with no provider text, images never sent to Groq, 50-place tour in one call |
| `test_chatbot_scenarios.py` | 19 realistic chat messages (accents or not, injection, off-topic, unknown city, location) through the real `ChatAgent` graph: intent, finish reason, language, LLM call or not, and for every message: citations only from retrieved items, invented ids removed, coordinates never stored |
| `test_moderation_eval.py` | The evaluation dataset is valid for the API schema and balanced; the runner and its metrics (fake model) |

Two gaps found by these tests are fixed in `app/chatbot/graph/rules.py` and kept as regression tests in
`test_chatbot_scenarios.py`:

- a short Vietnamese message typed without accents ("tour an uong o hoi an") was detected as English (the
  client sends no `language`); one folded Vietnamese phrase ("an uong", "tham quan", "dia diem"...) is now
  enough;
- weather questions without the words "thời tiết" / "weather" ("Hội An có mưa không?") reached the retrieval
  and the model; "mưa", "nắng", "bão", "rain", "storm" are now out of scope, while a travel question about the
  weather ("Đi đâu khi trời mưa ở Hà Nội?", "where to go ... when it rains") stays in scope. "mưa" and "nắng"
  match only with accents, since unaccented "mua" also means "buy".

## Moderation evaluation

`eval/datasets/moderation_cases.jsonl`: 22 cases (vi and en, 17 places and 5 tours), each with the API request,
the expected verdict and category:

- 9 legitimate contents, including false-flag traps (war museum, Hoa Lo prison, beer street, "killer banh mi");
- 5 Reject (scam, hate, violence, sexual), 5 Warning (misleading, off-topic, tour coherence);
- 3 prompt injections (fake `SYSTEM` / `[ADMIN]` text, closing tag, instruction in the name).

Metrics: `harmful_recall` (labelled Warning or Reject and not Pass; the key number, target 1.0),
`clean_pass_rate`, `exact_verdict`, `category_hit`, `message_language`, `errors`, plus the ids of
`missed_harmful` and `false_flags`.

```bash
# fake model (answers with the labels): checks the dataset and the pipeline
MSYS_NO_PATHCONV=1 docker run --rm -v "E:/CNPM/git/CNPM-main/services/ai:/src:ro" -w /src -e PYTHONDONTWRITEBYTECODE=1 \
  --user root --entrypoint sh cnpm-main-ai:latest -c "pip install -q -r requirements.txt; python -m eval.run_moderation_eval --model fake"

# real model, on request only: keys from the root .env (never printed); 22 calls, 13 s apart (Gemini free tier)
MSYS_NO_PATHCONV=1 docker run --rm --env-file .env -v "E:/CNPM/git/CNPM-main/services/ai:/src:ro" -w /src \
  -e PYTHONDONTWRITEBYTECODE=1 --user root --entrypoint sh cnpm-main-ai:latest \
  -c "pip install -q -r requirements.txt; python -m eval.run_moderation_eval --model real --out /tmp/mod.json"
```

Options: `--delay SECONDS` between cases (default 13 for `real`, 0 for `fake`), `--cases PATH`, `--out PATH`.

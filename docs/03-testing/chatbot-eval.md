# Chatbot offline evaluation (#AI-48, issue #189)

Offline evaluation of the GeoSound chatbot, as decided in
[chatbot-architecture.md](../02-design/chatbot-architecture.md) section 6d. A script indexes a fixed set of public
tours, asks a fixed set of questions to the real chat agent and reports retrieval and answer metrics.
It runs **on request only, never in CI**. CI keeps the unit tests (`tests/test_eval_runner.py` runs the
script with the fake model and the fake embedder, without network).

## Files

| Path (under `services/ai/`) | Content |
| --- | --- |
| `eval/datasets/tours.json` | 9 fixture public tours (27 places) in `tour.published` shape: Hanoi, Ho Chi Minh City, Hoi An; `vi` and `en`; food, history, architecture, nature; real coordinates. `topics` holds the topic assignment given to the indexer instead of the LLM topic extractor |
| `eval/datasets/questions.jsonl` | 34 questions (vi and en): area plus topic, detail, nearby (with and without a location), small talk, out of scope, cities that are not in the index. Each has `lang`, `expect` (`answer`, `smalltalk`, `refuse`, `no_data`) and `expected_ids` (`tour:ID` / `place:ID`) |
| `eval/run_eval.py` | The runner: real `Indexer` into `InMemoryIndexStore`, `HybridRetriever`, `ChatAgent`; one session per question |
| `tests/test_eval_runner.py` | Unit tests of the runner and the metrics |

## Command

Run from Git Bash. The mount is read-only, so results go to `/tmp` in the container (or mount a writable folder).

```bash
# fake model and fake embedder (default): deterministic, no key, no network after pip install
MSYS_NO_PATHCONV=1 docker run --rm -v "E:/CNPM/git/CNPM-main/services/ai:/src:ro" -w /src -e PYTHONDONTWRITEBYTECODE=1 \
  --entrypoint sh cnpm-main-ai:latest -c "pip install -q -r requirements.txt; python -m eval.run_eval --model fake --out /tmp/eval.json"
```

Options:

| Option | Meaning |
| --- | --- |
| `--model fake` (default) | Deterministic model that cites the top two retrieved items in the language asked by the system prompt. Measures retrieval, routing and the citation pipeline, not answer quality |
| `--model real` | `build_chat_model()` (Gemini, Groq fallback). Needs the provider keys in the container environment (for example `--env-file .env`, never printed). About 25 LLM calls per run (one per answered question), so mind the Gemini free tier (5 requests per minute). Manual runs on request only |
| `--embedder fake` (default) / `e5` | Hashed bag-of-words test embedder, or the local `multilingual-e5-small` when its optional runtime is installed (the script stops with a message otherwise) |
| `--out PATH` | Write the full JSON results (config, summary, one row per question with retrieved ids, citations, answer) |
| `--tours`, `--questions` | Other dataset files |
| `--no-langsmith` | Never upload, even when `LANGSMITH_TRACING=true` |

## Metrics

All metrics are computed without an LLM judge.

| Metric | Definition |
| --- | --- |
| hit@5 | Share of questions with expected ids where at least one expected id is among the at most 5 items the agent retrieved for its answer (the `retrieved` state of the turn). Expected ids list the tour and its relevant places, so any of them counts |
| hit@1 | Share of the same questions where the first retrieved item is an expected id (stricter ranking signal) |
| precision@5 | Mean share of retrieved items that are expected ids |
| citation validity | Share of `[tour:ID]` / `[place:ID]` markers in the **raw** model output (before `cite` removes unknown ids) whose id exists in the index |
| answers with a citation | Share of answered in-scope questions whose final answer has at least one citation |
| answer faithfulness | Heuristic, per answered question with retrieved items: (1) every marker of the raw output names an item retrieved for this turn; (2) every city named in the answer (alias table of `rules.CITY_ALIASES`) is the city of a retrieved item or appears in a retrieved item text; (3) every topic keyword of the answer (topic vocabulary of `rules.build_filters`) is a graph topic of a retrieved item or appears in a retrieved item text. Markers are removed before (2) and (3). It catches invented ids, wrong cities and wrong themes; it does not check free-text facts such as dates |
| language match | `rules.detect_language` of the final answer, without markers and without the titles of retrieved items (Vietnamese titles in an English answer must not count), equals the question `lang` |
| refusal rate, out of scope | Share of out-of-scope questions answered with the polite refusal (`finish_reason == "refused"`) |
| false refusal rate, in scope | Share of in-scope questions answered with a refusal or "no data" |
| no-data rate, unknown city | Share of questions about cities that are not in the index answered with the "no data" message (nothing retrieved, no LLM call) |
| small talk without tools | Share of small-talk questions answered without any retrieval tool |
| max LLM calls per turn | Must stay at most 2 (section 3) |

## Baseline

**Fake-model baseline** (`--model fake --embedder fake`, 2026-10-28, 9 tours, 34 questions). It is the floor
for regressions in retrieval and routing; it says nothing about the quality of a real LLM answer, because the
fake model cites retrieved items by construction (citation validity and faithfulness are 1.00 by design).

| Metric | Value |
| --- | --- |
| hit@5 (24 questions with expected ids) | 1.00 |
| hit@1 (first retrieved item is expected) | 0.79 |
| precision@5 (mean share of expected ids in the top 5) | 0.62 |
| citation validity (47 markers) | 1.00 |
| answers with a citation (answered in-scope) | 1.00 |
| answer faithfulness (24 answers) | 1.00 |
| language match | 1.00 |
| refusal rate, out of scope | 1.00 |
| false refusal rate, in scope | 0.00 |
| no-data rate, unknown city | 1.00 |
| small talk without tools | 1.00 |
| max LLM calls per turn | 1 |

| Category | Questions | hit@5 |
| --- | --- | --- |
| area_topic | 17 | 1.00 |
| detail | 3 | 1.00 |
| nearby | 4 | 1.00 |
| smalltalk | 3 | n/a |
| out_of_scope | 4 | n/a |
| unknown_city | 3 | n/a |

**Real-model baseline:** not recorded yet. It is run on request (`--model real`, then `--embedder e5` once the
local model runtime is in the image) and added here with its date and model name.

## LangSmith

The upload is optional and off by default.

1. Set `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY` and optionally `LANGSMITH_PROJECT` in the container
   environment (never commit or print the key).
2. Run the script without `--no-langsmith`.

The script then creates the dataset `geosound-chatbot-eval` once (inputs: question, lang, location; outputs:
expect, expected ids) and one experiment per run, named `chatbot-eval-<model>-<UTC time>`, with one run per
question and the feedback scores `hit_at_5`, `faithful`, `lang_match`, `citation_validity` and `refused`. With
`--model real`, the LLM calls are also traced by the same flag. `langsmith` is imported lazily; an upload error
is printed and the local report stands. Tests never upload. Traces contain the questions and answers, so keep
tracing off in shared environments unless the team agrees (section 6d).

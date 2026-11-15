"""Offline evaluation of the GeoSound chatbot (task #AI-48, issue #189).

Indexes the fixture public tours (`eval/datasets/tours.json`, tour.published
payloads) with the real `Indexer` into an `InMemoryIndexStore`, builds the real
`ChatAgent` over a `HybridRetriever`, asks every question of
`eval/datasets/questions.jsonl` in its own session, and reports the metrics of
docs/02-design/chatbot-architecture.md section 6d:

- hit@5: share of questions with expected ids where at least one expected id is
  among the (at most 5) items retrieved for the answer
- citation validity: share of `[tour:ID]` / `[place:ID]` markers written by the
  model (raw output, before `cite` cleans it) whose id exists in the index
- answer faithfulness (LLM-free heuristic, see `faithfulness`): every marker of
  the raw output was retrieved for this turn, and the answer names no city and
  no topic that is not supported by the retrieved items
- language match: the answer language (`rules.detect_language` on the answer
  without markers and without the titles of retrieved items) equals the
  question language
- refusal rate: share of out-of-scope questions answered with the polite refusal
  (also reported: false refusals on in-scope questions, "no data" rate on
  questions about cities that are not in the index)

Usage (inside the AI image, from services/ai):

    python -m eval.run_eval --model fake --out /tmp/eval.json
    python -m eval.run_eval --model real --out /tmp/eval-real.json   # real LLM, on request only

`--model fake` (default) is a deterministic model that cites the top two
retrieved items in the requested language: it measures retrieval, routing and
the citation pipeline, not answer quality. `--model real` calls
`build_chat_model()` (Gemini, Groq fallback) and needs the keys in the
environment; it is never run in tests or CI.

When `LANGSMITH_TRACING=true` and `langsmith` is installed, the dataset and the
per-question scores are uploaded to LangSmith as a dataset plus an experiment
(`--no-langsmith` disables it). Tests never upload.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass
from importlib.util import find_spec
from pathlib import Path
from typing import Any

from langchain_core.messages import AIMessage

from app.chatbot.agent import ChatAgent
from app.chatbot.graph import rules
from app.chatbot.rag.embedder import FakeEmbedder
from app.chatbot.rag.hybrid_retriever import HybridRetriever
from app.chatbot.rag.indexer import OUTCOME_INDEXED, Indexer
from app.chatbot.rag.models import TopicAssignment
from app.chatbot.rag.store import InMemoryIndexStore

DATASET_DIR = Path(__file__).resolve().parent / "datasets"
TOURS_PATH = DATASET_DIR / "tours.json"
QUESTIONS_PATH = DATASET_DIR / "questions.jsonl"
LANGSMITH_DATASET = "geosound-chatbot-eval"
HIT_K = rules.TOP_K

_MARKER = re.compile(r"\[(tour|place):([^\[\]\s]{1,100})\]")
_ITEM = re.compile(r"kind: (tour|place)\nid: ([^\n]+)\ntitle: ([^\n]*)")


# ---------- dataset ----------

def load_tours(path: Path = TOURS_PATH) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_questions(path: Path = QUESTIONS_PATH) -> list[dict[str, Any]]:
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


class FixtureTopics:
    """Topic extractor that returns the fixed topics of the dataset (no LLM)."""

    def __init__(self, topics: dict[str, dict]) -> None:
        self.topics = topics

    async def extract(self, doc) -> TopicAssignment | None:
        entry = self.topics.get(doc.tour_id)
        if entry is None:
            return None
        return TopicAssignment(
            tour=tuple(entry.get("tour", ())),
            places={pid: tuple(t) for pid, t in entry.get("places", {}).items()},
        )


async def build_index(tours: dict[str, Any], embedder) -> InMemoryIndexStore:
    store = InMemoryIndexStore(embedder.dimension)
    indexer = Indexer(store, embedder, FixtureTopics(tours.get("topics", {})))
    for payload in tours["tours"]:
        outcome = await indexer.handle_published(payload)
        if outcome != OUTCOME_INDEXED:
            raise RuntimeError(f"fixture tour {payload.get('tourId')} not indexed: {outcome}")
    return store


# ---------- models ----------

class FakeEvalModel:
    """Deterministic chat model: cites the top two retrieved items in the prompt language.

    Answers in Vietnamese when the system prompt says "Answer in Vietnamese",
    else in English. With no items (small talk) it greets and offers help.
    """

    model_name = "fake-eval-model"

    async def ainvoke(self, messages, *args, **kwargs) -> AIMessage:
        system = str(getattr(messages[0], "content", "")) if messages else ""
        vi = "Answer in Vietnamese" in system
        last = str(getattr(messages[-1], "content", "")) if messages else ""
        items = _ITEM.findall(last)[:2]
        if not items:
            text = ("Chào bạn! Mình có thể giúp bạn tìm tour hoặc địa điểm trên GeoSound."
                    if vi else "Hi! I can help you find a tour or a place on GeoSound.")
            return AIMessage(content=text)
        parts = [f"{title.strip()} [{kind}:{item_id.strip()}]" for kind, item_id, title in items]
        if vi:
            text = "Mình gợi ý cho bạn: " + "; ".join(parts) + ". Chúc bạn có chuyến đi vui vẻ!"
        else:
            text = "Here is what I found for you: " + "; ".join(parts) + ". Enjoy your trip!"
        return AIMessage(content=text)


class RecordingModel:
    """Wraps a chat model and keeps the raw text of its last answer (before `cite`)."""

    def __init__(self, inner: Any) -> None:
        self.inner = inner
        self.last_raw: str | None = None

    async def ainvoke(self, messages, *args, **kwargs):
        response = await self.inner.ainvoke(messages, *args, **kwargs)
        content = getattr(response, "content", response)
        if isinstance(content, list):
            content = "".join(
                p if isinstance(p, str) else str(p.get("text", ""))
                for p in content
                if isinstance(p, str) or (isinstance(p, dict) and p.get("type") == "text")
            )
        self.last_raw = str(content)
        return response


def build_model(kind: str) -> Any:
    if kind == "fake":
        return FakeEvalModel()
    if kind == "real":
        from app.chatbot.models import build_chat_model  # lazy: needs provider keys

        return build_chat_model()
    raise ValueError(f"unknown model {kind!r}")


def build_embedder(kind: str):
    if kind == "fake":
        return FakeEmbedder()
    if kind == "e5":
        from app.chatbot.rag.embedder import LocalE5Embedder

        return LocalE5Embedder()  # NotImplementedError when the runtime is not installed
    raise ValueError(f"unknown embedder {kind!r}")


# ---------- metrics ----------

@dataclass
class IndexFacts:
    """What the index knows, for the LLM-free checks."""

    ids: set[str]  # "tour:ID" / "place:ID"
    city_of: dict[str, str | None]  # node id -> canonical city
    topics_of: dict[str, set[str]]  # node id -> topics reached over about / has_stop


async def index_facts(store: InMemoryIndexStore) -> IndexFacts:
    tours = await store.list_nodes("tour")
    places = await store.list_nodes("place")
    city_of: dict[str, str | None] = {}
    for tour in tours:
        raw = tour.props.get("city")
        city_of[tour.id] = (rules.find_city(raw) or raw) if raw else None
    for place in places:
        city_of[place.id] = city_of.get(f"tour:{place.tour_id}")
    ids = [n.id for n in [*tours, *places]]
    topics_of: dict[str, set[str]] = {}
    for reach in await store.neighbours(ids, ("about", "has_stop"), 2):
        if reach.node_id.startswith("topic:"):
            topics_of.setdefault(reach.seed, set()).add(reach.node_id.removeprefix("topic:"))
    return IndexFacts(set(ids), city_of, topics_of)


def _canonical_cities() -> dict[str, dict[str, str]]:
    table: dict[str, dict[str, str]] = {}
    for alias, city in rules.CITY_ALIASES.items():
        table.setdefault(city, {})[alias] = city
        table[city][city.lower()] = city
    return table


_CITY_TABLES = _canonical_cities()


def cities_in(text: str) -> set[str]:
    return {city for city, aliases in _CITY_TABLES.items() if rules.find_city(text, aliases)}


def topics_in(text: str) -> set[str]:
    return set(rules.build_filters(text)["topics"])


def strip_markers(text: str) -> str:
    return _MARKER.sub(" ", text or "")


def answer_language(answer: str, retrieved: list[dict]) -> str:
    """Language of the answer, ignoring markers and the (possibly Vietnamese) item titles."""
    text = strip_markers(answer)
    for item in retrieved:
        if item.get("title"):
            text = text.replace(item["title"], " ")
    return rules.detect_language(text)


def faithfulness(raw: str, retrieved: list[dict], facts: IndexFacts) -> tuple[bool, list[str]]:
    """LLM-free faithfulness heuristic of one answer.

    Faithful when (1) every marker of the raw model output names an item
    retrieved for this turn, (2) every city named in the answer is the city of a
    retrieved item or appears in a retrieved item text, and (3) every topic
    keyword of the answer (rules topic vocabulary) is a graph topic of a
    retrieved item or appears in a retrieved item text. Markers are removed
    before (2) and (3) so ids such as `t-hn-food` do not count as words.
    """
    problems: list[str] = []
    known = {f"{i['kind']}:{i['id']}" for i in retrieved}
    for kind, item_id in _MARKER.findall(raw or ""):
        if f"{kind}:{item_id}" not in known:
            problems.append(f"marker {kind}:{item_id} not retrieved")
    body = strip_markers(raw)
    item_text = " ".join(f"{i.get('title', '')} {i.get('text', '')}" for i in retrieved)
    node_ids = [f"{i['kind']}:{i['id']}" for i in retrieved]
    supported_cities = {facts.city_of.get(n) for n in node_ids} | cities_in(item_text)
    for city in sorted(cities_in(body) - supported_cities):
        problems.append(f"city {city} not in retrieved items")
    supported_topics = set().union(*(facts.topics_of.get(n, set()) for n in node_ids)) | topics_in(item_text)
    for topic in sorted(topics_in(body) - supported_topics):
        problems.append(f"topic {topic} not in retrieved items")
    return (not problems), problems


def _rate(values: list[bool]) -> float | None:
    return round(sum(values) / len(values), 4) if values else None


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    hits = [r["hit_at_5"] for r in rows if r["hit_at_5"] is not None]
    hits_1 = [r["hit_at_1"] for r in rows if r["hit_at_1"] is not None]
    precisions = [r["precision_at_5"] for r in rows if r["precision_at_5"] is not None]
    markers = sum(r["markers"] for r in rows)
    valid = sum(r["valid_markers"] for r in rows)
    faithful = [r["faithful"] for r in rows if r["faithful"] is not None]
    lang = [r["lang_match"] for r in rows]
    oos = [r["finish_reason"] == "refused" for r in rows if r["expect"] == "refuse"]
    false_refusal = [r["finish_reason"] in ("refused", "no_data") for r in rows if r["expect"] == "answer"]
    no_data = [r["finish_reason"] == "no_data" for r in rows if r["expect"] == "no_data"]
    smalltalk = [not r["tools_called"] for r in rows if r["expect"] == "smalltalk"]
    answered = [r for r in rows if r["expect"] == "answer" and r["finish_reason"] == "stop"]
    by_category: dict[str, dict[str, Any]] = {}
    for r in rows:
        cat = by_category.setdefault(r["category"], {"n": 0, "_hits": []})
        cat["n"] += 1
        if r["hit_at_5"] is not None:
            cat["_hits"].append(r["hit_at_5"])
    for cat in by_category.values():
        cat["hit_at_5"] = _rate(cat.pop("_hits"))
    return {
        "questions": len(rows),
        "hit_at_5": _rate(hits),
        "hit_at_5_n": len(hits),
        "hit_at_1": _rate(hits_1),
        "precision_at_5": round(sum(precisions) / len(precisions), 4) if precisions else None,
        "citation_validity": round(valid / markers, 4) if markers else None,
        "citation_markers": markers,
        "answers_with_citation": _rate([bool(r["citations"]) for r in answered]),
        "faithfulness": _rate(faithful),
        "faithfulness_n": len(faithful),
        "language_match": _rate(lang),
        "refusal_rate_out_of_scope": _rate(oos),
        "false_refusal_rate_in_scope": _rate(false_refusal),
        "no_data_rate_unknown_city": _rate(no_data),
        "smalltalk_without_tools": _rate(smalltalk),
        "max_llm_calls_per_turn": max((r["llm_calls"] for r in rows), default=0),
        "by_category": by_category,
    }


# ---------- run ----------

async def run_eval(
    *,
    model: str | Any = "fake",
    embedder: str | Any = "fake",
    tours_path: Path = TOURS_PATH,
    questions_path: Path = QUESTIONS_PATH,
) -> dict[str, Any]:
    """Run the whole evaluation in-process and return {config, summary, rows}."""
    tours = load_tours(tours_path)
    questions = load_questions(questions_path)
    emb = build_embedder(embedder) if isinstance(embedder, str) else embedder
    chat_model = build_model(model) if isinstance(model, str) else model
    recorder = RecordingModel(chat_model)

    store = await build_index(tours, emb)
    facts = await index_facts(store)
    retriever = HybridRetriever(store, emb)
    agent = ChatAgent(
        retriever,
        model=recorder,
        memory_turns=4,
        city_aliases=await retriever.city_aliases_from_index(),
    )

    rows: list[dict[str, Any]] = []
    for q in questions:
        recorder.last_raw = None
        session = f"eval-{q['id']}-{uuid.uuid4().hex[:8]}"
        started = time.perf_counter()
        result = await agent.run(session, q["question"], location=q.get("location"))
        elapsed = time.perf_counter() - started
        snapshot = await agent.graph.aget_state(agent._config(session))
        retrieved = list((snapshot.values or {}).get("retrieved", []))
        retrieved_ids = [f"{i['kind']}:{i['id']}" for i in retrieved]

        expected = q.get("expected_ids") or []
        top = retrieved_ids[:HIT_K]
        hit = bool(set(expected) & set(top)) if expected else None
        hit_1 = (bool(top) and top[0] in expected) if expected else None
        precision = (sum(1 for i in top if i in expected) / len(top) if top else 0.0) if expected else None
        raw = recorder.last_raw if result["llm_calls"] else None
        raw_markers = [f"{k}:{i}" for k, i in _MARKER.findall(raw or "")]
        faithful, problems = (None, [])
        if raw is not None and retrieved:
            faithful, problems = faithfulness(raw, retrieved, facts)
        rows.append({
            "id": q["id"],
            "category": q["category"],
            "lang": q["lang"],
            "question": q["question"],
            "expect": q["expect"],
            "intent": result["intent"],
            "finish_reason": result["finish_reason"],
            "answer_lang": result["lang"],
            "lang_match": answer_language(result["answer"], retrieved) == q["lang"],
            "expected_ids": expected,
            "retrieved_ids": retrieved_ids,
            "hit_at_5": hit,
            "hit_at_1": hit_1,
            "precision_at_5": precision,
            "citations": [f"{c['kind']}:{c['id']}" for c in result["citations"]],
            "markers": len(raw_markers),
            "valid_markers": sum(1 for m in raw_markers if m in facts.ids),
            "faithful": faithful,
            "faithfulness_problems": problems,
            "llm_calls": result["llm_calls"],
            "tools_called": result["tools_called"],
            "seconds": round(elapsed, 3),
            "answer": result["answer"],
        })

    return {
        "config": {
            "model": getattr(chat_model, "model_name", None) or getattr(chat_model, "model", None)
            or type(chat_model).__name__,
            "embedder": emb.model_name,
            "tours": len(tours["tours"]),
            "questions": len(questions),
            "k": HIT_K,
        },
        "summary": summarize(rows),
        "rows": rows,
    }


def _fmt(value: Any) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def format_table(results: dict[str, Any]) -> str:
    s = results["summary"]
    cfg = results["config"]
    lines = [
        f"model={cfg['model']} embedder={cfg['embedder']} tours={cfg['tours']} questions={cfg['questions']}",
        "",
        "| Metric | Value |",
        "| --- | --- |",
        f"| hit@5 ({s['hit_at_5_n']} questions with expected ids) | {_fmt(s['hit_at_5'])} |",
        f"| hit@1 (first retrieved item is expected) | {_fmt(s['hit_at_1'])} |",
        f"| precision@5 (mean share of expected ids in the top 5) | {_fmt(s['precision_at_5'])} |",
        f"| citation validity ({s['citation_markers']} markers) | {_fmt(s['citation_validity'])} |",
        f"| answers with a citation (answered in-scope) | {_fmt(s['answers_with_citation'])} |",
        f"| answer faithfulness ({s['faithfulness_n']} answers) | {_fmt(s['faithfulness'])} |",
        f"| language match | {_fmt(s['language_match'])} |",
        f"| refusal rate, out of scope | {_fmt(s['refusal_rate_out_of_scope'])} |",
        f"| false refusal rate, in scope | {_fmt(s['false_refusal_rate_in_scope'])} |",
        f"| no-data rate, unknown city | {_fmt(s['no_data_rate_unknown_city'])} |",
        f"| small talk without tools | {_fmt(s['smalltalk_without_tools'])} |",
        f"| max LLM calls per turn | {s['max_llm_calls_per_turn']} |",
        "",
        "| Category | Questions | hit@5 |",
        "| --- | --- | --- |",
    ]
    for name, cat in s["by_category"].items():
        lines.append(f"| {name} | {cat['n']} | {_fmt(cat['hit_at_5'])} |")
    misses = [r["id"] for r in results["rows"] if r["hit_at_5"] is False]
    unfaithful = [r["id"] for r in results["rows"] if r["faithful"] is False]
    lines += ["", f"hit@5 misses: {', '.join(misses) or 'none'}",
              f"unfaithful answers: {', '.join(unfaithful) or 'none'}"]
    return "\n".join(lines)


# ---------- LangSmith (optional) ----------

def langsmith_enabled() -> bool:
    return os.getenv("LANGSMITH_TRACING", "").strip().lower() == "true" and find_spec("langsmith") is not None


def upload_to_langsmith(results: dict[str, Any], questions: list[dict[str, Any]],
                        dataset_name: str = LANGSMITH_DATASET) -> str | None:
    """Upload the dataset (once) and one experiment with per-question scores. Never raises."""
    try:
        from datetime import datetime, timezone

        from langsmith import Client  # lazy: optional at runtime, never imported in tests

        client = Client()
        if client.has_dataset(dataset_name=dataset_name):
            dataset = client.read_dataset(dataset_name=dataset_name)
        else:
            dataset = client.create_dataset(dataset_name, description="GeoSound chatbot offline eval (#189)")
            client.create_examples(
                inputs=[{"question": q["question"], "lang": q["lang"], "location": q.get("location")}
                        for q in questions],
                outputs=[{"expect": q["expect"], "expected_ids": q.get("expected_ids", []), "id": q["id"]}
                         for q in questions],
                dataset_id=dataset.id,
            )
        examples = {e.outputs.get("id"): e.id for e in client.list_examples(dataset_id=dataset.id)
                    if e.outputs}
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        experiment = f"chatbot-eval-{results['config']['model']}-{stamp}"
        client.create_project(experiment, reference_dataset_id=dataset.id,
                              metadata={"config": results["config"], "summary": results["summary"]})
        for row in results["rows"]:
            run_id = uuid.uuid4()
            now = datetime.now(timezone.utc)
            client.create_run(
                id=run_id, name="chat_turn", run_type="chain", project_name=experiment,
                inputs={"question": row["question"], "lang": row["lang"]},
                outputs={"answer": row["answer"], "retrieved_ids": row["retrieved_ids"],
                         "citations": row["citations"], "finish_reason": row["finish_reason"]},
                reference_example_id=examples.get(row["id"]), start_time=now, end_time=now,
            )
            scores = {"hit_at_5": row["hit_at_5"], "faithful": row["faithful"],
                      "lang_match": row["lang_match"]}
            if row["markers"]:
                scores["citation_validity"] = row["valid_markers"] / row["markers"]
            if row["expect"] == "refuse":
                scores["refused"] = row["finish_reason"] == "refused"
            for key, value in scores.items():
                if value is not None:
                    client.create_feedback(run_id, key, score=float(value))
        return experiment
    except Exception as exc:  # noqa: BLE001 - upload is best effort, the local report stands
        print(f"LangSmith upload skipped: {type(exc).__name__}: {exc}", file=sys.stderr)
        return None


# ---------- CLI ----------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="GeoSound chatbot offline evaluation (#189)")
    parser.add_argument("--model", choices=("fake", "real"), default="fake",
                        help="fake (default, deterministic) or real (calls the LLM; manual runs only)")
    parser.add_argument("--embedder", choices=("fake", "e5"), default="fake",
                        help="fake hashed embedder (default) or local multilingual-e5-small if installed")
    parser.add_argument("--tours", type=Path, default=TOURS_PATH)
    parser.add_argument("--questions", type=Path, default=QUESTIONS_PATH)
    parser.add_argument("--out", type=Path, default=None, help="write JSON results to this path")
    parser.add_argument("--no-langsmith", action="store_true", help="never upload, even with LANGSMITH_TRACING=true")
    args = parser.parse_args(argv)

    try:
        results = asyncio.run(run_eval(model=args.model, embedder=args.embedder,
                                       tours_path=args.tours, questions_path=args.questions))
    except NotImplementedError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(format_table(results))
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nresults written to {args.out}")
    if not args.no_langsmith and langsmith_enabled():
        experiment = upload_to_langsmith(results, load_questions(args.questions))
        if experiment:
            print(f"LangSmith experiment: {experiment}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

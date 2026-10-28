"""Chatbot offline evaluation runner (#AI-48, issue #189).

Runs `eval.run_eval` in-process with the fake model and the fake embedder on
the fixture dataset: no network, no LLM, no LangSmith upload.
"""

import asyncio
import json

import pytest
from langchain_core.messages import AIMessage

from eval import run_eval as ev


@pytest.fixture(scope="module")
def results():
    return asyncio.run(ev.run_eval(model="fake", embedder="fake"))


def test_dataset_has_about_30_bilingual_questions_with_known_ids():
    questions = ev.load_questions()
    tours = ev.load_tours()
    assert len(questions) >= 30
    assert {q["lang"] for q in questions} == {"vi", "en"}
    assert {"area_topic", "nearby", "smalltalk", "out_of_scope", "unknown_city"} <= {
        q["category"] for q in questions
    }
    assert len({q["id"] for q in questions}) == len(questions)
    ids = {f"tour:{t['tourId']}" for t in tours["tours"]}
    ids |= {f"place:{p['placeId']}" for t in tours["tours"] for p in t["places"]}
    for q in questions:
        assert set(q["expected_ids"]) <= ids, q["id"]
        assert (q["expect"] == "answer") == bool(q["expected_ids"]), q["id"]
    assert {t["city"] for t in tours["tours"]} >= {"Hanoi", "Hoi An", "Ho Chi Minh City"}


def test_fake_run_computes_every_metric_in_sane_ranges(results):
    s = results["summary"]
    assert s["questions"] == len(ev.load_questions())
    for key in ("hit_at_5", "hit_at_1", "precision_at_5", "citation_validity", "faithfulness",
                "language_match", "refusal_rate_out_of_scope", "false_refusal_rate_in_scope",
                "no_data_rate_unknown_city", "answers_with_citation"):
        assert s[key] is not None and 0.0 <= s[key] <= 1.0, key
    assert s["hit_at_5"] >= 0.8
    assert s["hit_at_1"] <= s["hit_at_5"]
    assert s["citation_validity"] == 1.0  # the fake model only cites retrieved ids
    assert s["faithfulness"] >= 0.9
    assert s["language_match"] >= 0.9
    assert s["refusal_rate_out_of_scope"] == 1.0
    assert s["no_data_rate_unknown_city"] == 1.0
    assert s["false_refusal_rate_in_scope"] <= 0.1
    assert s["smalltalk_without_tools"] == 1.0
    assert 1 <= s["max_llm_calls_per_turn"] <= 2


def test_rows_respect_the_routing(results):
    rows = {r["id"]: r for r in results["rows"]}
    for r in rows.values():
        assert len(r["retrieved_ids"]) <= ev.HIT_K
        assert set(r["citations"]) <= set(r["retrieved_ids"])
        if r["expect"] == "refuse":
            assert r["finish_reason"] == "refused" and r["llm_calls"] == 0 and not r["tools_called"]
        if r["expect"] == "no_data":
            assert r["finish_reason"] == "no_data" and r["retrieved_ids"] == []
    assert "nearby_places" in rows["q21"]["tools_called"]


def test_table_lists_the_metrics(results):
    table = ev.format_table(results)
    for label in ("hit@5", "citation validity", "answer faithfulness", "language match",
                  "refusal rate, out of scope"):
        assert label in table


class InventingModel:
    """Cites an id that is not in the index and names a city it was not given."""

    model_name = "inventing"

    async def ainvoke(self, messages, *args, **kwargs):
        return AIMessage(content="Try the imperial walk in Hue [tour:t-not-indexed].")


def test_invented_ids_and_cities_lower_validity_and_faithfulness():
    out = asyncio.run(ev.run_eval(model=InventingModel(), embedder="fake"))
    s = out["summary"]
    assert s["citation_validity"] == 0.0
    assert s["faithfulness"] == 0.0
    assert s["answers_with_citation"] == 0.0  # `cite` dropped every invented marker
    problems = next(r["faithfulness_problems"] for r in out["rows"] if r["faithful"] is False)
    assert any("not retrieved" in p for p in problems)
    assert any("Hue" in p for p in problems)


def test_faithfulness_heuristic():
    facts = ev.IndexFacts(
        ids={"tour:t1", "place:p1"},
        city_of={"tour:t1": "Hanoi", "place:p1": "Hanoi"},
        topics_of={"tour:t1": {"food"}},
    )
    items = [{"kind": "tour", "id": "t1", "title": "Old Quarter walk", "text": "city: Hanoi."}]
    assert ev.faithfulness("Old Quarter food walk in Hà Nội [tour:t1].", items, facts) == (True, [])
    ok, problems = ev.faithfulness("A history tour in Hoi An [place:p1].", items, facts)
    assert not ok
    assert "marker place:p1 not retrieved" in problems
    assert "city Hoi An not in retrieved items" in problems
    assert "topic history not in retrieved items" in problems


def test_answer_language_ignores_titles_and_markers():
    items = [{"kind": "tour", "id": "t1", "title": "Phố cổ Hội An"}]
    assert ev.answer_language("Here is a walk: Phố cổ Hội An [tour:t1]. Enjoy it!", items) == "en"
    assert ev.answer_language("Mình gợi ý cho bạn tour này nhé.", items) == "vi"


def test_langsmith_is_off_without_the_flag(monkeypatch):
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)
    assert ev.langsmith_enabled() is False


def test_cli_writes_json_without_uploading(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.setattr(ev, "upload_to_langsmith", lambda *a, **k: pytest.fail("must not upload"))
    out = tmp_path / "eval.json"
    assert ev.main(["--model", "fake", "--out", str(out), "--no-langsmith"]) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["config"]["model"] == "fake-eval-model"
    assert "hit@5" in capsys.readouterr().out

"""Moderation eval dataset and runner (eval/run_moderation_eval.py), fake model only."""

import asyncio

from app.moderation.schema import Category
from eval import run_moderation_eval as ev


def test_dataset_is_valid_balanced_and_bilingual():
    cases = ev.load_cases()
    assert len(cases) >= 20
    assert len({c["id"] for c in cases}) == len(cases)
    for case in cases:
        ev.parse_request(case)  # every request is valid for the real API schema
        assert case["expect"] in ("Pass", "Warning", "Reject"), case["id"]
        assert (case["category"] is None) == (case["expect"] == "Pass"), case["id"]
        if case["category"]:
            assert case["category"] in set(Category), case["id"]
    assert {c["request"]["language"] for c in cases} == {"vi", "en"}
    assert {c["kind"] for c in cases} == {"place", "tour"}
    labelled = {c["category"] for c in cases if c["category"]}
    assert {"hate", "violence", "sexual", "scam", "misleading", "irrelevant"} <= labelled
    # Enough legitimate content (incl. war history, nightlife) to measure false flags.
    assert sum(c["expect"] == "Pass" for c in cases) >= len(cases) // 3
    assert any(c["id"].startswith("i") for c in cases)  # prompt-injection cases


def test_fake_run_scores_every_metric_perfectly():
    results = asyncio.run(ev.run_eval("fake"))
    s = results["summary"]
    assert s["errors"] == 0
    assert s["harmful_recall"] == s["clean_pass_rate"] == s["exact_verdict"] == 1.0
    assert s["category_hit"] == s["message_language"] == 1.0
    assert s["missed_harmful"] == s["false_flags"] == []
    assert all(r["model"] == "fake-labels" for r in results["rows"])


def test_summary_counts_misses_false_flags_and_errors():
    rows = [
        {"id": "a", "expect": "Reject", "category": "scam", "verdict": "Pass",
         "categories": [], "lang_ok": True},
        {"id": "b", "expect": "Warning", "category": "misleading", "verdict": "Reject",
         "categories": ["misleading"], "lang_ok": False},
        {"id": "c", "expect": "Pass", "category": None, "verdict": "Warning",
         "categories": ["other"], "lang_ok": True},
        {"id": "d", "expect": "Pass", "category": None, "verdict": None, "error": "LLMError"},
    ]
    s = ev.summarize(rows)
    assert s["errors"] == 1 and s["cases"] == 4
    assert s["harmful_recall"] == 0.5 and s["missed_harmful"] == ["a"]
    assert s["clean_pass_rate"] == 0.0 and s["false_flags"] == ["c"]
    assert s["exact_verdict"] == 0.0 and s["category_hit"] == 0.5
    assert s["message_language"] == 0.667


def test_message_language_check():
    assert ev.message_language_ok([{"message": "Nội dung lừa đảo."}], "vi")
    assert not ev.message_language_ok([{"message": "Scam content."}], "vi")
    assert ev.message_language_ok([{"message": "Scam content."}], "en")
    assert ev.message_language_ok([], "vi")


def test_cli_fake_prints_table_and_writes_json(tmp_path, capsys):
    out = tmp_path / "r.json"
    assert ev.main(["--model", "fake", "--out", str(out)]) == 0
    assert "harmful_recall" in capsys.readouterr().out
    assert '"summary"' in out.read_text(encoding="utf-8")

"""Offline evaluation of place and tour moderation.

Runs every labelled case of `eval/datasets/moderation_cases.jsonl` through the
real PlaceModerator / TourModerator (prompt, parsing, policy) and reports:

- harmful recall: share of cases labelled Warning or Reject that are NOT Pass
  (the key number: harmful content must never be auto-published)
- clean pass rate: share of cases labelled Pass that are Pass (false flags on
  legitimate content such as war museums or nightlife)
- exact verdict: verdict == label
- category hit: the labelled category is among the returned reasons
- message language: every reason message is in the request language
- errors: cases that ended with an exception (quota, outage)

Usage (inside the AI image, from services/ai):

    python -m eval.run_moderation_eval --model fake
    python -m eval.run_moderation_eval --model real --out /tmp/mod-real.json   # on request only

`--model fake` answers with the labels themselves: it checks the dataset and the
pipeline, not the model. `--model real` uses the production wiring (Gemini with
the Groq fallback) and needs the keys in the environment; `--delay` (default 13 s)
keeps it under the Gemini free tier of 5 requests per minute. Never run in tests or CI.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

from app.moderation.place_service import PlaceModerator
from app.moderation.schema import PlaceModerationRequest, TourModerationRequest
from app.moderation.tour_service import TourModerator

CASES_PATH = Path(__file__).parent / "datasets" / "moderation_cases.jsonl"
# Letters that only occur in Vietnamese; a Vietnamese sentence has at least one.
_VI = re.compile(r"[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]", re.I)
_SEVERITY = {"Pass": 0.0, "Warning": 0.55, "Reject": 0.9}


def load_cases(path: Path = CASES_PATH) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def parse_request(case: dict[str, Any]):
    model = PlaceModerationRequest if case["kind"] == "place" else TourModerationRequest
    return model(**case["request"])


class LabelLLM:
    """Fake model: answers each prompt with the finding its case is labelled with."""

    model = "fake-labels"

    def __init__(self, cases: list[dict[str, Any]]) -> None:
        self.cases = cases

    async def generate_json(self, prompt: str, **kwargs: Any) -> dict[str, Any]:
        case = next(c for c in self.cases if c["request"]["description"][:60] in prompt)
        if case["expect"] == "Pass":
            return {"findings": []}
        vi = case["request"]["language"] == "vi"
        return {"findings": [{
            "field": "description",
            "category": case["category"],
            "severity": _SEVERITY[case["expect"]],
            "message": "Nội dung có vấn đề." if vi else "This content is a problem.",
        }]}


def build_moderators(kind: str, cases: list[dict[str, Any]]):
    if kind == "fake":
        llm = LabelLLM(cases)
        return PlaceModerator(llm=llm), TourModerator(llm=llm)
    return PlaceModerator(), TourModerator()


def message_language_ok(reasons: list[dict[str, Any]], lang: str) -> bool:
    return all(bool(_VI.search(r["message"])) == (lang == "vi") for r in reasons)


async def run_case(case: dict[str, Any], place: PlaceModerator, tour: TourModerator) -> dict:
    request = parse_request(case)
    started = time.perf_counter()
    row: dict[str, Any] = {"id": case["id"], "kind": case["kind"], "expect": case["expect"],
                           "category": case["category"]}
    try:
        if case["kind"] == "place":
            response = await place.moderate_place(request)
        else:
            response = await tour.moderate_tour(request)
    except Exception as exc:  # quota, outage, malformed output: counted, not fatal
        row.update(verdict=None, error=type(exc).__name__)
        return row
    reasons = [r.model_dump(mode="json") for r in response.reasons]
    row.update(
        verdict=response.verdict.value,
        severity=response.severity,
        categories=[r["category"] for r in reasons],
        messages=[r["message"] for r in reasons],
        model=response.model,
        lang_ok=message_language_ok(reasons, case["request"]["language"]),
        seconds=round(time.perf_counter() - started, 2),
    )
    return row


def _rate(values: list[bool]) -> float | None:
    return round(sum(values) / len(values), 3) if values else None


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    done = [r for r in rows if r.get("verdict")]
    harmful = [r for r in done if r["expect"] != "Pass"]
    clean = [r for r in done if r["expect"] == "Pass"]
    return {
        "cases": len(rows),
        "errors": len(rows) - len(done),
        "harmful_recall": _rate([r["verdict"] != "Pass" for r in harmful]),
        "clean_pass_rate": _rate([r["verdict"] == "Pass" for r in clean]),
        "exact_verdict": _rate([r["verdict"] == r["expect"] for r in done]),
        "category_hit": _rate([r["category"] in r["categories"] for r in harmful]),
        "message_language": _rate([r["lang_ok"] for r in done]),
        "missed_harmful": [r["id"] for r in harmful if r["verdict"] == "Pass"],
        "false_flags": [r["id"] for r in clean if r["verdict"] != "Pass"],
    }


async def run_eval(model: str = "fake", delay: float = 0.0, path: Path = CASES_PATH) -> dict:
    cases = load_cases(path)
    place, tour = build_moderators(model, cases)
    rows = []
    for i, case in enumerate(cases):
        if i and delay:
            await asyncio.sleep(delay)
        rows.append(await run_case(case, place, tour))
    return {"model": model, "summary": summarize(rows), "rows": rows}


def format_table(results: dict[str, Any]) -> str:
    lines = [f"{'case':28} {'expect':8} {'got':8} {'categories'}"]
    for r in results["rows"]:
        got = r.get("verdict") or f"ERR {r.get('error')}"
        mark = "" if got == r["expect"] else ("  <- MISSED" if got == "Pass" else "  *")
        lines.append(f"{r['id']:28} {r['expect']:8} {got:8} {','.join(r.get('categories', []))}{mark}")
    lines.append("")
    lines += [f"{k:18} {v}" for k, v in results["summary"].items()]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="GeoSound moderation offline evaluation")
    parser.add_argument("--model", choices=("fake", "real"), default="fake")
    parser.add_argument("--delay", type=float, default=None,
                        help="seconds between cases (default 13 for real, 0 for fake)")
    parser.add_argument("--cases", type=Path, default=CASES_PATH)
    parser.add_argument("--out", type=Path, default=None, help="write JSON results to this path")
    args = parser.parse_args(argv)
    delay = args.delay if args.delay is not None else (13.0 if args.model == "real" else 0.0)
    results = asyncio.run(run_eval(args.model, delay, args.cases))
    print(format_table(results))
    if args.out:
        args.out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Tour moderation: ONE text-only LLM call per tour (task #AI-22).

Input: title, description, places (name + first 300 chars of description).
Fields in reasons: "title", "description", "coherence".
A tour scan never rescans its places individually.
"""

from pathlib import Path
from typing import Any

PROMPT_PATH = Path(__file__).parent / "prompts" / "tour_moderation.txt"
PLACE_DESCRIPTION_SNIPPET = 300


class TourModerator:
    def __init__(self, llm: Any = None) -> None:
        self.llm = llm
        self.system_prompt = PROMPT_PATH.read_text(encoding="utf-8")

    async def scan_tour(self, request: Any) -> list[Any]:
        raise NotImplementedError("#AI-22")

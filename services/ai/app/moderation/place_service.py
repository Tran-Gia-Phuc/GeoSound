"""Place moderation: ONE LLM call for name + description (task #AI-20).

Flow: validator -> build prompt -> FallbackLLM.generate_json -> RawScan ->
policy.build_response. The LLM only reports findings; policy.py decides.
LLMBlockedError is a Reject with category "other", never an infrastructure error.
Phase 2 (#AI-24) adds images through images.py; until then images_checked = 0.
"""

from pathlib import Path
from typing import Any

PROMPT_PATH = Path(__file__).parent / "prompts" / "place_moderation.txt"


class PlaceModerator:
    def __init__(self, llm: Any = None) -> None:
        # TODO(#AI-20): FallbackLLM(primary=GeminiClient(safety_block_none=True)) by default.
        self.llm = llm
        self.system_prompt = PROMPT_PATH.read_text(encoding="utf-8")

    async def scan_place(self, request: Any) -> list[Any]:
        """Return raw findings (field = "name" | "description")."""
        raise NotImplementedError("#AI-20")

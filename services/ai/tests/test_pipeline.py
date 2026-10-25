import asyncio

import pytest

from app.llm.errors import LLMTimeoutError
from app.moderation.pipeline import run_moderation
from app.moderation.schema import ModerationRequest
from app.moderation.service import TextModerator

REQ = ModerationRequest(tour_id="t1", title="Food tour")


class SlowLLM:
    async def generate_json(self, prompt, **kwargs):
        await asyncio.sleep(1)
        return {"findings": []}


class QuickLLM:
    async def generate_json(self, prompt, **kwargs):
        return {"findings": []}


def test_timeout_becomes_llm_timeout_error():
    moderator = TextModerator(llm=SlowLLM())
    with pytest.raises(LLMTimeoutError):
        asyncio.run(run_moderation(moderator, REQ, timeout=0.05))


def test_fast_run_returns_pass():
    moderator = TextModerator(llm=QuickLLM())
    response = asyncio.run(run_moderation(moderator, REQ, timeout=5))
    assert response.verdict == "Pass"

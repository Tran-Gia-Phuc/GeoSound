"""Moderation pipeline: time budget, shared semaphore, error mapping (task #AI-30).

No LLM at all: the work is a plain coroutine.
"""

import asyncio
import gc

import pytest

from app.config import get_settings
from app.llm.errors import (
    LLMBadRequestError,
    LLMResponseError,
    LLMServerError,
    LLMTimeoutError,
)
from app.moderation import pipeline
from app.moderation.pipeline import (
    ModerationTimeoutError,
    ModerationUnavailableError,
    run_moderation,
    shared_semaphore,
)


def run(coro):
    return asyncio.run(coro)


async def ok():
    return "done"


def test_returns_the_result():
    assert run(run_moderation(ok, timeout=1, semaphore=asyncio.Semaphore(1))) == "done"


def test_timeout_raises_moderation_timeout():
    async def slow():
        await asyncio.sleep(5)

    with pytest.raises(ModerationTimeoutError):
        run(run_moderation(slow, timeout=0.02, semaphore=asyncio.Semaphore(1)))


def test_timeout_is_a_temporary_failure():
    assert issubclass(ModerationTimeoutError, ModerationUnavailableError)


def test_timeout_comes_from_settings(monkeypatch):
    monkeypatch.setenv("MODERATION_TIMEOUT_SECONDS", "0.02")
    get_settings.cache_clear()
    try:

        async def slow():
            await asyncio.sleep(5)

        with pytest.raises(ModerationTimeoutError):
            run(run_moderation(slow, semaphore=asyncio.Semaphore(1)))
    finally:
        get_settings.cache_clear()


def test_time_budget_includes_waiting_for_a_slot():
    async def scenario():
        semaphore = asyncio.Semaphore(1)
        await semaphore.acquire()  # the only slot is busy
        with pytest.raises(ModerationTimeoutError):
            await run_moderation(ok, timeout=0.02, semaphore=semaphore)

    run(scenario())


@pytest.mark.parametrize(
    "error",
    [
        LLMServerError("down", provider="groq", status_code=503),
        LLMTimeoutError("slow", provider="groq"),
        LLMBadRequestError("bad key", provider="gemini", status_code=400),
        LLMResponseError("not json", provider="gemini"),
    ],
)
def test_llm_errors_become_unavailable(error):
    async def failing():
        raise error

    with pytest.raises(ModerationUnavailableError) as info:
        run(run_moderation(failing, timeout=1, semaphore=asyncio.Semaphore(1)))
    assert info.value.__cause__ is error
    assert not isinstance(info.value, ModerationTimeoutError)


def test_other_errors_propagate():
    async def bug():
        raise ValueError("bug")

    with pytest.raises(ValueError):
        run(run_moderation(bug, timeout=1, semaphore=asyncio.Semaphore(1)))


def test_semaphore_limits_concurrency():
    async def scenario():
        semaphore = asyncio.Semaphore(2)
        active = 0
        peak = 0

        async def work():
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.01)
            active -= 1
            return True

        results = await asyncio.gather(
            *(run_moderation(work, timeout=2, semaphore=semaphore) for _ in range(6))
        )
        return results, peak

    results, peak = run(scenario())
    assert results == [True] * 6
    assert peak == 2


def test_slot_is_released_after_a_failure():
    async def scenario():
        semaphore = asyncio.Semaphore(1)

        async def failing():
            raise LLMServerError("down", provider="gemini")

        with pytest.raises(ModerationUnavailableError):
            await run_moderation(failing, timeout=1, semaphore=semaphore)
        return await run_moderation(ok, timeout=1, semaphore=semaphore)

    assert run(scenario()) == "done"


def test_shared_semaphore_is_reused_and_sized_from_settings(monkeypatch):
    monkeypatch.setenv("MODERATION_MAX_CONCURRENCY", "3")
    get_settings.cache_clear()
    try:

        async def scenario():
            first = shared_semaphore()
            second = shared_semaphore()
            return first is second, first._value

        same, size = run(scenario())
        assert same
        assert size == 3
    finally:
        get_settings.cache_clear()


def test_shared_semaphore_is_per_loop_and_released_with_the_loop():
    async def get():
        return shared_semaphore(2)

    loop_a = asyncio.new_event_loop()
    loop_b = asyncio.new_event_loop()
    try:
        sem_a = loop_a.run_until_complete(get())
        sem_b = loop_b.run_until_complete(get())
        assert sem_a is not sem_b
        assert loop_a.run_until_complete(get()) is sem_a
        assert loop_a in pipeline._semaphores
    finally:
        loop_a.close()
        loop_b.close()
    del loop_a, loop_b
    gc.collect()
    # Entries are keyed by the loop object, never by a reusable id().
    assert all(not loop.is_closed() for loop in pipeline._semaphores.keys())


def test_unavailable_error_does_not_copy_provider_text():
    async def failing():
        raise LLMBadRequestError("API key AIza-secret invalid", provider="gemini", status_code=400)

    with pytest.raises(ModerationUnavailableError) as info:
        run(run_moderation(failing, timeout=1, semaphore=asyncio.Semaphore(1)))
    assert "AIza-secret" not in str(info.value)

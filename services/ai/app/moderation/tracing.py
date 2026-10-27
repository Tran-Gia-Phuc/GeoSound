"""Optional LangSmith tracing of moderation calls (task #AI-32, decision D12).

Usage (api/moderation.py):

    await trace_moderation("place")(moderator.moderate_place)(request)

- LANGSMITH_TRACING=false (default): trace_moderation(kind) returns the
  function unchanged. `langsmith` is never imported, so there is no import
  side effect and no network.
- LANGSMITH_TRACING=true: `langsmith` is imported lazily and each call becomes
  exactly one LangSmith run (run_type "chain", name "moderate_place" or
  "moderate_tour", project LANGSMITH_PROJECT).
- Privacy: the run inputs are a summary only (ids, language, text lengths,
  number of places or images). No user text, no prompt, no key. The outputs
  are verdict, severity, categories, model, images_checked and latency_ms.
  A failed call records only the exception class name; the original
  exception is re-raised unchanged to the caller.
- Tracing never breaks moderation: if `langsmith` is missing, the key is
  empty or the tracer itself fails, one warning is logged (no secrets) and
  the call runs untraced.
"""

import importlib
import logging
import time
from collections.abc import Awaitable, Callable
from functools import lru_cache
from typing import Any, NamedTuple, TypeVar

from app.config import get_settings

logger = logging.getLogger(__name__)

T = TypeVar("T")
ModerationCall = Callable[[Any], Awaitable[T]]

TRACE_NAMES = {"place": "moderate_place", "tour": "moderate_tour"}


class Tracer(NamedTuple):
    module: Any  # the imported `langsmith` module
    client: Any  # langsmith.Client built with the configured key
    project: str


@lru_cache
def load_tracer() -> Tracer | None:
    """Import langsmith and build its client once. None = run untraced.

    Cached, so each problem is logged once per process. Tests call
    load_tracer.cache_clear() after changing settings.
    """
    settings = get_settings()
    if not settings.langsmith_tracing:
        return None
    api_key = settings.langsmith_api_key.get_secret_value().strip()
    if not api_key:
        logger.warning("LANGSMITH_TRACING is on but LANGSMITH_API_KEY is empty; tracing disabled")
        return None
    try:
        module = importlib.import_module("langsmith")
    except ImportError:
        logger.warning("LANGSMITH_TRACING is on but the langsmith package is not installed; tracing disabled")
        return None
    try:
        client = module.Client(api_key=api_key)
    except Exception as exc:  # never fail moderation because of tracing
        logger.warning("LangSmith client could not be created (%s); tracing disabled", type(exc).__name__)
        return None
    return Tracer(module=module, client=client, project=settings.langsmith_project)


def summarize_request(kind: str, request: Any) -> dict[str, Any]:
    """Trace inputs: ids, language and sizes only, never the user text."""
    summary: dict[str, Any] = {"language": str(getattr(request.language, "value", request.language))}
    if kind == "place":
        summary.update(
            place_id=request.place_id,
            tour_id=request.tour_id,
            name_length=len(request.name),
            description_length=len(request.description),
            images=len(request.images),
        )
    else:
        summary.update(
            tour_id=request.tour_id,
            title_length=len(request.title),
            description_length=len(request.description),
            places=len(request.places),
            duration_minutes=request.duration_minutes,
        )
    return summary


def summarize_response(response: Any, latency_ms: float) -> dict[str, Any]:
    """Trace outputs: verdict, severity, categories, model, latency (no messages)."""
    outputs: dict[str, Any] = {
        "verdict": str(getattr(response.verdict, "value", response.verdict)),
        "severity": response.severity,
        "categories": sorted({str(getattr(r.category, "value", r.category)) for r in response.reasons}),
        "reasons": len(response.reasons),
        "model": response.model,
        "latency_ms": latency_ms,
    }
    if hasattr(response, "images_checked"):
        outputs["images_checked"] = response.images_checked
    return outputs


def _add_run_metadata(module: Any, metadata: dict[str, Any]) -> None:
    """Best effort: copy model, verdict and latency to the run metadata (filterable in LangSmith)."""
    try:
        get_run_tree = getattr(module, "get_current_run_tree", None)
        run_tree = get_run_tree() if get_run_tree else None
        if run_tree is not None:
            run_tree.add_metadata(metadata)
    except Exception:  # metadata is a convenience, never an error
        pass


def _elapsed_ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 1)


def trace_moderation(kind: str) -> Callable[[ModerationCall], ModerationCall]:
    """Decorator factory: trace one moderation call of `kind` ("place" or "tour")."""
    if kind not in TRACE_NAMES:
        raise ValueError(f"unknown moderation kind: {kind}")

    def decorate(func: ModerationCall) -> ModerationCall:
        if not get_settings().langsmith_tracing:
            return func  # flag off: no wrapper, no import, no network
        tracer = load_tracer()
        if tracer is None:
            return func

        async def traced_call(request: Any) -> Any:
            box: dict[str, Any] = {}

            async def run(inputs: dict[str, Any]) -> dict[str, Any]:
                # `inputs` is the only argument, so it is all LangSmith records as input.
                start = time.perf_counter()
                try:
                    box["result"] = await func(request)
                except Exception as exc:
                    box["error"] = exc
                    # Class name only: provider messages may echo request text.
                    return {"error": type(exc).__name__, "latency_ms": _elapsed_ms(start)}
                outputs = summarize_response(box["result"], _elapsed_ms(start))
                _add_run_metadata(
                    tracer.module,
                    {k: outputs[k] for k in ("model", "verdict", "latency_ms")},
                )
                return outputs

            try:
                traced = tracer.module.traceable(
                    run_type="chain",
                    name=TRACE_NAMES[kind],
                    project_name=tracer.project,
                    client=tracer.client,
                    metadata={"kind": kind, "service": "ai"},
                )(run)
                await traced(summarize_request(kind, request))
            except Exception as exc:
                if "result" not in box and "error" not in box:
                    # The tracer failed before the work ran: run it untraced.
                    logger.warning("LangSmith tracing failed (%s); running untraced", type(exc).__name__)
                    return await func(request)
                if "result" in box:
                    logger.warning("LangSmith tracing failed after the call (%s)", type(exc).__name__)
            if "error" in box:
                raise box["error"]
            return box["result"]

        return traced_call

    return decorate

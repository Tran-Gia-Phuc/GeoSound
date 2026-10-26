import logging
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException

from app.llm.errors import LLMError
from app.translation.schema import TranslateRequest, TranslateResponse
from app.translation.service import Translator

logger = logging.getLogger(__name__)

router = APIRouter()


@lru_cache
def get_translator() -> Translator:
    return Translator()


@router.post("/translate", response_model=TranslateResponse)
async def translate(
    request: TranslateRequest,
    translator: Translator = Depends(get_translator),
) -> TranslateResponse:
    """Translate the narration texts of a tour into one target language (UC#12).

    422 is raised by FastAPI for invalid input. 503 means every LLM provider
    failed; the tour service maps it to "translation unavailable, try again" (E1).
    """
    try:
        translations = await translator.translate(request)
    except LLMError as exc:
        logger.error(
            "translate %s->%s failed: %s", request.source_lang, request.target_lang, exc
        )
        raise HTTPException(
            status_code=503, detail="Translation is unavailable, please try again"
        ) from exc
    return TranslateResponse(target_lang=request.target_lang, translations=translations)

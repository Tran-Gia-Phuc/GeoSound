"""Description chunks for the vector index (task #AI-44).

One group of chunks per source text: tour title + description, place name +
description, and each place translation. Every text is sanitised with
`validator.sanitize_text` first (it is untrusted: chatbot-architecture.md
section 7), then cut into chunks of at most `max_chars` with `overlap`
characters shared between neighbours, preferring a whitespace boundary.

Pure functions, no I/O.
"""

from __future__ import annotations

from app.chatbot.rag.models import Chunk, ChunkSource, TourDoc, place_node_id, tour_node_id
from app.moderation.validator import sanitize_text

DEFAULT_MAX_CHARS = 800
DEFAULT_OVERLAP = 100


def split_text(text: str, max_chars: int = DEFAULT_MAX_CHARS, overlap: int = DEFAULT_OVERLAP) -> list[str]:
    """Cut `text` into pieces of at most `max_chars` characters.

    Neighbouring pieces share about `overlap` characters. A piece ends on the
    last whitespace inside the window when there is one in its second half.
    """
    if max_chars <= 0:
        raise ValueError("max_chars must be positive")
    if not 0 <= overlap < max_chars:
        raise ValueError("overlap must be in [0, max_chars)")
    text = " ".join(text.split())  # collapse whitespace runs and newlines
    if not text:
        return []
    pieces: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
            cut = text.rfind(" ", start + max_chars // 2, end)
            if cut > start:
                end = cut
        piece = text[start:end].strip()
        if piece:
            pieces.append(piece)
        if end >= len(text):
            break
        next_start = max(end - overlap, start + 1)
        # Do not start the next piece in the middle of a word.
        space = text.find(" ", next_start, end)
        start = space + 1 if overlap and space != -1 else next_start
    return pieces


def _join(*parts: str) -> str:
    return "\n".join(sanitize_text(p).strip() for p in parts if p and p.strip())


def build_chunks(
    doc: TourDoc, max_chars: int = DEFAULT_MAX_CHARS, overlap: int = DEFAULT_OVERLAP
) -> list[Chunk]:
    """All chunks of one public tour. Ids are deterministic (same doc -> same ids)."""
    chunks: list[Chunk] = []

    def add(node_id: str, lang: str, source: ChunkSource, text: str) -> None:
        for i, piece in enumerate(split_text(text, max_chars, overlap)):
            chunks.append(
                Chunk(
                    id=f"{node_id}#{source}:{lang}:{i}",
                    node_id=node_id,
                    tour_id=doc.tour_id,
                    lang=lang,
                    source=source,
                    text=piece,
                )
            )

    add(tour_node_id(doc.tour_id), doc.language, "description", _join(doc.title, doc.description))
    for place in doc.places:
        node_id = place_node_id(place.place_id)
        add(node_id, doc.language, "description", _join(place.name, place.description))
        seen: set[str] = set()
        for tr in place.translations:
            lang = tr.language.strip().lower()
            if lang in seen:  # one translation per language
                continue
            seen.add(lang)
            add(node_id, lang, "translation", _join(place.name, tr.text))
    return chunks

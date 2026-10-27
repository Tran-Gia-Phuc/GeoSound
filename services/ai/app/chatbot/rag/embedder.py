"""Text embeddings for the chatbot index (task #AI-44).

Decision 6c of docs/02-design/chatbot-architecture.md: a local multilingual
model, `intfloat/multilingual-e5-small`, dimension 384. One model per index;
switching model means a full re-embed (recorded in `ai.index_meta`).

- `FakeEmbedder`: deterministic hashed bag-of-words vectors. Tests only, no I/O.
- `LocalE5Embedder`: the real model. Its runtime is an OPTIONAL dependency that
  is NOT in requirements.txt yet. TODO(#185 follow-up): pick the runtime
  (`sentence-transformers` or an ONNX runtime such as `fastembed`), add it to
  requirements.txt and bake the model into the image so nothing is downloaded
  at request time. Tests never construct it.
"""

from __future__ import annotations

import hashlib
import math
import re
from importlib.util import find_spec
from typing import Protocol, Sequence

E5_MODEL = "intfloat/multilingual-e5-small"
E5_DIMENSION = 384

_TOKEN = re.compile(r"\w+", re.UNICODE)


class Embedder(Protocol):
    model_name: str
    dimension: int

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        """Vectors for index chunks (unit length)."""
        ...

    def embed_query(self, text: str) -> list[float]:
        """Vector for a search text (unit length)."""
        ...


class FakeEmbedder:
    """Deterministic embedder for tests: hashed tokens, L2-normalised.

    Same text -> same vector across runs and processes (sha256, no Python
    hash randomisation). Texts sharing words get a positive cosine similarity.
    """

    model_name = "fake-hash-embedder"

    def __init__(self, dimension: int = E5_DIMENSION) -> None:
        if dimension <= 0:
            raise ValueError("dimension must be positive")
        self.dimension = dimension
        self.calls: list[list[str]] = []

    def _vector(self, text: str) -> list[float]:
        vec = [0.0] * self.dimension
        for token in _TOKEN.findall(text.lower()):
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "big") % self.dimension
            vec[index] += 1.0 if digest[4] & 1 else -1.0
        norm = math.sqrt(sum(v * v for v in vec))
        if norm == 0:
            vec[0] = 1.0
            return vec
        return [v / norm for v in vec]

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        self.calls.append(list(texts))
        return [self._vector(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vector(text)


class LocalE5Embedder:
    """`intfloat/multilingual-e5-small` run locally (no key, no quota).

    E5 expects the prefixes "passage: " for indexed text and "query: " for
    search text. The model is loaded lazily on the first call, never at import.
    Raises NotImplementedError when the optional runtime is not installed.
    """

    model_name = E5_MODEL
    dimension = E5_DIMENSION

    def __init__(self, model_name: str = E5_MODEL) -> None:
        if find_spec("sentence_transformers") is None:
            raise NotImplementedError(
                "LocalE5Embedder needs the optional 'sentence-transformers' runtime, "
                "which is not installed yet (TODO #185 follow-up)"
            )
        self.model_name = model_name
        self._model = None

    def _load(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer  # optional, heavy

            self._model = SentenceTransformer(self.model_name)
        return self._model

    def _encode(self, texts: list[str]) -> list[list[float]]:
        vectors = self._load().encode(texts, normalize_embeddings=True)
        return [list(map(float, v)) for v in vectors]

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return self._encode([f"passage: {t}" for t in texts]) if texts else []

    def embed_query(self, text: str) -> list[float]:
        return self._encode([f"query: {text}"])[0]

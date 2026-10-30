"""Text embeddings for the chatbot index (task #AI-44, runtime #219).

Decision 6c of docs/02-design/chatbot-architecture.md: a local multilingual
model, `intfloat/multilingual-e5-small`, dimension 384. One model per index;
switching model means a full re-embed (recorded in `ai.index_meta`).

- `FakeEmbedder`: deterministic hashed bag-of-words vectors. Tests only, no I/O.
- `LocalE5Embedder`: the real model, run with ONNX Runtime + `tokenizers` (no
  torch). Its runtime is in requirements-embeddings.txt and the model is baked
  into the image at build time under EMBEDDING_CACHE_DIR (Dockerfile); nothing
  is downloaded at runtime. Tests inject a fake backend and never load a model.
- `build_embedder(settings)`: picks one from EMBEDDING_PROVIDER, never silently.
"""

from __future__ import annotations

import hashlib
import math
import os
import re
from importlib.util import find_spec
from typing import TYPE_CHECKING, Callable, Protocol, Sequence

if TYPE_CHECKING:  # pragma: no cover
    from app.config import Settings

E5_MODEL = "intfloat/multilingual-e5-small"
E5_DIMENSION = 384
# Python modules LocalE5Embedder needs at runtime (requirements-embeddings.txt).
RUNTIME_MODULES = ("onnxruntime", "tokenizers", "numpy")
# E5 was trained with at most 512 tokens.
MAX_TOKENS = 512
EMBEDDING_PROVIDERS = ("local", "fake")

# Raw (not yet normalised) vectors for already prefixed texts.
Backend = Callable[[list[str]], list[list[float]]]

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


class EmbedderUnavailableError(NotImplementedError):
    """The local embeddings runtime or model files are missing.

    Subclasses NotImplementedError so existing callers (eval script, chat wiring)
    keep treating it as "embedder not available".
    """


def runtime_installed() -> bool:
    """True when every module of requirements-embeddings.txt can be imported."""
    return all(find_spec(name) is not None for name in RUNTIME_MODULES)


def model_dir(model_name: str, cache_dir: str) -> str:
    """Folder the Dockerfile downloads the model into: <cache_dir>/<org>/<name>."""
    return os.path.join(cache_dir, *model_name.split("/"))


def _l2_normalise(vec: Sequence[float]) -> list[float]:
    norm = math.sqrt(sum(float(v) * float(v) for v in vec))
    if norm == 0:
        raise ValueError("embedding backend returned a zero vector")
    return [float(v) / norm for v in vec]


class _OnnxE5Backend:
    """ONNX Runtime + tokenizers, mean pooling over the attention mask.

    Reads `<model_dir>/onnx/model.onnx` and `<model_dir>/onnx/tokenizer.json`;
    never contacts the Hugging Face hub.
    """

    def __init__(self, path: str) -> None:
        model_file = os.path.join(path, "onnx", "model.onnx")
        tokenizer_file = os.path.join(path, "onnx", "tokenizer.json")
        for f in (model_file, tokenizer_file):
            if not os.path.isfile(f):
                raise EmbedderUnavailableError(
                    f"embeddings model file not found: {f} (it is baked into the image "
                    "by services/ai/Dockerfile; check EMBEDDING_MODEL and EMBEDDING_CACHE_DIR)"
                )
        import numpy as np  # optional runtime, requirements-embeddings.txt
        import onnxruntime as ort
        from tokenizers import Tokenizer

        self._np = np
        self._tokenizer = Tokenizer.from_file(tokenizer_file)
        self._tokenizer.enable_truncation(max_length=MAX_TOKENS)
        pad_id = self._tokenizer.token_to_id("<pad>")
        self._tokenizer.enable_padding(pad_id=1 if pad_id is None else pad_id, pad_token="<pad>")
        options = ort.SessionOptions()
        options.log_severity_level = 3
        self._session = ort.InferenceSession(model_file, sess_options=options,
                                             providers=["CPUExecutionProvider"])
        self._inputs = {i.name for i in self._session.get_inputs()}

    def __call__(self, texts: list[str]) -> list[list[float]]:
        np = self._np
        encodings = self._tokenizer.encode_batch(texts)
        ids = np.array([e.ids for e in encodings], dtype=np.int64)
        mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)
        feed = {"input_ids": ids, "attention_mask": mask, "token_type_ids": np.zeros_like(ids)}
        hidden = self._session.run(None, {k: v for k, v in feed.items() if k in self._inputs})[0]
        weights = mask[..., None].astype(hidden.dtype)
        pooled = (hidden * weights).sum(axis=1) / np.clip(weights.sum(axis=1), 1e-9, None)
        return pooled.tolist()


class LocalE5Embedder:
    """`intfloat/multilingual-e5-small` run locally (no key, no quota).

    E5 expects the prefixes "passage: " for indexed text and "query: " for
    search text. Vectors are L2-normalised. The model is loaded lazily on the
    first call, never at import or construction. Raises EmbedderUnavailableError
    when the optional runtime is not installed (unless a backend is injected).
    Arguments left as None come from the settings (EMBEDDING_MODEL,
    EMBEDDING_CACHE_DIR, EMBEDDING_BATCH_SIZE).
    """

    dimension = E5_DIMENSION

    def __init__(
        self,
        model_name: str | None = None,
        cache_dir: str | None = None,
        batch_size: int | None = None,
        backend: Backend | None = None,
    ) -> None:
        if model_name is None or cache_dir is None or batch_size is None:
            from app.config import get_settings

            settings = get_settings()
            model_name = model_name or settings.embedding_model
            cache_dir = cache_dir or settings.embedding_cache_dir
            batch_size = batch_size or settings.embedding_batch_size
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")
        if backend is None and not runtime_installed():
            raise EmbedderUnavailableError(
                "LocalE5Embedder needs the ONNX runtime of services/ai/requirements-embeddings.txt "
                "(onnxruntime, tokenizers, numpy), which is not installed; "
                "EMBEDDING_PROVIDER=fake is for tests only"
            )
        self.model_name = model_name
        self.cache_dir = cache_dir
        self.batch_size = batch_size
        self._backend = backend

    def _load(self) -> Backend:
        if self._backend is None:
            self._backend = _OnnxE5Backend(model_dir(self.model_name, self.cache_dir))
        return self._backend

    def _encode(self, texts: list[str]) -> list[list[float]]:
        backend = self._load()
        out: list[list[float]] = []
        for i in range(0, len(texts), self.batch_size):
            batch = texts[i:i + self.batch_size]
            vectors = backend(batch)
            if len(vectors) != len(batch):
                raise ValueError("embedding backend returned a wrong number of vectors")
            for v in vectors:
                if len(v) != self.dimension:
                    raise ValueError(
                        f"embedding dimension {len(v)} != {self.dimension} for {self.model_name}"
                    )
                out.append(_l2_normalise(v))
        return out

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return self._encode([f"passage: {t}" for t in texts]) if texts else []

    def embed_query(self, text: str) -> list[float]:
        return self._encode([f"query: {text}"])[0]


def build_embedder(settings: "Settings") -> Embedder:
    """Embedder chosen by EMBEDDING_PROVIDER: `local` (default) or `fake` (tests).

    Never falls back silently: `local` without its runtime raises
    EmbedderUnavailableError; an unknown provider raises ValueError.
    """
    provider = (settings.embedding_provider or "").strip().lower()
    if provider == "fake":
        return FakeEmbedder()
    if provider == "local":
        return LocalE5Embedder(
            model_name=settings.embedding_model,
            cache_dir=settings.embedding_cache_dir,
            batch_size=settings.embedding_batch_size,
        )
    raise ValueError(
        f"unknown EMBEDDING_PROVIDER {settings.embedding_provider!r}; "
        f"expected one of {', '.join(EMBEDDING_PROVIDERS)}"
    )

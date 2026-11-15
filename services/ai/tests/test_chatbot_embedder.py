"""LocalE5Embedder and build_embedder (#219). No model is ever loaded or downloaded:
the ONNX backend is replaced by a fake callable, and the runtime check is monkeypatched."""

import math

import pytest

from app.chatbot.rag import embedder as emb
from app.chatbot.rag.embedder import (
    E5_DIMENSION,
    EmbedderUnavailableError,
    FakeEmbedder,
    LocalE5Embedder,
    build_embedder,
    model_dir,
)
from app.config import Settings


class FakeBackend:
    """Records the prefixed texts it gets; returns non-normalised 384-d vectors."""

    def __init__(self, dimension: int = E5_DIMENSION) -> None:
        self.dimension = dimension
        self.batches: list[list[str]] = []

    def __call__(self, texts: list[str]) -> list[list[float]]:
        self.batches.append(list(texts))
        return [[float(len(t) + i) for i in range(self.dimension)] for t in texts]


def make(backend=None, batch_size: int = 16) -> LocalE5Embedder:
    return LocalE5Embedder(model_name="intfloat/multilingual-e5-small", cache_dir="/models",
                           batch_size=batch_size, backend=backend or FakeBackend())


def settings(**kw) -> Settings:
    return Settings(_env_file=None, **kw)


def is_unit(v: list[float]) -> bool:
    return math.isclose(math.sqrt(sum(x * x for x in v)), 1.0, rel_tol=1e-9)


def test_document_and_query_prefixes():
    backend = FakeBackend()
    e = make(backend)
    e.embed_documents(["Phở Hà Nội", "Old Quarter"])
    e.embed_query("phở ngon")
    assert backend.batches == [["passage: Phở Hà Nội", "passage: Old Quarter"],
                               ["query: phở ngon"]]


def test_vectors_are_normalised_with_dimension_384():
    e = make()
    docs = e.embed_documents(["a", "bb"])
    query = e.embed_query("c")
    assert len(query) == E5_DIMENSION and is_unit(query)
    assert all(len(v) == E5_DIMENSION and is_unit(v) for v in docs)


def test_empty_document_list_does_not_call_the_backend():
    backend = FakeBackend()
    assert make(backend).embed_documents([]) == []
    assert backend.batches == []


def test_batches_respect_batch_size():
    backend = FakeBackend()
    out = make(backend, batch_size=2).embed_documents(["a", "b", "c", "d", "e"])
    assert [len(b) for b in backend.batches] == [2, 2, 1]
    assert len(out) == 5


def test_wrong_dimension_from_backend_is_refused():
    with pytest.raises(ValueError):
        make(FakeBackend(dimension=8)).embed_query("x")


def test_zero_vector_from_backend_is_refused():
    with pytest.raises(ValueError):
        make(lambda texts: [[0.0] * E5_DIMENSION for _ in texts]).embed_query("x")


def test_invalid_batch_size():
    with pytest.raises(ValueError):
        make(batch_size=0)


def test_construction_is_lazy_and_needs_the_runtime(monkeypatch):
    monkeypatch.setattr(emb, "runtime_installed", lambda: False)
    with pytest.raises(EmbedderUnavailableError, match="requirements-embeddings.txt"):
        LocalE5Embedder(model_name="m", cache_dir="/models", batch_size=4)
    # An injected backend does not need the runtime.
    assert make().embed_query("x")


def test_runtime_present_but_model_missing_fails_on_first_use(monkeypatch, tmp_path):
    monkeypatch.setattr(emb, "runtime_installed", lambda: True)
    e = LocalE5Embedder(model_name="org/missing", cache_dir=str(tmp_path), batch_size=4)
    with pytest.raises(EmbedderUnavailableError, match="model file not found"):
        e.embed_query("x")


def test_defaults_come_from_settings(monkeypatch):
    monkeypatch.setattr(emb, "runtime_installed", lambda: True)
    monkeypatch.setattr("app.config.get_settings",
                        lambda: settings(embedding_model="org/name", embedding_cache_dir="/c",
                                         embedding_batch_size=7))
    e = LocalE5Embedder()
    assert (e.model_name, e.cache_dir, e.batch_size) == ("org/name", "/c", 7)


def test_model_dir_layout():
    assert model_dir("intfloat/multilingual-e5-small", "/app/models").replace("\\", "/") == \
        "/app/models/intfloat/multilingual-e5-small"


def test_settings_defaults():
    s = settings()
    assert s.embedding_provider == "local"
    assert s.embedding_model == "intfloat/multilingual-e5-small"
    assert s.embedding_cache_dir == "/app/models"


def test_factory_local_with_runtime(monkeypatch):
    monkeypatch.setattr(emb, "runtime_installed", lambda: True)
    e = build_embedder(settings(embedding_cache_dir="/m", embedding_batch_size=3))
    assert isinstance(e, LocalE5Embedder)
    assert (e.cache_dir, e.batch_size, e.dimension) == ("/m", 3, E5_DIMENSION)


def test_factory_local_without_runtime_raises(monkeypatch):
    monkeypatch.setattr(emb, "runtime_installed", lambda: False)
    with pytest.raises(EmbedderUnavailableError):
        build_embedder(settings(embedding_provider="local"))


def test_factory_fake_only_when_asked(monkeypatch):
    monkeypatch.setattr(emb, "runtime_installed", lambda: False)
    assert isinstance(build_embedder(settings(embedding_provider="fake")), FakeEmbedder)


def test_factory_unknown_provider():
    with pytest.raises(ValueError, match="EMBEDDING_PROVIDER"):
        build_embedder(settings(embedding_provider="gemini"))

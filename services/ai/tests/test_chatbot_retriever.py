"""Hybrid graph + vector retriever (#AI-45, issue #186).

Fixture tours go through the real Indexer into InMemoryIndexStore with the
FakeEmbedder (hashed bag of words): no network, no model download, no LLM.
"""

import asyncio

import pytest

from app.chatbot.graph import rules
from app.chatbot.rag.embedder import FakeEmbedder
from app.chatbot.rag.graph_builder import haversine_m
from app.chatbot.rag.hybrid_retriever import HybridRetriever
from app.chatbot.rag.indexer import OUTCOME_DELETED, OUTCOME_INDEXED, Indexer
from app.chatbot.rag.models import TopicAssignment
from app.chatbot.rag.retriever import Retriever, SearchFilters
from app.chatbot.rag.store import InMemoryIndexStore, PgVectorIndexStore, TourIndexState

R1 = "2026-10-01T00:00:00Z"
R2 = "2026-10-02T00:00:00Z"

COORDS = {
    "p-hn-pho": (21.0340, 105.8500),
    "p-hn-market": (21.0381, 105.8497),
    "p-hn-temple": (21.0307, 105.8524),
    "p-hn-museum": (21.0245, 105.8592),
    "p-hcm-rice": (10.7725, 106.6980),
    "p-hcm-opera": (10.7766, 106.7031),
}


def place(pid, name, description, seq, type_=None):
    lat, lng = COORDS[pid]
    out = {"placeId": pid, "name": name, "description": description, "lat": lat, "lng": lng,
           "sequence": seq}
    if type_:
        out["type"] = type_
    return out


TOURS = {
    "t-hn-food": {
        "title": "Hanoi street food walk",
        "description": "Taste pho and bun cha food stalls in the Old Quarter of Hanoi.",
        "city": "Hà Nội", "type": "walking", "durationMinutes": 120,
        "places": [
            place("p-hn-pho", "Pho Thin stall", "Famous beef pho noodle food stall.", 0, "restaurant"),
            place("p-hn-market", "Dong Xuan market", "Old covered market with food stalls.", 1, "market"),
        ],
    },
    "t-hn-history": {
        "title": "Hanoi history walk",
        "description": "Temples, pagodas and the history of the Old Quarter in Hanoi.",
        "city": "Hanoi", "type": "walking", "durationMinutes": 90,
        "places": [
            place("p-hn-temple", "Ngoc Son temple", "Temple on Hoan Kiem lake, built in the 19th century.", 0,
                  "temple"),
            place("p-hn-museum", "National history museum", "Museum of Vietnamese history.", 1, "museum"),
        ],
    },
    "t-hcm-food": {
        "title": "Saigon street food tour",
        "description": "Taste broken rice food stalls near Ben Thanh in Saigon.",
        "city": "Hồ Chí Minh", "type": "cycling", "durationMinutes": 180,
        "places": [
            place("p-hcm-rice", "Broken rice stall", "Com tam food stall.", 0, "restaurant"),
            place("p-hcm-opera", "Saigon Opera House", "French colonial theatre.", 1, "theatre"),
        ],
    },
}

TOPICS = {
    "t-hn-food": TopicAssignment(tour=("food",), places={"p-hn-pho": ("food",), "p-hn-market": ("shopping",)}),
    "t-hn-history": TopicAssignment(tour=("history", "religion"),
                                    places={"p-hn-temple": ("religion",), "p-hn-museum": ("history",)}),
    "t-hcm-food": TopicAssignment(tour=("food",), places={"p-hcm-rice": ("food",)}),
}


class FakeTopics:
    async def extract(self, doc):
        return TOPICS.get(doc.tour_id)


def payload(tour_id, revision=R1, **over):
    body = {"tourId": tour_id, "revision": revision, "status": "public", "language": "en", **TOURS[tour_id]}
    body.update(over)
    return body


def run(coro):
    return asyncio.run(coro)


def build(tour_ids=tuple(TOURS)):
    store = InMemoryIndexStore(dimension=384)
    embedder = FakeEmbedder()
    indexer = Indexer(store, embedder, FakeTopics())
    for tid in tour_ids:
        assert run(indexer.handle_published(payload(tid))) == OUTCOME_INDEXED
    return HybridRetriever(store, embedder), indexer, store


@pytest.fixture
def index():
    return build()


def tour_ids(hits):
    return [h.tour_id for h in hits]


def place_ids(hits):
    return [h.place_id for h in hits]


# ---------- port and construction ----------

def test_implements_retriever_port(index):
    retriever, _, _ = index
    assert isinstance(retriever, Retriever)


def test_dimension_mismatch_rejected():
    with pytest.raises(ValueError):
        HybridRetriever(InMemoryIndexStore(dimension=8), FakeEmbedder(dimension=16))


def test_empty_index_returns_nothing():
    retriever = HybridRetriever(InMemoryIndexStore(dimension=384), FakeEmbedder())
    assert run(retriever.search_tours("food tour", SearchFilters())) == []
    assert run(retriever.search_places("market", SearchFilters())) == []
    assert run(retriever.nearby_places(lat=21.03, lng=105.85)) == []
    assert run(retriever.nearby_places(place_id="p-hn-pho")) == []


def test_blank_query_returns_nothing(index):
    retriever, _, _ = index
    assert run(retriever.search_tours("   ", SearchFilters())) == []


# ---------- multi-constraint search (acceptance criterion 1) ----------

def test_area_plus_topic_ranks_the_matching_tour_first(index):
    retriever, _, _ = index
    query = "food tour in Hanoi"
    filters = SearchFilters(city=rules.find_city(query), topics=("food",))
    assert filters.city == "Hanoi"

    hits = run(retriever.search_tours(query, filters))
    ids = tour_ids(hits)
    assert ids[0] == "t-hn-food"
    assert "t-hn-history" in ids and ids.index("t-hn-food") < ids.index("t-hn-history")
    # The HCMC food tour is outside the requested area.
    assert "t-hcm-food" not in ids
    assert hits[0].score > hits[1].score
    assert hits[0].city == "Hà Nội" and hits[0].title == "Hanoi street food walk"
    assert hits[0].snippet


def test_topic_without_area_ranks_food_tours_above_history(index):
    retriever, _, _ = index
    ids = tour_ids(run(retriever.search_tours("food tour", SearchFilters(topics=("food",)))))
    assert set(ids[:2]) == {"t-hn-food", "t-hcm-food"}
    assert ids.index("t-hn-history") > 1


def test_city_aliases_match_canonical_names(index):
    retriever, _, _ = index
    for city in ("Ho Chi Minh City", "Saigon", "hcmc"):
        ids = tour_ids(run(retriever.search_tours("street food", SearchFilters(city=city))))
        assert ids == ["t-hcm-food"], city


def test_type_and_duration_are_hard_filters(index):
    retriever, _, _ = index
    walking = tour_ids(run(retriever.search_tours("street food tour", SearchFilters(type="walking"))))
    assert "t-hcm-food" not in walking and "t-hn-food" in walking
    short = tour_ids(run(retriever.search_tours("walk", SearchFilters(max_duration_minutes=100))))
    assert short == ["t-hn-history"]


def test_search_places_with_area_and_topic(index):
    retriever, _, _ = index
    hits = run(retriever.search_places("food stall", SearchFilters(city="Hanoi", topics=("food",))))
    ids = place_ids(hits)
    assert ids[0] == "p-hn-pho"
    assert all(h.tour_id in {"t-hn-food", "t-hn-history"} for h in hits)
    assert "p-hcm-rice" not in ids
    assert hits[0].tour_id == "t-hn-food" and hits[0].type == "restaurant"


def test_place_type_filter(index):
    retriever, _, _ = index
    hits = run(retriever.search_places("food", SearchFilters(place_type="Market")))
    assert place_ids(hits) == ["p-hn-market"]


def test_hops_reported_for_graph_expansion(index):
    retriever, _, _ = index
    # Only the place text mentions Dong Xuan: the tour is found through has_stop.
    hits = run(retriever.search_tours("Dong Xuan", SearchFilters()))
    assert hits[0].tour_id == "t-hn-food" and hits[0].hops == 1
    places = run(retriever.search_places("Dong Xuan", SearchFilters()))
    assert places[0].place_id == "p-hn-market" and places[0].hops == 0
    # Graph expansion adds places that share no word with the query.
    assert any(h.hops > 0 for h in places)


def test_k_respected(index):
    retriever, _, _ = index
    assert len(run(retriever.search_tours("tour walk food history", SearchFilters(), k=1))) == 1
    assert len(run(retriever.search_places("stall market temple", SearchFilters(), k=2))) == 2
    assert len(run(retriever.search_places("stall", SearchFilters(), k=50))) <= 10


def test_other_cities_do_not_crowd_out_the_filtered_city():
    # 30 HCMC tours whose text equals the query (60 chunks with similarity ~1)
    # against one weaker Hanoi tour; no topics, so no graph path leads to it.
    store = InMemoryIndexStore(dimension=384)
    embedder = FakeEmbedder()
    indexer = Indexer(store, embedder)
    for i in range(30):
        body = {
            "tourId": f"t-crowd-{i}", "revision": R1, "status": "public", "language": "en",
            "title": "street food", "description": "street food", "city": "Saigon", "type": "walking",
            "places": [{"placeId": f"p-crowd-{i}", "name": "street food", "description": "street food",
                        "lat": 10.70 + i * 0.01, "lng": 106.60, "sequence": 0}],
        }
        assert run(indexer.handle_published(body)) == OUTCOME_INDEXED
    hanoi = {
        "tourId": "t-hn", "revision": R1, "status": "public", "language": "en",
        "title": "Hanoi evening walk", "description": "A lake walk with some street food on the way.",
        "city": "Hà Nội", "type": "walking",
        "places": [{"placeId": "p-hn-lake", "name": "Hoan Kiem lake", "description": "Quiet lake.",
                    "lat": 21.0287, "lng": 105.8524, "sequence": 0}],
    }
    assert run(indexer.handle_published(hanoi)) == OUTCOME_INDEXED

    retriever = HybridRetriever(store, embedder)  # k_seed = 20
    unfiltered = run(store.vector_search(embedder.embed_query("street food"), 20))
    assert all(s.chunk.tour_id != "t-hn" for s in unfiltered)  # the crowd really fills the top 20

    assert tour_ids(run(retriever.search_tours("street food", SearchFilters(city="Hanoi")))) == ["t-hn"]
    places = run(retriever.search_places("street food", SearchFilters(city="Hanoi")))
    assert places and {h.tour_id for h in places} == {"t-hn"}


def test_store_vector_search_filters_before_top_k(index):
    _, _, store = index
    vector = FakeEmbedder().embed_query("food stall walk")
    hanoi = run(store.vector_search(vector, 3, city_keys={"hanoi", "ha-noi"}))
    assert len(hanoi) == 3 and all(s.chunk.tour_id.startswith("t-hn-") for s in hanoi)
    cycling = run(store.vector_search(vector, 10, tour_type="cycling"))
    assert cycling and {s.chunk.tour_id for s in cycling} == {"t-hcm-food"}
    short = run(store.vector_search(vector, 10, max_duration_minutes=100))
    assert short and {s.chunk.tour_id for s in short} == {"t-hn-history"}
    markets = run(store.vector_search(vector, 10, kinds=("place",), place_type="Market"))
    assert [s.chunk.node_id for s in markets] == ["place:p-hn-market"]
    store.tours["t-hn-food"] = TourIndexState(None, "deleted")
    assert all(s.chunk.tour_id != "t-hn-food" for s in run(store.vector_search(vector, 50)))


def test_store_get_revisions_batch(index):
    _, indexer, store = index
    run(indexer.handle_unpublished({"tourId": "t-hcm-food", "revision": R2, "reason": "deleted"}))
    states = run(store.get_revisions(["t-hn-food", "t-hcm-food", "t-unknown"]))
    assert set(states) == {"t-hn-food", "t-hcm-food"}
    assert states["t-hn-food"].state == "indexed" and states["t-hcm-food"].state == "deleted"


# ---------- nearby ----------

def test_nearby_by_coordinate_sorted_and_within_radius(index):
    retriever, _, _ = index
    point = (21.0287, 105.8524)  # Hoan Kiem lake
    radius = 700
    hits = run(retriever.nearby_places(lat=point[0], lng=point[1], radius_m=radius, k=10))
    expected = sorted(
        (haversine_m(*point, *xy), pid) for pid, xy in COORDS.items() if haversine_m(*point, *xy) <= radius
    )
    assert place_ids(hits) == [pid for _, pid in expected]
    assert len(hits) < len(COORDS)  # the radius cuts some places off
    distances = [h.distance_m for h in hits]
    assert distances == sorted(distances) and all(d <= radius for d in distances)
    assert all(h.hops == 0 for h in hits)


def test_nearby_by_place_id_excludes_anchor(index):
    retriever, _, _ = index
    radius = 800
    anchor = COORDS["p-hn-temple"]
    hits = run(retriever.nearby_places(place_id="p-hn-temple", radius_m=radius, k=10))
    expected = sorted(
        (haversine_m(*anchor, *xy), pid)
        for pid, xy in COORDS.items()
        if pid != "p-hn-temple" and haversine_m(*anchor, *xy) <= radius
    )
    assert place_ids(hits) == [pid for _, pid in expected] and expected
    assert "p-hn-temple" not in place_ids(hits)
    assert all(h.hops == 1 and h.distance_m <= radius for h in hits)
    assert hits[0].city in {"Hà Nội", "Hanoi"} and hits[0].snippet


def test_nearby_k_and_unknown_anchor(index):
    retriever, _, _ = index
    assert len(run(retriever.nearby_places(place_id="p-hn-temple", radius_m=1000, k=1))) == 1
    assert run(retriever.nearby_places(place_id="p-unknown")) == []
    assert run(retriever.nearby_places(place_id="t-hn-food")) == []


# ---------- public data only (acceptance criterion 2) ----------

def _everything(retriever):
    tours = run(retriever.search_tours("Hanoi street food walk history", SearchFilters(), k=10))
    places = run(retriever.search_places("pho market temple museum stall", SearchFilters(), k=10))
    near = run(retriever.nearby_places(lat=21.0307, lng=105.8524, radius_m=1000, k=10))
    return tours, places, near


def test_unpublished_tour_never_returned(index):
    retriever, indexer, _ = index
    tours, places, near = _everything(retriever)
    assert "t-hn-food" in tour_ids(tours)
    assert "p-hn-pho" in place_ids(places) + place_ids(near)

    outcome = run(indexer.handle_unpublished({"tourId": "t-hn-food", "revision": R2, "reason": "unpublished"}))
    assert outcome == OUTCOME_DELETED

    tours, places, near = _everything(retriever)
    assert "t-hn-food" not in tour_ids(tours)
    assert all(h.tour_id != "t-hn-food" for h in places + near)
    assert run(retriever.nearby_places(place_id="p-hn-pho")) == []


def test_not_public_status_never_returned(index):
    retriever, indexer, _ = index
    run(indexer.handle_published(payload("t-hn-history", revision=R2, status="hidden")))
    tours, places, near = _everything(retriever)
    assert "t-hn-history" not in tour_ids(tours)
    assert all(h.tour_id != "t-hn-history" for h in places + near)


def test_tombstone_respected_even_with_leftover_rows(index):
    retriever, _, store = index
    # Simulate rows left behind by a failed delete: the tombstone alone must hide them.
    store.tours["t-hn-history"] = TourIndexState(None, "deleted")
    tours, places, near = _everything(retriever)
    assert "t-hn-history" not in tour_ids(tours)
    assert all(h.tour_id != "t-hn-history" for h in places + near)
    assert run(retriever.nearby_places(place_id="p-hn-temple")) == []
    assert "p-hn-temple" in {n.removeprefix("place:") for n in store.nodes}  # rows really are there


# ---------- city aliases from City nodes ----------

def test_city_aliases_from_index_keeps_canonical_names():
    store = InMemoryIndexStore(dimension=384)
    embedder = FakeEmbedder()
    indexer = Indexer(store, embedder)
    run(indexer.handle_published(payload("t-hn-food")))
    run(indexer.handle_published(payload("t-hcm-food", city="Quy Nhơn")))
    table = run(HybridRetriever(store, embedder).city_aliases_from_index())
    assert table["hà nội"] == "Hanoi"
    assert table["quy nhơn"] == "Quy Nhơn"
    assert rules.find_city("street food in quy nhon", table) == "Quy Nhơn"
    retriever = HybridRetriever(store, embedder, city_aliases=table)
    ids = tour_ids(run(retriever.search_tours("street food", SearchFilters(city="Quy Nhơn"))))
    assert ids == ["t-hcm-food"]


def test_pg_store_read_methods_are_todo():
    for name in ("get_revisions", "vector_search", "get_nodes", "get_chunks", "list_nodes", "neighbours",
                 "places_near"):
        assert "TODO(#219)" in getattr(PgVectorIndexStore, name).__doc__


# ---------- end to end with the chat agent ----------

def test_chat_agent_cites_real_indexed_ids(index, monkeypatch):
    pytest.importorskip("langgraph")
    from langchain_core.messages import AIMessage
    from langgraph.checkpoint.memory import MemorySaver

    from app.chatbot import models as chat_models
    from app.chatbot.agent import ChatAgent

    def boom(*args, **kwargs):
        raise AssertionError("build_chat_model must not be called in tests")

    monkeypatch.setattr(chat_models, "build_chat_model", boom)

    class FakeChatModel:
        def __init__(self):
            self.calls = []

        async def ainvoke(self, messages, *args, **kwargs):
            self.calls.append(list(messages))
            return AIMessage(content="Try [tour:t-hn-food] with [place:p-hn-pho]. Also [tour:t-invented].")

    retriever, _, _ = index
    model = FakeChatModel()
    agent = ChatAgent(retriever=retriever, model=model, checkpointer=MemorySaver())
    result = asyncio.run(agent.run("s1", "food tour in Hanoi"))

    assert result["intent"] == "search" and result["llm_calls"] == 1
    assert result["tools_called"] == ["search_tours", "search_places"]
    prompt = model.calls[0][-1].content
    assert "t-hn-food" in prompt and "t-hcm-food" not in prompt
    assert [(c["kind"], c["id"]) for c in result["citations"]] == [("tour", "t-hn-food"), ("place", "p-hn-pho")]
    assert result["citations"][0]["title"] == "Hanoi street food walk"
    assert "t-invented" not in result["answer"]

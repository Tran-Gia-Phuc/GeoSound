"""PgVectorIndexStore (issue #219).

Unit tests (always run): URL cleaning, vector text format, lazy construction. No network.

Integration tests: run only when `AI_TEST_DATABASE_URL` points at a DISPOSABLE Postgres with
pgvector in schema `extensions` and schema `ai` pushed (prisma/pre-push.sql, schema.prisma,
post-push.sql). They index the fixture tours of test_chatbot_retriever.py into both the
pgvector store and InMemoryIndexStore and check that every read returns the same result.
They delete the rows of the fixture tours (ids `t-hn-*`, `t-hcm-*`) before and after each test.
Never point this at the shared Supabase database.
"""

import asyncio
import os

import pytest

from app.chatbot.rag.embedder import FakeEmbedder
from app.chatbot.rag.graph_builder import BBox
from app.chatbot.rag.hybrid_retriever import HybridRetriever
from app.chatbot.rag.indexer import OUTCOME_DELETED, OUTCOME_INDEXED, Indexer
from app.chatbot.rag.models import parse_revision
from app.chatbot.rag.retriever import SearchFilters
from app.chatbot.rag.store import (
    InMemoryIndexStore,
    IndexMetaMismatch,
    PgVectorIndexStore,
    clean_dsn,
    decode_vector,
    encode_vector,
)
from test_chatbot_retriever import R1, R2, TOURS, FakeTopics, payload

TEST_DB_URL = os.environ.get("AI_TEST_DATABASE_URL", "")
needs_db = pytest.mark.skipif(not TEST_DB_URL, reason="AI_TEST_DATABASE_URL not set (pgvector integration)")


# ---------- unit: no database ----------

def test_clean_dsn_drops_prisma_only_keys():
    url = ("postgresql://u:p@db.example.com:6543/postgres"
           "?pgbouncer=true&schema=ai&connection_limit=1&sslmode=require&pool_timeout=10")
    assert clean_dsn(url) == "postgresql://u:p@db.example.com:6543/postgres?sslmode=require"
    assert clean_dsn("postgres://u@h/db") == "postgres://u@h/db"
    assert clean_dsn("  postgresql://u@h/db?schema=ai  ") == "postgresql://u@h/db"


@pytest.mark.parametrize("url", ["", "   ", "mysql://u@h/db", "http://h/db"])
def test_clean_dsn_refuses_bad_urls(url):
    with pytest.raises(ValueError):
        clean_dsn(url)


def test_vector_text_round_trip():
    values = [0.0, -1.5, 0.125, 1e-7, 3.0]
    text = encode_vector(values)
    assert text == "[0.0,-1.5,0.125,1e-07,3.0]"
    assert decode_vector(text) == values
    assert decode_vector(" [ 1, 2 ] ") == [1.0, 2.0]
    assert decode_vector("[]") == []
    assert encode_vector([]) == "[]"


@pytest.mark.parametrize("bad", [[float("nan")], [float("inf")], [1.0, float("-inf")]])
def test_encode_vector_refuses_non_finite(bad):
    with pytest.raises(ValueError):
        encode_vector(bad)


def test_decode_vector_refuses_non_vector_text():
    with pytest.raises(ValueError):
        decode_vector("1,2,3")


def test_constructor_validates_without_connecting():
    with pytest.raises(ValueError):
        PgVectorIndexStore("postgresql://u@h/db", 0)
    with pytest.raises(ValueError):
        PgVectorIndexStore("", 384)
    store = PgVectorIndexStore("postgresql://user:secret@h/db?schema=ai", 384)
    assert "secret" not in repr(store) and store._pool is None


def test_dimension_checked_before_any_connection():
    store = PgVectorIndexStore("postgresql://u@unreachable.invalid/db", 384)

    async def scenario():
        assert await store.vector_search([0.1] * 384, 0) == []
        with pytest.raises(ValueError):
            await store.vector_search([0.1] * 8, 3)
        with pytest.raises(ValueError):
            await store.upsert_tour(None, [], [], [object()], [], parse_revision(R1))
        with pytest.raises(ValueError):
            await store.upsert_tour(None, [], [], [object()], [[0.1] * 8], parse_revision(R1))

    asyncio.run(scenario())
    assert store._pool is None


def test_index_meta_mismatch_is_a_value_error():
    assert issubclass(IndexMetaMismatch, ValueError)


# ---------- integration: disposable pgvector database ----------

FIXTURE_TOURS = tuple(TOURS)


async def _reset(store: PgVectorIndexStore) -> None:
    pool = await store._get_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("DELETE FROM ai.chunks WHERE tour_id = ANY($1::text[])", list(FIXTURE_TOURS))
        await conn.execute(
            "DELETE FROM ai.edges e USING ai.nodes n WHERE n.tour_id = ANY($1::text[]) "
            "AND (e.src = n.id OR e.dst = n.id)",
            list(FIXTURE_TOURS),
        )
        await conn.execute("DELETE FROM ai.nodes WHERE tour_id = ANY($1::text[])", list(FIXTURE_TOURS))
        await conn.execute(
            "DELETE FROM ai.nodes n WHERE n.tour_id IS NULL AND NOT EXISTS "
            "(SELECT 1 FROM ai.edges e WHERE e.src = n.id OR e.dst = n.id)"
        )
        await conn.execute("DELETE FROM ai.tour_index WHERE tour_id = ANY($1::text[])", list(FIXTURE_TOURS))


def with_both(scenario):
    """Run `scenario(pg, mem, pg_indexer, mem_indexer)` with the fixture tours indexed in both stores."""

    async def main():
        pg = PgVectorIndexStore(TEST_DB_URL, 384)
        try:
            await _reset(pg)
            mem = InMemoryIndexStore(dimension=384)
            pg_indexer = Indexer(pg, FakeEmbedder(), FakeTopics())
            mem_indexer = Indexer(mem, FakeEmbedder(), FakeTopics())
            for tid in FIXTURE_TOURS:
                assert await pg_indexer.handle_published(payload(tid)) == OUTCOME_INDEXED
                assert await mem_indexer.handle_published(payload(tid)) == OUTCOME_INDEXED
            await scenario(pg, mem, pg_indexer, mem_indexer)
        finally:
            try:
                await _reset(pg)
            finally:
                await pg.aclose()

    asyncio.run(main())


def _same_search(pg_hits, mem_hits):
    assert {s.chunk.id for s in pg_hits} == {s.chunk.id for s in mem_hits}
    mem_scores = {s.chunk.id: s.score for s in mem_hits}
    for hit in pg_hits:  # pgvector stores float32
        assert hit.score == pytest.approx(mem_scores[hit.chunk.id], abs=1e-4)
    scores = [s.score for s in pg_hits]
    assert scores == sorted(scores, reverse=True)


@needs_db
def test_pg_reads_match_in_memory():
    async def scenario(pg, mem, *_):
        for kind in ("tour", "place", "city", "type", "topic"):
            assert await pg.list_nodes(kind) == await mem.list_nodes(kind)
        ids = list(mem.nodes) + ["place:unknown"]
        assert await pg.get_nodes(ids) == await mem.get_nodes(ids)
        assert await pg.get_chunks(ids) == await mem.get_chunks(ids)
        tours = list(FIXTURE_TOURS) + ["t-unknown"]
        assert await pg.get_revisions(tours) == await mem.get_revisions(tours)
        assert await pg.get_revision("t-hn-food") == await mem.get_revision("t-hn-food")
        seeds = ["tour:t-hn-food", "place:p-hn-temple", "city:hanoi"]
        for kinds, hops in ((("has", "has_stop", "is_a", "near", "about"), 2), (("about",), 1)):
            pg_reach = await pg.neighbours(seeds, kinds, hops)
            mem_reach = await mem.neighbours(seeds, kinds, hops)
            assert set(pg_reach) == set(mem_reach) and len(pg_reach) == len(mem_reach)
        assert await pg.neighbours(seeds, ("has",), 0) == []
        assert await pg.places_near(21.0287, 105.8524, 700) == await mem.places_near(21.0287, 105.8524, 700)
        box = BBox(10.0, 22.0, 105.0, 107.0)
        pg_box = await pg.places_in_bbox(box, "t-hn-food")
        mem_box = await mem.places_in_bbox(box, "t-hn-food")
        assert sorted(pg_box, key=lambda p: p.place_id) == sorted(mem_box, key=lambda p: p.place_id)

    with_both(scenario)


@needs_db
def test_pg_vector_search_filters_match_in_memory():
    async def scenario(pg, mem, *_):
        vector = FakeEmbedder().embed_query("food stall walk")
        cases = [
            dict(),
            dict(city_keys={"hanoi", "ha-noi"}),
            dict(city_keys=set()),
            dict(tour_type="cycling"),
            dict(max_duration_minutes=100),
            dict(kinds=("place",), place_type="Market"),
            dict(kinds=("tour",)),
            dict(place_type="Đền"),
        ]
        for k in (3, 50):
            for filters in cases:
                _same_search(await pg.vector_search(vector, k, **filters),
                             await mem.vector_search(vector, k, **filters))
        hanoi = await pg.vector_search(vector, 3, city_keys={"hanoi", "ha-noi"})
        assert len(hanoi) == 3 and all(s.chunk.tour_id.startswith("t-hn-") for s in hanoi)
        markets = await pg.vector_search(vector, 10, kinds=("place",), place_type="Market")
        assert [s.chunk.node_id for s in markets] == ["place:p-hn-market"]

        # Tombstone with rows left behind: the state alone hides the tour.
        pool = await pg._get_pool()
        await pool.execute("UPDATE ai.tour_index SET state = 'deleted' WHERE tour_id = 't-hn-food'")
        assert all(s.chunk.tour_id != "t-hn-food" for s in await pg.vector_search(vector, 50))

    with_both(scenario)


@needs_db
def test_pg_revision_rules_and_unpublish():
    async def scenario(pg, mem, pg_indexer, mem_indexer):
        # Same or older revision: nothing written.
        assert await pg_indexer.handle_published(payload("t-hn-food")) != OUTCOME_INDEXED
        assert (await pg.get_revision("t-hn-food")).revision == parse_revision(R1)
        # Newer revision replaces the tour.
        assert await pg_indexer.handle_published(payload("t-hn-food", revision=R2)) == OUTCOME_INDEXED
        assert (await pg.get_revision("t-hn-food")).revision == parse_revision(R2)
        assert await mem_indexer.handle_published(payload("t-hn-food", revision=R2)) == OUTCOME_INDEXED

        # Unpublish: rows gone, tombstone kept, orphan shared nodes removed.
        event = {"tourId": "t-hcm-food", "revision": R2, "reason": "unpublished"}
        assert await pg_indexer.handle_unpublished(event) == OUTCOME_DELETED
        assert await mem_indexer.handle_unpublished(event) == OUTCOME_DELETED
        state = await pg.get_revision("t-hcm-food")
        assert state.state == "deleted" and state.revision == parse_revision(R2)
        assert await pg.get_nodes(["tour:t-hcm-food", "place:p-hcm-rice"]) == {}
        assert await pg.get_chunks(["tour:t-hcm-food", "place:p-hcm-rice"]) == []
        for kind in ("city", "type", "topic", "place"):
            assert await pg.list_nodes(kind) == await mem.list_nodes(kind)
        # A late, older publish cannot bring the tour back.
        assert await pg_indexer.handle_published(payload("t-hcm-food")) != OUTCOME_INDEXED
        assert await pg.get_nodes(["tour:t-hcm-food"]) == {}
        # Deleting again keeps the tombstone and reports nothing removed.
        assert await pg.delete_tour("t-hcm-food") is False

    with_both(scenario)


@needs_db
def test_pg_hybrid_retriever_matches_in_memory():
    async def scenario(pg, mem, *_):
        pg_r, mem_r = HybridRetriever(pg, FakeEmbedder()), HybridRetriever(mem, FakeEmbedder())
        for query, filters in (("street food", SearchFilters(city="Hanoi")), ("history temple", SearchFilters())):
            pg_tours = await pg_r.search_tours(query, filters, k=5)
            mem_tours = await mem_r.search_tours(query, filters, k=5)
            assert [h.tour_id for h in pg_tours] == [h.tour_id for h in mem_tours]
        pg_near = await pg_r.nearby_places(place_id="p-hn-temple", radius_m=800, k=10)
        mem_near = await mem_r.nearby_places(place_id="p-hn-temple", radius_m=800, k=10)
        assert [h.place_id for h in pg_near] == [h.place_id for h in mem_near]

    with_both(scenario)

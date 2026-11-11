"""Print the tour ids the chatbot index holds, one per line (issue #341). Read only.

The Tour service pipes this list into `node prisma/sync-chatbot-index.js --prune`,
which sends tour.unpublished for every id that is no longer a public tour, so the
indexer removes it the normal way (docs/04-guides/seed-data.md):

    python -m app.chatbot.rag.list_index

Never prints the database url.
"""

from __future__ import annotations

import asyncio

from app.chatbot.rag.store import clean_dsn
from app.config import get_settings

LIST_SQL = "SELECT tour_id FROM ai.tour_index WHERE state = 'indexed' ORDER BY tour_id"


async def list_indexed(dsn: str) -> list[str]:
    import asyncpg  # lazy, like PgVectorIndexStore

    # statement_cache_size=0: the url may go through the Supabase transaction pooler.
    conn = await asyncpg.connect(dsn=clean_dsn(dsn), statement_cache_size=0)
    try:
        return [row["tour_id"] for row in await conn.fetch(LIST_SQL)]
    finally:
        await conn.close()


def main() -> None:
    dsn = get_settings().database_url_ai
    if not (dsn or "").strip():
        raise SystemExit("DATABASE_URL_AI is not set: there is no chatbot index")
    for tour_id in asyncio.run(list_indexed(dsn)):
        print(tour_id)


if __name__ == "__main__":
    main()

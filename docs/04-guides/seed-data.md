# Seed data and the chatbot index

Issue #341. The chatbot (UC24) answers from its own index in schema `ai`, fed only by the
`tour.published` / `tour.unpublished` events of the Tour service. Rows written straight into
schema `tour` (a seed, a reset, a manual SQL fix) send no event, so the index keeps old tour ids
and misses the new ones. The chatbot then cites tours that Tour no longer has: the citation link
opens `/tour/<old id>` and the page answers "Tour không còn khả dụng" (`GET /api/tours/<id>` = 404).

Run the steps below after every reseed. They need the stack up (`docker compose up -d`) with
`CHATBOT_EVENTS_ENABLED=true` (Tour) and `CHATBOT_INDEXER_ENABLED=true` (AI). The scripts are
mounted from the working tree, so no image rebuild is needed for them.

## 1. Add the demo tours (optional)

`services/tour/prisma/seed-tours.js` adds 7 public tours (Hà Nội, Hồ Chí Minh, Ninh Bình, Cần Thơ,
Hạ Long, Hội An; types walking, cycling, driving, indoor) with places, route triggers and the
source language `vi`. Ids are fixed (`5eed00NN-...`) and written with upsert: running it again
updates the same rows. The author is `SEED_AUTHOR_ID`, else the author of the oldest public tour.
It writes to the database of `DATABASE_URL_TOUR` (Supabase in the normal setup).

```bash
MSYS_NO_PATHCONV=1 docker compose run --rm --no-deps -v ./services/tour/prisma:/app/prisma \
  tour node prisma/seed-tours.js
```

## 1b. Add ratings (optional)

`services/tour/prisma/seed-ratings.js` writes 8 to 30 `tour_ratings` rows (UC05) for every public
tour, from 30 fixed fake reviewers (`5eedfa11-...`), then recomputes `tours.rating_count` and
`average_rating` from the rows (raw SQL, `updated_at` does not move). It ends with a self-check
that every count equals its rows. Never write `rating_count` / `average_rating` by hand: the star
bars count the rows, so a count without rows shows "87 ratings" with every bar at 0.

```bash
MSYS_NO_PATHCONV=1 docker compose run --rm --no-deps -T -v ./services/tour/prisma:/app/prisma \
  tour node prisma/seed-ratings.js
```

## 2. Bring the chatbot index in line with Tour

```bash
# Tour ids the index holds (read only), one per line
MSYS_NO_PATHCONV=1 docker compose run --rm --no-deps -T \
  -v ./services/ai/app/chatbot/rag/list_index.py:/app/app/chatbot/rag/list_index.py \
  ai python -m app.chatbot.rag.list_index > indexed.txt

# tour.published for every public tour + tour.unpublished for each listed id that is not public
MSYS_NO_PATHCONV=1 docker compose run --rm --no-deps -T -v ./services/tour/prisma:/app/prisma \
  tour node prisma/sync-chatbot-index.js --prune < indexed.txt
```

Without `--prune` the sync only re-sends `tour.published` (nothing is removed). The indexer
handles the events like any other publish; check that the queue is empty:

```bash
docker compose exec rabbitmq rabbitmqctl list_queues name messages consumers | grep chatbot
# ai.chatbot-indexer   0   1
```

`consumers` must be 1. With 0, the AI indexer is not running: see `docker compose logs ai`.
Since #341 it retries the first RabbitMQ connection 10 times, 3 s apart, so an AI container that
starts while RabbitMQ boots still starts its indexer.

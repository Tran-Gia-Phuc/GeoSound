# ERD and data flow diagrams (draw.io)

| File | Content |
|---|---|
| [`../erd-geosound.xml`](../erd-geosound.xml) | ERD with **every table of the database (75)**, built from a structure snapshot of Supabase ([`../erd/supabase-schema.json`](../erd/supabase-schema.json)). Page 1: the 34 GeoSound tables, one dashed frame per schema (app_auth, tour, notification, moderation, media, ai, ai_chat). Page 2: the 41 tables of the Supabase platform schemas (auth, storage, realtime, vault), not used by GeoSound. Solid crow's-foot lines are foreign keys; dashed grey lines are soft references between services. Details in [`../../database-tables.md`](../../database-tables.md). |
| [`../dfd-level-0.xml`](../dfd-level-0.xml) | DFD level 0 (context diagram): the system as one process with its six external entities. |
| [`../dfd-level-1.xml`](../dfd-level-1.xml) | DFD level 1: processes 1.0 to 9.0 with data stores D1 to D12. Each store lists the real tables it stands for; the script checks that the stores cover the 34 GeoSound tables of the database exactly once (Supabase platform tables are not part of the system). Entities marked `*` are drawn twice to avoid long crossing lines. |
| [`../dfd-level-2.xml`](../dfd-level-2.xml) | DFD level 2, **nine pages, one per level-1 process** (tabs at the bottom in draw.io): 1.0 accounts, 2.0 find and listen, 3.0 itineraries, 4.0 tour content, 5.0 AI moderation, 6.0 admin, 7.0 ratings and statistics, 8.0 notifications, 9.0 AI assistant. Dashed grey circles are level-1 processes shown for context. |

Notation (Yourdon/DeMarco): rectangle = external entity, circle = process, open rectangle = data store,
arrow = data flow. Two opposite flows between the same pair are bowed apart, each label near its source.

Processes of level 1 and the use cases they cover: 1.0 accounts and sessions (UC01, UC18, UC23),
2.0 find, view, listen and download tours (UC02 to UC04), 3.0 itineraries (UC07, UC08), 4.0 tour content
(UC09 to UC14), 5.0 AI moderation (UC15), 6.0 admin review, violations and monitoring (UC19 to UC22),
7.0 ratings, reports and statistics (UC05, UC06, UC17), 8.0 notifications (UC16), 9.0 AI assistant (UC24).

Data stores: D1 accounts, sessions, follows (`auth`); D2 OTP and revoked sessions (Redis); D3 tours, places,
routes, translations, forbidden zones, access grants (`tour`); D4 media files; D5 itineraries; D6 ratings,
reports, statistics; D7 admin log; D8 moderation cases (`moderation`); D9 in-app notifications
(`notification`); D10 chatbot knowledge index (`ai`); D11 chat history (`ai_chat`); D12 offline packages on
the device (IndexedDB).

Regenerate after a change (the DFD script refuses overlapping nodes and warns about flows crossing a node):

```
docker compose exec -T ai python - < scripts/diagrams/db-snapshot.py > docs/02-design/drawio/erd/supabase-schema.json
node scripts/diagrams/erd-xml.mjs docs/02-design/drawio/erd-geosound.xml
node scripts/diagrams/dfd-xml.mjs docs/02-design/drawio/dfd/dfd-level-0.json docs/02-design/drawio/dfd-level-0.xml
node scripts/diagrams/dfd-xml.mjs docs/02-design/drawio/dfd/dfd-level-1.json docs/02-design/drawio/dfd-level-1.xml
node scripts/diagrams/dfd-xml.mjs docs/02-design/drawio/dfd/dfd-level-2.json docs/02-design/drawio/dfd-level-2.xml
```

Edits made by hand in draw.io are lost when a file is regenerated.

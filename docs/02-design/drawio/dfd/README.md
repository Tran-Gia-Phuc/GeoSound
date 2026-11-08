# ERD and data flow diagrams (draw.io)

| File | Content |
|---|---|
| [`../erd-geosound.xml`](../erd-geosound.xml) | ERD of every database table, one dashed frame per schema (auth, tour, notification, moderation, media, ai, ai_chat). Solid crow's-foot lines are foreign keys; dashed grey lines are soft references between services (no FK, services talk through RabbitMQ and HTTP). Built from the Prisma schemas; details in [`../../database-tables.md`](../../database-tables.md). |
| [`../dfd-level-0.xml`](../dfd-level-0.xml) | DFD level 0 (context diagram): the system as one process with its six external entities. |
| [`../dfd-level-1.xml`](../dfd-level-1.xml) | DFD level 1: processes 1.0 to 9.0 with data stores D1 to D12. Entities marked `*` are drawn twice to avoid long crossing lines. |
| [`../dfd-level-2.xml`](../dfd-level-2.xml) | DFD level 2, three pages (tabs at the bottom in draw.io): 5.0 automatic AI moderation, 4.0 tour content management, 9.0 AI travel assistant. Dashed grey circles are level-1 processes shown for context. |

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
node scripts/diagrams/erd-xml.mjs docs/02-design/drawio/erd-geosound.xml
node scripts/diagrams/dfd-xml.mjs docs/02-design/drawio/dfd/dfd-level-0.json docs/02-design/drawio/dfd-level-0.xml
node scripts/diagrams/dfd-xml.mjs docs/02-design/drawio/dfd/dfd-level-1.json docs/02-design/drawio/dfd-level-1.xml
node scripts/diagrams/dfd-xml.mjs docs/02-design/drawio/dfd/dfd-level-2.json docs/02-design/drawio/dfd-level-2.xml
```

Edits made by hand in draw.io are lost when a file is regenerated.

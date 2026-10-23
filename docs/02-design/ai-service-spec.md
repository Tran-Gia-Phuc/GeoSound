# AI Service Specification

Version: 1.0 | Date: 2026-10-21 | Owner: AI service

## 1. Purpose

The AI service adds two capabilities to GeoSound:

1. **Automatic content moderation** (UC#15, Tier 1): scans the text of a tour before it reaches the Admin queue.
2. **Travel chatbot**: lets a Tourist ask questions and search tours and places in natural language (supports UC#02).

## 2. Scope

| In scope | Out of scope |
| --- | --- |
| Text moderation of tour title, tour description, stop descriptions | Image scanning (done client-side with NSFW.js, UC#10) |
| Verdict Pass / Warning / Reject with reasons | Restricted-zone GPS check (turf.js, handled outside this service) |
| Chatbot over public (approved) tours and places | Admin decision (UC#19) and tour publishing |
| REST endpoints and RabbitMQ events | Notification delivery (UC#16, notification service) |

## 3. Moderation

### 3.1 Verdict mapping (UC#15)

| AI verdict | Tour state after AI | Notes |
| --- | --- | --- |
| Pass | Waiting for Admin | Enters the Admin queue (UC#19) |
| Warning | Waiting for Admin, AI Warning flag | Placed at the top of the queue |
| Reject | Draft - rejected by AI | Returned to Contributor with reasons, not queued |

The AI service never publishes a tour. Only the Admin can set a tour to Public.

### 3.2 Checked fields

- Tour title
- Tour description
- Description of each stop (required for every stop)

Categories checked: hate or discrimination, violence, sexual content, scam or spam, misleading or false information. Vietnamese and English are supported.

### 3.3 Policy

- Any severe violation in any field -> **Reject**.
- Borderline content only -> **Warning**.
- Nothing found -> **Pass**.
- Thresholds are configurable through environment variables.

### 3.4 REST contract

`POST /moderate`

Request:

```json
{
  "tour_id": "string",
  "title": "string",
  "description": "string",
  "language": "vi",
  "stops": [{ "stop_id": "string", "description": "string" }]
}
```

Response `200`:

```json
{
  "tour_id": "string",
  "verdict": "Pass | Warning | Reject",
  "reasons": [
    { "field": "stops[1].description", "category": "scam", "message": "string" }
  ]
}
```

Errors: `401` invalid token (JWT signed with `JWT_ACCESS_SECRET`, role in the `role` claim), `422` invalid input, `503` all LLM providers failed (tour stays in "Waiting for AI", UC#15 E2).

### 3.5 Events (RabbitMQ)

Follows the shared contract in `shared/events/index.js`: one topic exchange (`geosound.events`, env `RABBITMQ_EXCHANGE`), routing key = event name, JSON payload validated against the zod schema.

| Direction | Event | Payload | Notes |
| --- | --- | --- | --- |
| Consume | `tour.submitted` | `tourId`, `contributorId`, `at?` | Payload has no content; the AI service loads the tour from the tour service (see 3.6) |
| Publish | `tour.ai_passed` | `tourId`, `at?` | Verdict Pass or Warning. Warning needs the extension below |
| Publish | `tour.ai_rejected` | `tourId`, `reason`, `at?` | Verdict Reject. `reason` is a single string, so reasons are joined |

**Proposed contract change (needs team agreement):** the current contract has no way to express Warning (UC#15 requires the AI Warning flag to put the tour at the top of the Admin queue). Add optional fields to `tour.ai_passed`, which keeps existing consumers working:

```js
[EVENTS.TOUR_AI_PASSED]: base.extend({
  warning: z.boolean().optional(),
  reasons: z.array(z.string()).optional(),
}),
```

Queue: `ai.moderation`, bound to `tour.submitted`. The shared consumer helper does `nack` without requeue on handler error, so the AI service retries LLM calls itself and only gives up after the retry limit (UC#15 E2: tour stays "Waiting for AI").

### 3.6 Loading tour content

`tour.submitted` carries only IDs. Option A (recommended): the AI service calls an internal tour service endpoint to read the tour (title, description, stops) and authenticates with a service token. Option B: extend the event payload with the content, which makes messages large and changes a shared contract. Option A needs an internal endpoint from the tour service owner.

## 4. Chatbot

- Endpoint `POST /chat` streams the answer with SSE.
- Endpoint `GET /chat/history` returns the conversation history of the current user.
- Answers use RAG and search tools over public tours and places only.
- Search filters follow UC#02: city, language, tour type.
- The bot answers in the language of the user and refuses questions outside travel.
- Unpublished or hidden tours are never returned.

## 5. Non-functional requirements

- LLM: Gemini as primary, Groq as fallback on timeout, 429 or 5xx.
- Secrets (API keys) come from environment variables only.
- Input is length-limited and sanitized against prompt injection.
- Moderation target: respond within 15 seconds per tour.

## 6. Open questions

- Team agreement on adding `warning` and `reasons` to `tour.ai_passed`.
- Which tour service endpoint the AI service uses to read a tour (3.6), and how services authenticate to each other.
- Whether the demo should also show AI image moderation (currently client-side only).
- Which Postgres schema stores chat history.
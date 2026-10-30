# Signed-in devices: business research and design (UC23)

Status: accepted 2026-10-30 (limit, alert and the remaining points decided by the AI owner for the demo). Use case: [UC23](../use%20case/lam-truoc/UC23-quan-ly-thiet-bi-dang-nhap.md).
Owner of the code: Auth service (`services/auth`) plus a small change in `shared/middleware` and the client.

## 1. Goal

A user signed in on three phones sees three devices in "Signed-in devices", can tell which one is the
device in hand, and can sign out any other device (or all of them) from anywhere. Signing out must
really cut that device off, not only hide it from the list.

## 2. How other products do it

| Product | What the list shows | Actions | Notes |
| --- | --- | --- | --- |
| Google account ("Your devices") | Device name, OS, approximate location, last activity, "This device" | Sign out one device | New-device security alert by email; password change signs out other devices |
| Facebook ("Where you're logged in") | Device, browser/app, city, last active, "Active now" | Log out one session, "Log out of all sessions" | Sessions of the same device are grouped |
| Telegram / Zalo ("Active sessions") | App, device model, IP-based location, last online | Terminate one, "Terminate all other sessions" | Terminating all others needs a confirmation; the current session cannot be terminated from the list |
| Netflix / Spotify | Recent devices | "Sign out of all devices" | Netflix also caps simultaneous streams (a paid-plan rule, not a security rule) |

Common pattern we follow: one row per signed-in device, current device marked and listed first, last
activity as relative time, approximate location only, sign out one device, sign out all other devices,
and automatic sign-out of all devices after a password reset or a ban.

## 3. What Auth does today (verified in the code)

- `POST /login` and `POST /refresh` return a JWT access token (`JWT_ACCESS_TTL`, 15 min) and a JWT refresh
  token (`JWT_REFRESH_TTL`, 7 days). The refresh token carries only `sub`.
- Nothing about a login is stored on the server: no session table, no logout endpoint, no rotation.
  A stolen refresh token stays valid for 7 days and cannot be revoked; a password reset or a ban does
  not end existing logins (a ban is only checked at the next refresh).
- Every service checks the access token with `shared/middleware` `verifyJwt` (signature and role only).

So the feature needs server-side sessions first; the screen is the small part.

## 4. Business rules (proposal)

| # | Rule | Recommendation |
| --- | --- | --- |
| R1 | What is a "device" | One sign-in on one browser or app install. The client keeps a random `deviceId` (local storage); signing in again on the same device replaces its session instead of adding a row |
| R2 | What the list shows | Device name from the User-Agent ("Chrome trên Windows", "Safari trên iPhone"), sign-in time, last activity ("Đang hoạt động", "5 phút trước"), approximate location (city, country) when known, "Thiết bị này" badge. Never the full IP or the token |
| R3 | Order | Current device first, then last activity, newest first |
| R4 | Sign out one device | Any other device, after a confirmation. Signing out the current device is the normal "Đăng xuất" |
| R5 | Sign out all other devices | One action after a confirmation; the current device stays signed in |
| R6 | Effect of a sign-out | The device can no longer refresh; its access token stops working at once (see 5.3) and the app returns to the sign-in screen |
| R7 | Automatic sign-out of all devices | After a password reset (UC01 A2) and when an account is banned (UC21). After a password change while signed in: all devices except the current one |
| R8 | Expiry | A session ends after 7 days without activity (= refresh TTL) and at most 30 days after sign-in; expired sessions leave the list |
| R9 | Limit | No business limit. A technical cap of 100 active sessions per account (`AUTH_MAX_SESSIONS`, demo value) only bounds stored data; past it, the least recently active session is signed out |
| R10 | New-device alert | Email "Đăng nhập mới trên <thiết bị>" when a sign-in creates a new device (P1, through Notification), sent to the account email. For the demo, `SECURITY_ALERT_TO` in `.env` sends every alert to one test inbox instead (never written in the repo) |
| R11 | Stolen token | Refresh tokens rotate on every use; reuse of an old refresh token signs that session out (theft signal) |
| R12 | Privacy | IP and User-Agent are kept only while the session lives and 30 days after it ends (security investigation), then deleted. Location is city level, from the IP, without a paid service at first (shown as "Không xác định" when unknown) |
| R13 | Admin | An admin does not see other users' devices in this UC; UC21 (ban) signs out all devices of the banned account |

Decided on 2026-10-30: R9 cap 100, R10 email alert (P1, demo inbox through `SECURITY_ALERT_TO`), R12 retention
30 days and city-level location from the IP, 5.3 immediate sign-out through Redis in `verifyJwt`.

## 5. Technical design

### 5.1 Data (schema `auth`)

```text
sessions
  id               uuid  pk                 (sid, carried in tokens)
  user_id          uuid  -> users.id
  device_id        text                     (from the client, R1)
  device_name      text                     (parsed User-Agent)
  user_agent       text
  ip_address       text                     (last seen)
  location         text?                    (city, country)
  refresh_hash     text                     (sha-256 of the current refresh token)
  created_at, last_active_at, expires_at    timestamptz
  revoked_at       timestamptz?
  revoke_reason    text?   user | user_all | password_reset | password_change | banned | limit | reuse | expired
  unique (user_id, device_id) where revoked_at is null
```

### 5.2 Token flow

- Login: create (or replace, R1) the session; tokens carry `sid`; store `refresh_hash`.
- Refresh: find the session by `sid`; reject if revoked or expired; if the presented token hash is not
  the current one -> reuse (R11): revoke the session. Otherwise rotate: new refresh token, new hash,
  update `last_active_at`, IP.
- Logout / sign out device / sign out all: set `revoked_at` and `revoke_reason`.

### 5.3 Making a sign-out immediate

Access tokens are stateless for 15 minutes. On revoke, Auth writes `revoked:sid:<sid>` to Redis with a
TTL equal to the access token lifetime; `verifyJwt` checks that key when the token has a `sid` (one Redis
`GET` per request, Redis already runs for every service). Without this, a signed-out device keeps
working for up to 15 minutes; that is the fallback if the team does not want the shared middleware change.

### 5.4 API (Auth, through the gateway `/api/auth`)

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `GET` | `/sessions` | | `{ sessions: [{ id, deviceName, location, createdAt, lastActiveAt, current }] }` |
| `DELETE` | `/sessions/:id` | | 204; 404 unknown or not yours; 409 when `:id` is the current session (use logout) |
| `POST` | `/sessions/revoke-others` | | `{ revoked: n }` |
| `POST` | `/logout` | | 204, revokes the current session |
| `POST` | `/login`, `/refresh` | `deviceId` added (optional) | unchanged response, tokens now carry `sid` |

### 5.5 Rollout

Old tokens without `sid` keep working until they expire (at most 7 days); the next login creates a
session. No data migration is needed.

### 5.6 Implementation notes (issue #247)

Where the code differs from or adds to the text above:

- `device_id` is nullable: a client that sends no `deviceId` gets a new session on every sign-in
  (and a new-device alert). "One active session per (user_id, device_id)" is enforced in
  `SessionManager.start` (Prisma cannot express the partial unique index); the table has plain
  indexes on `user_id`, `(user_id, device_id)`, `revoked_at` and `expires_at`.
- `expires_at` stores the earlier of "7 days after the last activity" and "30 days after sign-in"
  (`AUTH_SESSION_IDLE_DAYS`, `AUTH_SESSION_MAX_DAYS`); it moves on every refresh. A refresh of an
  expired session marks it `expired`.
- A sign-in on the same `deviceId` revokes the old session with reason `user`. A device counts as
  "new" for the alert (R10) only when no session row (any state, within retention) exists for that
  `deviceId`, so signing out and back in on the same browser sends no email.
- The refresh token carries `sub`, `sid` and a random `jti`; only its sha-256 is stored.
- Old refresh tokens without `sid` (rollout, 5.5): the refresh creates a session for them (no alert)
  so the device shows up in the list; the new tokens carry `sid`. Old access tokens without `sid`
  are never checked against Redis and work until they expire.
- `POST /refresh` with `sid` and an unknown, revoked, expired or reused token answers
  401 `session_revoked` ("Phiên đăng nhập đã kết thúc"). Two refreshes racing with the same token
  are seen as reuse (the second one signs the session out); the client must serialise refreshes.
- Revocation (5.3): `verifyJwt(roles, { isRevoked })` or `setSessionRevocationCheck(fn)` (per process,
  set in `src/index.js`), with `createRedisRevocationCheck(redis)` in `shared/middleware`. A Redis
  error or a lookup slower than 300 ms lets the request through (fail open, warned once). Wired in
  Auth and Tour; Media uses `verifyJwt` but has no Redis client, so its tokens stay valid until they
  expire (at most `JWT_ACCESS_TTL`). The gateway does not verify JWTs.
- Revocation key TTL = `JWT_ACCESS_TTL` in seconds. If writing the key fails the sign-out is still
  saved; only the "at once" part is lost for that token.
- Location (R12): `LocationResolver` port with a null implementation, so `location` is always null
  for now (shown as "Không xác định"). The client IP is the first hop of `x-forwarded-for`; the
  gateway now sets it for `/api/auth` (`xfwd`).
- Ban (R7, R13): Auth has no ban endpoint yet; `RevokeAllSessions` (reason `banned` by default) is
  ready for UC21. Password change while signed in is not built (no such endpoint).
- Retention (R12): `PurgeEndedSessions` runs one minute after start, then hourly
  (`AUTH_SESSION_RETENTION_DAYS`, default 30).
- Event `auth.new_device_login` = `{ userId, email, deviceName, location?, at }`. Auth now connects to
  RabbitMQ at start; a failed publish is only logged. Notification sends "Đăng nhập mới trên
  <deviceName>" to `SECURITY_ALERT_TO` when set, else to `email`.

## 6. Out of scope

Admin view of a user's devices, push notifications, per-device settings, limiting simultaneous audio
playback.

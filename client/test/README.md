# Browser checks

The browser tests exercise scoped frontend changes. API fixtures reproduce the
current backend JSON contracts and inject failure paths; fixture results do not
prove that a live backend operation succeeded.

From `client/`, run `npm install`, `npx playwright install chromium`, then
`npm run test:ui`. On Windows with Edge installed, set `PW_CHANNEL=msedge`.

The Vite test server proxies `/api` to `http://127.0.0.1:8080`; `API_TARGET`
can override it. `LIVE_API_TESTS=1` enables live reads in tests that provide
them. `UI_AUTH_JSON` can contain a test session for an authenticated live read;
keep it outside Git. No test includes real credentials. Port 5180 must be free.

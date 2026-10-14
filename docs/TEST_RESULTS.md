# Test Results

Run: `npm test` against PostgreSQL 16 (integration tests rebuild the schema from the migrations).

```
Test Files  6 passed (6)
     Tests  71 passed (71)
```
`npm run typecheck`: clean · `npm run build`: success.

## Acceptance criteria → evidence

| # | Criterion | Automated test | Result |
|---|---|---|---|
| 1 | Real product entered via form/connector | `business-flow › [AC1]`, browser form check | ✅ |
| 2 | Source URL & timestamp preserved | `[AC2]` (URL, method, discovered_at, growth; idempotent re-ingest) | ✅ |
| 3 | Multiple retail offers compared for the exact variant | `[AC3]` (750 ml listing auto-excluded as mismatch) + `pricing` unit tests | ✅ |
| 4 | Supplier offer linked to product | `[AC4]` | ✅ |
| 5 | Unverified stock prevents approval | `[AC5]`, plus gate unit tests (missing / expired / unavailable / insufficient qty) | ✅ |
| 6 | Profit calculations account for configured costs | `economics.test.ts` (hand-calculated reference case, every cost line) | ✅ |
| 7 | Low/negative margin flagged | `[AC6/AC7]`, economics negative-margin test | ✅ |
| 8 | Budget limits prevent overspending | `[AC8]` (per-product cap, inventory budget), gate tests (cash, concurrency) | ✅ |
| 9 | Approval generates an actionable purchase record | `[AC9]` (PO created, committed cash, double-approval blocked, machine actor blocked, audit row) | ✅ |
| 10 | Received goods update inventory | `[AC10]` (landed cost 62.5 incl. pickup, ledger) | ✅ |
| 11 | Sales update stock & cash | `[AC11]` (reserve → ship → deliver buckets, ledger, actual contribution 371.30) + DB-level oversell test | ✅ |
| 12 | Returns reverse inventory & finance | `[AC12]` (restock, refund, return shipping, contribution 143.80, reconciliation) + failed-delivery test | ✅ |
| 13 | Telegram notifications work when configured | `[AC13/AC14]` with mocked Bot API: skipped when unconfigured, sent when configured, failure recorded | ✅ (mocked; live pending token) |
| 14 | Failed integrations visibly report errors | Telegram failure → `integration_status=error`; Meta publish without credentials → `failed` + message; DB forbids `published` without post id; dead jobs alert | ✅ |
| 15 | Demo data can't appear as production data | `environment.test.ts` (stamp mismatch refused, seed guard refuses non-demo DB) + gate `not_demo` | ✅ |
| 16 | Usable in Arabic RTL on desktop and mobile | Manual: Playwright screenshots at 1440 px and 390 px, light and dark (`docs/screenshots/`), 0 console errors on all 11 pages | ✅ manual |

## Manual checks performed
- Every dashboard page rendered with HTTP 200 and no browser console errors (demo DB).
- Server-action forms in a real browser: trend signal, product created from a signal, retail offer, order transition. Each mutation was confirmed in the DB.
- Machine API via curl: 401 without or with a wrong token; idempotent trend re-ingest; zod validation error; raw Telegram update ingestion; job enqueue and run (`daily_research` succeeded); daily report; alert endpoint; Telegram webhook rejects a missing secret token (401).
- Unauthenticated dashboard access redirects to `/login` (307).

## Not yet verified
- Live Telegram Bot API, Meta Graph API and Claude API calls (no credentials in this environment).
- n8n Cloud import and execution (the JSON files are generated and validated as JSON but haven't been imported into an n8n instance here).

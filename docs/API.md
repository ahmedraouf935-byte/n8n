# SAFQA Machine API (for n8n)

All `/api/v1/*` endpoints require `Authorization: Bearer <N8N_WEBHOOK_SECRET>` and are rate-limited to 120 requests/minute. Responses are JSON:
- success: `{ "ok": true, ... }`
- validation error (400): `{ ok: false, error: "validation_error", issues }`
- business rule (422): `{ ok: false, error: <code>, message }`
- other: 401 (auth), 429 (rate limit), 503 (secret not configured)

## POST /api/v1/ingest/trends
```json
{ "source": "n8n_webhook", "method": "webhook", "idempotencyKey": "sheet-trends:2026-10-14",
  "items": [{ "title": "منظم أدراج", "titleEn": "Drawer organizer", "platform": "tiktok",
    "evidenceType": "measured", "sourceUrl": "https://…", "region": "EG",
    "metricType": "views", "metricValue": 380000, "previousValue": 95000,
    "discoveredAt": "2026-10-14T06:00:00Z", "notes": null, "imageUrl": null }] }
```
- `platform`: tiktok, facebook, instagram, google_trends, amazon_eg, noon, jumia, youtube, other, ai
- `evidenceType`: measured (URL required), owner_reported, ai_hypothesis (metrics are dropped)
- Returns `{ runId, received, created, duplicate, failed, errors[], signalIds[] }`
- Fails with 422 `source_disabled` when the source isn't enabled, or `quota_exceeded`.

## POST /api/v1/ingest/retail-offers
```json
{ "items": [{ "variantId": 1, "retailer": "noon", "url": "https://…", "titleRaw": "…", "listedPrice": 249,
  "shippingCost": 25, "priceType": "listed", "availability": "in_stock", "observedAt": "2026-10-14T07:00:00Z" }] }
```
Offers are stored as `unreviewed`, `probable` or `mismatch` (when an attribute conflicts). Only the owner can mark an offer `exact`.

## POST /api/v1/ingest/supplier-posts
Accepts raw Telegram `Update` objects (`updates`) or normalized `posts`:
```json
{ "updates": [ { "update_id": 1, "channel_post": { "message_id": 77, "date": 1760000000, "text": "…",
  "chat": { "id": -100123, "username": "supplier" } } } ] }
```
Only chats registered on a supplier (`telegram_chat_id`) are accepted. Returns `{ created, duplicate, ignored, failed, offers[] }`.

## POST /api/v1/jobs/enqueue
`{ "jobType": "daily_research", "idempotencyKey": "daily_research:2026-10-14", "runNow": true }`

Job types: `daily_research`, `score_opportunities`, `refresh_freshness`, `match_supplier_offers`, `detect_duplicates`, `ai_extract_supplier_posts`, `generate_content_drafts`, `low_stock_alerts`, `daily_summary`, `dispatch_notifications`, `publish_due_posts`.

## POST /api/v1/jobs/tick
Runs up to 5 ready jobs. Returns `{ ran: [{ id, jobType, status, error? }] }`.

## GET /api/v1/reports/daily
`{ text }` is the Arabic daily summary, built only from recorded data.

## POST /api/v1/alerts
`{ "workflow": "…", "node": "…", "message": "…", "executionId": "…", "integration": "telegram" }` creates a critical notification and can mark an integration as `error`.

## GET /api/v1/health
Returns the environment and integration statuses. `GET /api/health` (public) only returns `{ ok }`.

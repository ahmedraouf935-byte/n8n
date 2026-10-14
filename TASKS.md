# SAFQA — Task Tracker

## Phase 1 — Foundation ✅
- [x] Repository scaffold (Next.js 15, TypeScript strict, Tailwind v4, Vitest)
- [x] PostgreSQL schema covering all 31 required entities plus `cash_ledger`, `inventory_levels`, `jobs`, `ai_usage`, `rate_limits`, `environment_stamp`
- [x] Migration runner with immutable environment stamp
- [x] Owner authentication (bcrypt, JWT cookie, login rate limit, roles)
- [x] Arabic RTL dashboard shell (light/dark, responsive, Cairo time, EGP)
- [x] Product and variant (SKU) records, duplicate warning on create
- [x] Supplier directory, manual offers, human-only availability verification with expiry
- [x] Unit-economics calculator with scenarios, break-even and max CAC
- [x] Opportunities table plus research page with explanations
- [x] Purchase request → gates → owner approval → purchase order

## Phase 2 — Research intelligence ✅
- [x] Trend signal intake: form, CSV, n8n API; evidence types; URL required for measured data
- [x] Source registry with honest access status and daily quotas
- [x] Arabic/English normalization, attribute extraction, conflict-aware matching
- [x] Duplicate detection job (flags only)
- [x] Retail comparison: dedupe, mismatch, stale and outlier removal; recommended price with margin floor
- [x] Scoring with configurable weights and bands, confidence, explanations, price snapshots
- [x] Telegram supplier post ingestion (authorized chats only), price/MOQ parsing, uncertainty flags
- [x] Claude extraction job (optional, budget-capped)

## Phase 3 — Operations ✅
- [x] Purchase orders, payments (ledger), receiving with landed cost
- [x] Inventory buckets, movements, reorder threshold, slow-moving flag
- [x] Sales orders lifecycle, COGS snapshot, delivery/failed delivery, returns, refunds, reconciliation
- [x] Cash and profit reporting (overview, finance, per-SKU, per-campaign, actual vs projected)
- [x] Telegram notifications and daily summary (tested with mocked API)

## Phase 4 — Marketing automation ✅ (live publishing pending credentials)
- [x] Content drafts (Claude or template) from verified attributes only
- [x] Approval queue, image rights registry, scheduling
- [x] Meta publishing adapter with visible failures
- [x] Campaign tracking (manual entry; spend booked to ledger)
- [~] Reorder recommendations: low-stock and slow-moving flags only (see roadmap)

## Blocked / needs owner input
- [ ] `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID`; add bot as admin to supplier channels; register each channel's chat id on its supplier
- [ ] `N8N_WEBHOOK_SECRET` and deployment URL; import and activate workflows in n8n Cloud
- [ ] `ANTHROPIC_API_KEY` (optional)
- [ ] Meta app + Page token (optional, for publishing)
- [ ] Google Sheets credential + research sheet URL (optional, workflow 01)
- [ ] Production PostgreSQL (Supabase/Neon) and hosting decision

## Roadmap after MVP (prioritized)
1. Live-verify Telegram ingestion with the owner's real supplier channels and tune the post parser on real posts.
2. Reorder recommendation engine (sell-through rate, days of cover, supplier lead time) with an approve-to-PO flow.
3. Instagram Hashtag Search adapter (after app review) feeding measured `instagram` signals.
4. Courier integration (e.g. Bosta API) for automatic shipment status and COD remittance reconciliation.
5. WhatsApp Business order intake (Cloud API) instead of manual order entry.
6. Image hashing for product image similarity in matching (owner-uploaded images only).
7. Amazon PA-API adapter once an Associates account qualifies.
8. Scheduled encrypted DB backups to object storage, with restore drills.
9. Multi-item orders in the order form (the service already supports them).
10. Calibrate scoring weights against the owner's actual test outcomes.

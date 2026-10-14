# SAFQA (صفقة) — Project Plan

## Goal
An operational platform (not a mock dashboard) for a micro-commerce business in Egypt that starts with **EGP 5,000** working capital. The owner uses it to:

1. find trending products, backed by evidence,
2. compare Egyptian retail prices for the **exact same variant** with wholesale quotes from El-Mosky, Ataba and other markets,
3. understand realistic contribution margins,
4. approve small test purchases (purchases never happen automatically),
5. run inventory, orders, returns, cash and marketing.

## Guiding rules
- **No fabricated data.** Every external observation stores its source, collection time and collection method. Demo data can exist only in a database stamped `demo`, and the seed script refuses to run anywhere else.
- **Labels are explicit.** Each value is shown as Verified, Unverified, Estimated, Stale, Unavailable or Demo, with an icon and text rather than colour alone.
- **The owner approves all spending.** Safety gates run regardless of score, and run again inside a serialized transaction at the moment of approval.
- **Integrations are honest.** An integration reads "connected" only after a live check succeeds. Any platform without authorized access shows as *not available* and has a manual or CSV fallback.
- **Correctness comes before decoration.** Money, stock and the state machines are enforced by the database (CHECK constraints, append-only ledgers) and covered by automated tests.

## Phases & status

| Phase | Scope | Status |
|---|---|---|
| 1 — Foundation | Repo, auth, DB + migrations, Arabic RTL shell, products/variants, manual product input, suppliers, manual verification, unit-economics calculator, opportunities, purchase approval | ✅ Done, tested |
| 2 — Research intelligence | Trend intake (manual/CSV/n8n), source adapters with honest status, Arabic/English normalization + variant matching, duplicate detection, retail comparison with outlier removal, scoring with evidence & confidence, Telegram supplier ingestion | ✅ Done, tested (live platform APIs limited — see DATA_SOURCES.md) |
| 3 — Operations | Purchase orders, payments, receiving with landed cost, inventory movements, sales orders lifecycle, deliveries/failed deliveries/returns, cash ledger, reconciliation, Telegram notifications, daily summary | ✅ Done, tested |
| 4 — Marketing automation | Content drafts (Claude or template), approval queue, scheduled posts, Meta publishing adapter, campaign tracking | ✅ Implemented; live publishing **untested** until Meta credentials are provided. Reorder recommendations: basic (low-stock + slow-moving flags) |

## Budget assumptions (adjustable in Settings)
| Allocation | EGP |
|---|---|
| Initial inventory | 2,500 |
| Advertising tests | 1,200 |
| Packaging & transport | 500 |
| Contingency & returns | 800 |

Risk defaults: at most 2 concurrent product tests, at most EGP 1,500 per product test, minimum 15% contribution margin. Sensitive categories need an explicit compliance acknowledgement, and the "prohibited" category is blocked outright.

## Assumptions
- One owner account plus optional operator/viewer accounts. Operators can't approve purchases, pay POs or change budgets.
- Cash on delivery (COD) is the main payment method. Carrier fees are recorded as paid when a shipment is created. COD remittance can be marked "pending" until the carrier actually pays out.
- The owner records Egyptian retail prices manually or through n8n. No marketplace scraping is done, because of platform terms.
- The default AI model is `claude-opus-5-5`. It can be changed with `AI_MODEL`, and spend is capped by a monthly budget setting.
- Timezone is Africa/Cairo and currency is EGP throughout.

## External dependencies
See `DATA_SOURCES.md` for the access matrix and `README.md` → *Monthly operating cost* for costs. Paid dependencies are all optional and none are enabled by default.

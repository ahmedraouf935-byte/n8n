# SAFQA go-live report — 2026-10-14

## PASS / FAIL summary

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | All source code committed and pushed to GitHub | **PASS** | Branch `claude/safqa-commerce-platform-v5qi7o` (the repo's default branch) matches the local HEAD. The repo is **public**, and no secrets are committed (`.env` is gitignored; scan clean) |
| 2 | Persistent PostgreSQL provisioned | **BLOCKED — needs your account** | The build environment can't reach `console.neon.tech` / `api.vercel.com` (network policy), and there are no hosting credentials. Code is ready: pooled/direct URLs, TLS, serverless pool size, lock-protected migrations |
| 2b | App deployed to hosting | **BLOCKED — needs your account** | `vercel.json` (Frankfurt), `vercel-build` (optional migrate-on-build), Render alternative. Follow DEPLOYMENT.md (about 15 min) |
| 3 | Production migrations safe + admin setup | **PASS (local)** | Advisory-locked (tested with concurrent runs), transactional per file, immutable environment stamp. Owner bootstrap via one-time token-protected `/setup` (tested) or `npm run db:create-admin` |
| 4 | Live dashboard URL | **NOT YET** | Available as soon as step 3 of DEPLOYMENT.md is done |
| 5 | n8n workflows ready for import | **PASS (generated, not imported)** | 16 JSON files; `SAFQA_PUBLIC_URL=… npm run n8n:build` writes your URL into them. Credentials listed in docs/N8N_SETUP.md |
| 6 | Telegram supplier integration prepared | **PASS (code) / WAITING (token)** | API ingestion and the Telegram update parser are tested. The `npm run telegram` helper does check/discover/test/webhook. api.telegram.org is blocked from this build environment, so no live call was made |
| 7 | Complete product workflow demonstrated | **PASS (15/15 steps)** | `npm run test:e2e` against a running production build + demo-stamped DB. See the walkthrough below and `docs/e2e/*.png` |
| 8 | Real vs manual vs demo vs disabled verified | **PASS** | Matrix below |
| 9a | Automated tests | **PASS** | 71/71 (unit + integration on real Postgres), typecheck clean, production build OK |
| 9b | Dependency audit | **PASS** | `npm audit --omit=dev`: 0 vulnerabilities (Next's bundled PostCSS pinned to 8.5.30 via override) |
| 9c | Authentication & security (black-box) | **PASS (10/10)** | `npm run security:check`: headers, all 13 dashboard routes require login, 8 API endpoints × 3 bad-auth cases → 401, malformed JSON → 400 with no internals, Telegram webhook secret, setup page closed, brute-force lockout at attempt 6, forged session rejected |
| 10 | No purchases, paid APIs or publishing without approval | **PASS** | Nothing purchased or activated. The walkthrough stops at "awaiting owner approval". Publishing needs Meta credentials plus owner approval |

### Issues found and fixed during this pass
- API: malformed JSON returned 500 → now 400 `invalid_json`.
- Gate message showed the untranslated confidence value ("high") → now Arabic.
- `npm audit` flagged PostCSS advisories in Next's bundled copy → patched version pinned.
- Migrations could race between two concurrent deploys → now serialized with an advisory lock on a reserved connection.
- The walkthrough test's own capital check double-deposited on re-runs → fixed (test-only bug).

## End-to-end product workflow (executed)
Run against `next start` (production build) with a database stamped `demo`. Inputs are test values with `example.invalid` URLs. **This demonstrates the workflow, not market research.**

| Step | Actor / channel | Result |
|---|---|---|
| First-run owner setup | Browser → `/setup` with token | Owner created, page closes |
| Record capital 5,000 EGP | Browser | Cash ledger 5,000 |
| 1. Discovery import (TikTok views 80k→240k, Ad Library 4→9 ads, EG) | Machine API, as n8n workflow 01/02 does | 2 measured signals; re-import counted as duplicate |
| 2. Product + exact variant from signal (30×20 cm, grey, fabric, 180 g) | Browser | SKU created, signal linked |
| 3. Egyptian retail prices: Amazon.eg 245, Noon 229+25, Jumia 239+30, FB page 220+45, Noon **40×30 cm** 199 | Machine API | 40×30 offer **auto-excluded** (size conflict); owner confirmed 4 exact offers |
| 4. Supplier (El-Mosky, Telegram chat registered) + channel post "السعر 58 جنيه، أقل كمية 12" | Browser + API (raw Telegram update) | Offer parsed: price 58, MOQ 12 |
| 4c. Match | Browser, supplier inbox | Linked to the variant (owner) |
| 5. Verification (WhatsApp: available, 57 EGP, 60 pcs, MOQ 12) + variant confirmed | Browser (human-only action) | Offer **مؤكد** |
| 6. Profitability | Engine | Wholesale 57 → recommended **205 EGP**. Contribution **53.64 EGP / delivered unit**, margin **20.8%**, break-even **12 shipped orders**. Pessimistic batch result −650.84, base +305.50, optimistic +1,272.60 |
| 6b. Recommendation | Engine | **68.7/100, "manual review"**, data confidence high, with an Arabic explanation per factor |
| 7. Purchase request (18 pcs, 1,076 EGP) | Browser | **All safety gates passed → awaiting owner approval** (not approved by the test) |

## What is real vs manual vs demo vs disabled

| Capability | Today | Source of truth |
|---|---|---|
| Owner-entered products, suppliers, verifications, orders, expenses | **Real** (your inputs) | Production DB |
| Cash, inventory, COGS, contribution figures | **Real**, computed only from recorded transactions | Ledger + stock movements |
| Unit economics / recommended price / score | **Estimated** from your inputs and settings (labelled ≈ تقديري) | Domain engine |
| Trend discovery | **Manual / CSV / your research sheet via n8n.** No automated TikTok, Google Trends or Meta Ad Library pull: no authorized API exists for this use in Egypt | DATA_SOURCES.md |
| Egyptian retail prices (Amazon.eg, Noon, Jumia, pages) | **Manual capture with URL** (form or API). No scraping (platform terms) | — |
| Telegram supplier feed | **Built, disabled** until bot token + admin access to channels | TELEGRAM_SETUP.md |
| Telegram owner notifications / daily report | **Built, disabled** until token + chat id (shown as "skipped", never "sent") | Settings → logs |
| Claude extraction & copywriting | **Built, disabled** until API key (template fallback) | Settings → integrations |
| Facebook/Instagram publishing | **Built, disabled** until Page token. Due posts fail visibly | Marketing |
| n8n automations | **Ready to import**, inactive until you import and activate | n8n Cloud |
| Demo data | Only in databases stamped `demo` (banner on every page). The seed script refuses production | — |

## Blocked items needing you
1. **Neon account** → create the project and give the two connection strings to Vercel (don't send them in chat).
2. **Vercel account** → import the repo, add env vars, deploy. **Plan decision:** Hobby (free, non-commercial) to try, then Pro ~$20/mo or Render ~$7/mo for business use.
3. **Telegram bot token** + channel admin access (TELEGRAM_SETUP.md).
4. **n8n Cloud** → create the 3 credentials, import the workflows, set the error workflow, activate.
5. Optional: Anthropic API key (budget-capped), Meta Page token.

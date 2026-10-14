# SAFQA — Data-Source Access Matrix

> Platform access rules change often. The statements below reflect publicly documented policies as of the time of writing. **Verify each one against the official developer docs before relying on it.** SAFQA never bypasses captchas or logins, and never accesses private groups without permission.

Status legend: ✅ working & tested · 🔑 implemented, waiting for credentials · ✋ manual/CSV only (no authorized API) · ⛔ not used

| Source | Official API? | Permissions / authorization | Data fields we use | Rate limits | Cost | Legal / policy notes | SAFQA status & fallback |
|---|---|---|---|---|---|---|---|
| **Owner manual entry** (forms) | n/a | Owner login | Everything, with URL and timestamp | Internal per-source daily limit | Free | Owner is responsible for what is recorded | ✅ Working |
| **CSV import** (dashboard or n8n webhook) | n/a | Owner login or n8n bearer secret | Trend rows, with columns listed in the UI | 2 MB per file; source quota | Free | Only import data you are allowed to use | ✅ Working |
| **Owner screenshots** | n/a | Owner | Owner transcribes values; method is stored as `owner_screenshot` | — | Free | Store the screenshot link as evidence | ✅ Working (no OCR) |
| **TikTok Creative Center** (Top Products, hashtags, ads) | No public API | — | Product names, popularity indicators the owner sees | — | Free web UI | Automated scraping is against the terms | ✋ Owner records observations with URL, or uses CSV / research sheet (workflow 01) |
| **TikTok Research API** | Yes | Approved academic/non-profit researchers in eligible regions only | Videos, hashtags, engagement | Daily quotas | Free if approved | Commercial use not permitted | ⛔ Not eligible; marked `not_available` |
| **TikTok Commercial Content API** | Yes | Application required; covers ads shown in specific regions (EU-focused) | Ad metadata | Quotas | Free if approved | Likely not useful for Egypt | ⛔ Not configured |
| **Meta Ad Library API** | Yes | Identity-confirmed developer account | **Political/issue ads** globally; all ads only for **EU-delivered** ads | ~200 calls/hour per token | Free | Ordinary commercial ads in Egypt are **not** available via API | ✋ Owner reviews the public Ad Library web UI and records findings with URL |
| **Facebook public pages / Marketplace** | Graph API only for Pages you manage; no Marketplace API for third parties | Page roles | Own Page posts and insights | Graph API rate limits | Free | Scraping other pages or Marketplace is against the terms | ✋ Manual capture of competitor prices with URL |
| **Instagram Hashtag Search** (Graph API) | Yes | IG professional account plus app review (`instagram_basic`, etc.) | Top/recent media IDs for a hashtag | 30 unique hashtags per rolling 7 days | Free | Business/creator accounts only | 🔑 Source registered as `pending_credentials`; no workflow yet (roadmap) |
| **Instagram/Facebook publishing** (Graph API) | Yes | Own Page token with `pages_manage_posts`; IG: `instagram_content_publish` | Post creation, post IDs | IG: limited number of API-published posts per 24h | Free | Use owned/authorized images only | 🔑 Adapter implemented (`adapters/meta.ts`); untested until credentials are provided. Failures are recorded and posts are never marked published |
| **Google Trends** | No official public API (an alpha API exists for limited testers) | — | Interest over time / related queries via **CSV export** | — | Free | Unofficial scraping libraries violate the terms | ✋ CSV export → dashboard import or research sheet |
| **Amazon.eg** | Product Advertising API 5.0 | Approved Amazon Associates account with qualifying sales | Prices and offers | Tied to revenue | Free | Must follow Associates policy | ✋ Manual price capture with URL; PA-API left for the roadmap |
| **Noon / Jumia Egypt** | No public catalog API for third parties (seller APIs only) | — | — | — | — | Scraping against the terms | ✋ Manual capture with URL |
| **Telegram supplier channels/groups** | Bot API (official) | Bot must be **admin of the channel**, or a **member of the group with privacy mode off** or in a position to receive the messages. Only chats registered on a supplier record are accepted | Post text/caption, message id, date, chat id/username | ~30 msg/s global, 1 msg/s per chat (sending); one webhook per bot | Free | Don't redistribute supplier images without permission; SAFQA stores only the post link | 🔑 Implemented and tested with mocked updates. Goes live once `TELEGRAM_BOT_TOKEN` is set and workflow 03 is active |
| **Telegram notifications** | Bot API | Bot token plus owner chat id | Messages to owner | As above | Free | — | 🔑 Tested with a mocked API (success and failure paths); live after credentials |
| **Claude API** (Anthropic) | Yes | API key | Supplier-post extraction, Arabic captions | Account tier limits | Pay per token (see README) | Output is never treated as evidence | 🔑 Optional; deterministic fallbacks exist; monthly budget cap |
| **Google Sheets** (backup/export, research sheet) | Yes (via n8n node) | Google OAuth in n8n | Research rows / exports | Google quotas | Free | — | 🔑 Workflow 01 ships **disabled** until connected |
| **n8n Cloud** | Yes | Owner account; bearer secret to SAFQA | Orchestration | Plan execution limits | Plan dependent | — | 🔑 16 workflows provided. They become live once imported, the credential is set and they're activated |

## What "measured" means
A trend signal is `measured` only when the numbers came from the platform or tool and the source URL is stored. The ingest API rejects measured signals that have no URL. `owner_reported` is an owner observation without numbers. `ai_hypothesis` is a model suggestion, and the database forbids it from carrying growth numbers. The scoring engine caps the demand score from hypotheses at 25/100 and lowers confidence.

## Retail-price caveat
Listed prices aren't proof of sales. The `observed_transaction` price type must be entered explicitly. Promotional prices are kept separate, and historical prices are excluded from current ranges.

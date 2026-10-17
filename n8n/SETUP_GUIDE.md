# SAFQA — n8n Cloud setup guide

Built for: **https://safqa-indol.vercel.app** · 16 workflows · every workflow is **inactive** · **no secrets inside the files**

## Safe for your existing workflows
- **Import from File** always creates *new* workflows. It never overwrites or deletes existing ones, including your job-application workflows.
- Every SAFQA workflow is named `SAFQA — 01 …` to `SAFQA — 16 …` and tagged **safqa**. Filter by that tag so you only ever touch SAFQA workflows.
- The credentials below are new and named `SAFQA …`. Don't edit or reuse credentials belonging to your other workflows.

## Step 1 — Create the credentials (n8n → Credentials → Add credential)

| # | Credential name (type exactly) | Type | Fields | Used by |
|---|---|---|---|---|
| 1 | **SAFQA API** | *Header Auth* | **Name:** `Authorization` · **Value:** `Bearer ` followed by the exact `N8N_WEBHOOK_SECRET` you set in Vercel (one space after *Bearer*) | 01, 02, 03, 04–16 |
| 2 | **SAFQA Telegram Bot** | *Telegram API* | **Access Token:** your `TELEGRAM_BOT_TOKEN` | 03 only |
| 3 | **SAFQA Inbound Webhook** | *Header Auth* | **Name:** `X-SAFQA-Key` · **Value:** a *new* random secret of 32+ characters (not the same as #1) | 02 only (optional) |
| 4 | Google Sheets account | *Google Sheets OAuth2* | Sign in with Google | 01 only (optional) |

The secret in #1 must match Vercel character for character. If it differs, SAFQA answers **401**. If it's missing or shorter than 24 characters on Vercel, SAFQA answers **503**.

## Step 2 — Import (n8n → Workflows → ⋯ / Add workflow → Import from File)
Import the 16 files from `workflows/` one at a time. After each import:
1. Open every node with a ⚠ warning (HTTP Request, Telegram Trigger, Webhook, Google Sheets). In **Credential**, choose the matching **SAFQA …** credential from Step 1. The files only contain a placeholder ID, so n8n asks you to choose.
2. **Save.** Leave the **Active** switch **off**.

## Step 3 — Test before activating (each workflow: open → **Execute workflow**)

| Order | Workflow | Expected result in the HTTP node output |
|---|---|---|
| 1 | **10 Job queue worker** | `{"ok":true,"ran":[]}` proves the URL and the SAFQA API credential work |
| 2 | **09 Daily research pipeline** | `"enqueued":true` and `ran[0].status = "succeeded"` |
| 3 | **11 Daily Telegram report** | Both nodes `ok:true`. The report reaches Telegram only if `TELEGRAM_OWNER_CHAT_ID` is set in Vercel (see note) |
| 4 | **16 Failed workflow alerts** | Can't be run manually; it fires on real errors |

If you see **401**, fix credential #1. **503** means set `N8N_WEBHOOK_SECRET` (24+ characters) in Vercel and redeploy. **429** means you sent too many requests in a minute; wait and retry. You can watch the results in SAFQA → **الإعدادات والتكاملات → المهام المجدولة والسجلات**.

> **Note:** add `TELEGRAM_OWNER_CHAT_ID` to Vercel to receive reports. Send `/start` to your bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` in your browser *before* activating workflow 03. Your chat id is `message.chat.id`. Redeploy after adding it.

## Step 4 — Error workflow
For every SAFQA workflow except 16: **Settings (⋯) → Error workflow → "SAFQA — 16 Failed workflow alerts" → Save**. Then activate workflow 16.

## Step 5 — Activate in this order (only after Step 3 passes)

| Phase | Workflows | Executions / month |
|---|---|---|
| **Start (recommended)** | 16 errors, 09 daily research (07:10), 11 daily report (08:00), 15 low stock (10:00), 12 notifications (hourly), 10 job worker (hourly) | ≈ 1,530 |
| **Telegram suppliers** | 03 (only after the bot is admin in supplier channels; see `docs/TELEGRAM_SETUP.md` in the repo) | 1 per supplier post |
| Later / optional | 05, 06, 07, 08 (already covered by 09 each morning), 01 (after connecting Google Sheets *and* enabling the Sheets node), 02 (only if you'll send data to its webhook) | 30–120 each |
| Only when ready | 04 AI extraction (needs `ANTHROPIC_API_KEY` in Vercel; 720/month), 13 content drafts, 14 publishing (needs Meta credentials; 1,440/month) | — |

All 16 active ≈ 4,000 scheduled executions a month. Check your plan's quota in **n8n → Settings → Usage** before activating the optional ones.

**Telegram:** activating 03 makes n8n own the bot's webhook (Telegram allows one per bot). Don't also set SAFQA's direct webhook.

## Workflow list
| File | What it does | Schedule (Cairo) |
|---|---|---|
| 01-scheduled-trend-ingestion | Research Google Sheet → SAFQA trends (Sheets node ships **disabled**) | 06:30 |
| 02-manual-url-csv-ingestion | Webhook `/webhook/safqa-manual-ingest` (header `X-SAFQA-Key`) for URLs/CSV → trends | on request |
| 03-telegram-supplier-feed | Supplier channel posts → SAFQA supplier offers | on each post |
| 04-ai-classification | Claude notes for uncertain supplier posts | hourly :15 |
| 05-duplicate-detection | Flag possible duplicate products | 06:40 |
| 06-retail-offer-comparison | Retail price ranges + scoring | 07:00 |
| 07-supplier-matching | Re-match unmatched supplier offers | 06:50 |
| 08-freshness-checks | Expire stale quotes/verifications | every 6 h |
| 09-daily-research-pipeline | Freshness → matching → duplicates → profitability → scores | 07:10 |
| 10-job-worker | Retries queued/failed jobs | hourly :25 |
| 11-daily-telegram-report | Arabic daily summary → Telegram | 08:00 |
| 12-owner-approval-notifications | Sends pending alerts/approvals to Telegram | hourly :05 |
| 13-content-draft-generation | Caption drafts for in-stock products (owner approves) | 09:00 |
| 14-approved-social-publishing | Publishes owner-approved posts (Meta) | every 30 min |
| 15-low-stock-warnings | Low-stock alerts | 10:00 |
| 16-failed-workflow-alerts | n8n errors → SAFQA dashboard + Telegram | on error |

n8n can't approve purchases, confirm supplier stock, pay, or publish unapproved posts. Those actions always need your login in SAFQA.

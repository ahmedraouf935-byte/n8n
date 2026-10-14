# Connecting n8n Cloud to SAFQA

## 1. Prepare SAFQA
- Deploy SAFQA and note its public URL, for example `https://safqa.example.com`.
- Set `N8N_WEBHOOK_SECRET` on the server. It must be 24 or more random characters, for example from `openssl rand -hex 24`.
- Check the connection: `curl -H "Authorization: Bearer <secret>" https://safqa.example.com/api/v1/health` should return `{"ok":true,...}`.

## 2. Generate the workflows with your URL
```bash
SAFQA_PUBLIC_URL=https://safqa.example.com npm run n8n:build
```
This rewrites `n8n/workflows/*.json`. The committed copies use the placeholder `https://YOUR-SAFQA-DOMAIN`.

## 3. Create the credentials in n8n
| Credential | Type | Value |
|---|---|---|
| **SAFQA API** | Header Auth | Name `Authorization`, Value `Bearer <N8N_WEBHOOK_SECRET>` |
| **SAFQA Inbound Webhook** | Header Auth | A *different* secret that you choose. Callers of workflow 02 must send it |
| **SAFQA Telegram Bot** | Telegram API | Bot token from @BotFather (only needed for workflow 03) |
| Google Sheets (optional) | Google OAuth | For workflow 01 |

## 4. Import the workflows
In n8n, go to **Workflows → Import from file** and import each JSON file. In every HTTP Request node, select the **SAFQA API** credential. On import n8n keeps the credential name but asks you to re-select it.

| File | Purpose | Schedule (Africa/Cairo) |
|---|---|---|
| 01-scheduled-trend-ingestion | Research sheet → trends. **Disabled node** until Sheets is connected | 06:30 daily |
| 02-manual-url-csv-ingestion | Authenticated webhook for URLs/CSV | on request |
| 03-telegram-supplier-feed | Telegram Trigger → supplier posts | real time |
| 04-ai-classification | Claude extraction notes for uncertain posts | hourly |
| 05-duplicate-detection | Flag possible duplicate products | 06:40 |
| 06-retail-offer-comparison | Price ranges, economics, scores | 07:00 |
| 07-supplier-matching | Re-match unmatched offers | 06:50 |
| 08-freshness-checks | Stale quotes / expired verifications | every 6 h |
| 09-daily-research-pipeline | Full morning pipeline (idempotent per day) | 07:10 |
| 10-job-worker | Run queued jobs with retries | every 15 min |
| 11-daily-telegram-report | Daily summary to the owner | 08:00 |
| 12-owner-approval-notifications | Send pending alerts/approvals | every 15 min |
| 13-content-draft-generation | Drafts for in-stock products | 09:00 |
| 14-approved-social-publishing | Publish approved due posts | every 30 min |
| 15-low-stock-warnings | Low stock alerts | 10:00 |
| 16-failed-workflow-alerts | Error Trigger → SAFQA alert | on failure |

## 5. Error handling
Open each workflow's **Settings → Error workflow** and select "SAFQA — 16 Failed workflow alerts". HTTP nodes retry 3 times, 5 s apart. SAFQA's own job queue retries with exponential backoff and alerts once a job has failed three times.

## 6. Telegram supplier channels
1. Create a bot with @BotFather and set `TELEGRAM_BOT_TOKEN`. Send the bot a message, then set `TELEGRAM_OWNER_CHAT_ID` to your chat id.
2. Add the bot as an **administrator** of each supplier channel you're allowed to monitor. For groups, the bot only sees all messages if privacy mode is disabled (BotFather → `/setprivacy`) or if it's an admin. Use only groups where the members and owner agree.
3. Find the channel's chat id (for example from the first update n8n receives) and enter it on the supplier's record in SAFQA (**Telegram chat ID**). **Posts from unregistered chats are ignored.**
4. Activate workflow 03. Only one webhook can exist per bot, so don't also configure SAFQA's direct `/api/telegram/webhook`.
5. In SAFQA, go to **الإعدادات ← اختبار تيليجرام** to check the bot.

## 7. Idempotency and safety
- Trend ingestion: the run-level `idempotencyKey` and per-item content hashes mean re-sent rows are counted as duplicates.
- Telegram: deduplicated by `(supplier, chat:message_id)`, plus a run key `tg-update:<update_id>`.
- Jobs: the idempotency key `jobType:<date or hour>` means a rerun on the same day does nothing.
- n8n can't approve purchases, record supplier verifications, pay, or mark posts published. Those actions need the owner's session.

# Telegram supplier-channel integration

SAFQA uses only the **official Telegram Bot API**. It doesn't use your personal account, doesn't scrape anything, and doesn't read private groups the bot hasn't been added to.

## What I need from you
1. **A bot.** Open @BotFather → `/newbot` → choose a name (e.g. `SAFQA Supplier Bot`) → copy the **token**. Put it only in the hosting environment as `TELEGRAM_BOT_TOKEN` and in the n8n "SAFQA Telegram Bot" credential. Never paste it in chat or commit it.
2. **Your owner chat id.** Send `/start` to the bot, then run `npm run telegram -- discover` on your computer (with the token in `.env`, and before any webhook is set). Your private chat id goes in `TELEGRAM_OWNER_CHAT_ID`.
3. **Access to each supplier source, chosen by you.** Only use channels and groups you are allowed to monitor:
   - **Supplier *channel*** (the usual wholesale catalog): ask the channel owner to add your bot as an **administrator** with no extra rights (it only needs to read). A bot can't join a channel by itself.
   - **Supplier *group***: add the bot as a member *and* either make it an admin or turn privacy mode off (@BotFather → `/setprivacy` → Disable). Otherwise it only sees commands and replies. Make sure the group owner agrees.
   - **Private chats/WhatsApp:** not possible via the bot. Forward supplier offers to the bot, or enter them manually in the dashboard.
4. **Register each source in SAFQA:** Suppliers → add or edit the supplier → **Telegram chat ID** (a channel id looks like `-100…`; `npm run telegram -- discover` lists ids once a post has arrived). **Posts from chats not registered on a supplier are ignored.**

## Choose one delivery mode (Telegram allows one webhook per bot)
- **Recommended: n8n.** Import and activate workflow `03-telegram-supplier-feed.json`. n8n registers the webhook itself, and every update is forwarded to `POST /api/v1/ingest/supplier-posts`.
- **Direct (no n8n):** set `TELEGRAM_WEBHOOK_SECRET` on the server and run `npm run telegram -- set-webhook https://<domain>/api/telegram/webhook`.

## Check that it works
```bash
npm run telegram -- check          # bot identity, privacy mode, active webhook + last error
npm run telegram -- test-message   # sends a test message to TELEGRAM_OWNER_CHAT_ID
```
In the dashboard, **الإعدادات ← اختبار تيليجرام** runs the same check and updates the integration status. Then post a real offer in a registered channel. It should appear within seconds in **الموردون ← صندوق مطابقة العروض** with the parsed price and minimum quantity, and any uncertainty flags.

## What SAFQA does with a post
- Stores the text, message id, date and post link (`t.me/<channel>/<id>`) as evidence. **Images are not copied.**
- Extracts price and minimum quantity. Dozen/carton pricing or multiple prices are **flagged as uncertain**, never guessed.
- Suggests a product match only when there's no conflicting size, capacity or model. You still confirm the match **and** call or WhatsApp the supplier to record availability before any purchase can be approved.

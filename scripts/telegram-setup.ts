import "./_env";

/**
 * Telegram helper (official Bot API only).
 *   npm run telegram -- check                 bot identity, privacy mode, current webhook
 *   npm run telegram -- discover              list chats the bot has seen (works only while NO webhook is set)
 *   npm run telegram -- test-message          send a test message to TELEGRAM_OWNER_CHAT_ID
 *   npm run telegram -- set-webhook <url>     direct mode: Telegram → SAFQA /api/telegram/webhook (instead of n8n)
 *   npm run telegram -- delete-webhook        remove webhook (e.g. before switching to n8n Telegram Trigger)
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}
async function call(method: string, body: Record<string, unknown> = {}) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result as Record<string, unknown> & unknown[];
}

const [cmd, arg] = process.argv.slice(2);
(async () => {
  switch (cmd) {
    case "check": {
      const me = await call("getMe");
      const wh = await call("getWebhookInfo");
      console.log(`Bot: @${me.username} (id ${me.id})`);
      console.log(`Reads all group messages (privacy off): ${me.can_read_all_group_messages}`);
      console.log(`Webhook: ${wh.url || "(none)"}${wh.last_error_message ? ` — last error: ${wh.last_error_message}` : ""}; pending updates: ${wh.pending_update_count}`);
      break;
    }
    case "discover": {
      const updates = (await call("getUpdates", { limit: 100, allowed_updates: ["message", "channel_post", "my_chat_member"] })) as unknown as Record<string, Record<string, Record<string, unknown>>>[];
      const chats = new Map<string, string>();
      for (const u of updates) {
        const m = u.channel_post ?? u.message ?? u.my_chat_member;
        const c = m?.chat as Record<string, unknown> | undefined;
        if (c) chats.set(String(c.id), `${c.type} — ${c.title ?? c.username ?? c.first_name ?? ""}${c.username ? ` (@${c.username})` : ""}`);
      }
      if (!chats.size) console.log("No chats seen yet. Add the bot as admin to a channel and post something, or send /start to the bot. (Requires no webhook set.)");
      for (const [id, desc] of chats) console.log(`${id}\t${desc}`);
      console.log("\nUse the private chat id as TELEGRAM_OWNER_CHAT_ID, and enter each supplier channel id on its supplier record in SAFQA.");
      break;
    }
    case "test-message": {
      const chat = process.env.TELEGRAM_OWNER_CHAT_ID;
      if (!chat) throw new Error("TELEGRAM_OWNER_CHAT_ID is not set");
      await call("sendMessage", { chat_id: chat, text: "✅ رسالة اختبار من صفقة — الاتصال يعمل." });
      console.log("Sent.");
      break;
    }
    case "set-webhook": {
      if (!arg?.startsWith("https://")) throw new Error("Usage: set-webhook https://<your-domain>/api/telegram/webhook");
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
      if (!secret || secret.length < 16) throw new Error("Set TELEGRAM_WEBHOOK_SECRET (16+ chars) here AND on the server first");
      await call("setWebhook", { url: arg, secret_token: secret, allowed_updates: ["channel_post", "message", "edited_channel_post"], drop_pending_updates: false });
      console.log("Webhook set.");
      break;
    }
    case "delete-webhook":
      await call("deleteWebhook", { drop_pending_updates: false });
      console.log("Webhook deleted.");
      break;
    default:
      console.log("Commands: check | discover | test-message | set-webhook <url> | delete-webhook");
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

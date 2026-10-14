/**
 * Telegram Bot API adapter (official API: https://core.telegram.org/bots/api).
 * Capabilities used: sendMessage (owner reports/alerts), getMe (health check),
 * channel_post/message updates (supplier channels where the bot is an admin / group member).
 * Limits: ~30 msgs/sec globally, 1 msg/sec per chat; a bot cannot read chats it is not a member of,
 * and in groups with privacy mode ON it only sees commands/replies.
 */
export interface TelegramConfig {
  token: string | undefined;
  ownerChatId: string | undefined;
}

export function telegramConfig(): TelegramConfig {
  return { token: process.env.TELEGRAM_BOT_TOKEN || undefined, ownerChatId: process.env.TELEGRAM_OWNER_CHAT_ID || undefined };
}

export function telegramEnabled(c = telegramConfig()) {
  return !!(c.token && c.ownerChatId);
}

export class TelegramError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

async function call<T>(method: string, body: Record<string, unknown>, c = telegramConfig()): Promise<T> {
  if (!c.token) throw new TelegramError("TELEGRAM_BOT_TOKEN is not configured");
  const res = await fetch(`https://api.telegram.org/bot${c.token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!res.ok || !json.ok) throw new TelegramError(json.description ?? `Telegram HTTP ${res.status}`, res.status);
  return json.result as T;
}

export async function sendTelegramMessage(text: string, chatId?: string, c = telegramConfig()) {
  const target = chatId ?? c.ownerChatId;
  if (!target) throw new TelegramError("TELEGRAM_OWNER_CHAT_ID is not configured");
  // Telegram hard limit is 4096 chars per message
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 4000) chunks.push(text.slice(i, i + 4000));
  const ids: number[] = [];
  for (const chunk of chunks) {
    const r = await call<{ message_id: number }>("sendMessage", { chat_id: target, text: chunk, disable_web_page_preview: true }, c);
    ids.push(r.message_id);
  }
  return ids;
}

export async function telegramHealth(c = telegramConfig()) {
  const me = await call<{ username: string; can_read_all_group_messages: boolean }>("getMe", {}, c);
  return { username: me.username, canReadAllGroupMessages: me.can_read_all_group_messages };
}

/** Normalizes a Telegram Update into the supplier-post shape used by ingestTelegramPosts. */
export function updateToSupplierPost(update: Record<string, unknown>) {
  const msg = (update.channel_post ?? update.message ?? update.edited_channel_post) as
    | { message_id: number; date: number; text?: string; caption?: string; photo?: unknown[]; chat: { id: number; title?: string; username?: string } }
    | undefined;
  if (!msg) return null;
  return {
    chatId: String(msg.chat.id),
    chatTitle: msg.chat.title ?? null,
    chatUsername: msg.chat.username ?? null,
    messageId: String(msg.message_id),
    date: msg.date,
    text: msg.text ?? msg.caption ?? "",
    hasPhoto: Array.isArray(msg.photo) && msg.photo.length > 0,
  };
}

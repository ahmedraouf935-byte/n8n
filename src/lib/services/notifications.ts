import type { Db } from "../db/client";
import { sendTelegramMessage, telegramEnabled } from "../adapters/telegram";

export async function notify(db: Db, n: {
  kind: string; title: string; body: string; severity?: "info" | "warning" | "critical"; channel?: "telegram" | "dashboard"; dedupeKey?: string;
}) {
  const [row] = await db<{ id: number }[]>`
    INSERT INTO notifications (channel, kind, severity, title, body, dedupe_key)
    VALUES (${n.channel ?? "dashboard"}, ${n.kind}, ${n.severity ?? "info"}, ${n.title}, ${n.body}, ${n.dedupeKey ?? null})
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`;
  return row?.id ?? null;
}

/**
 * Sends pending Telegram notifications. If Telegram is not configured they are marked "skipped"
 * (visible in the dashboard) — never silently marked as sent.
 */
export async function dispatchPendingTelegram(db: Db) {
  const pending = await db<{ id: number; title: string; body: string }[]>`
    SELECT id, title, body FROM notifications WHERE channel = 'telegram' AND status = 'pending' ORDER BY id LIMIT 20`;
  const result = { sent: 0, failed: 0, skipped: 0 };
  for (const n of pending) {
    if (!telegramEnabled()) {
      await db`UPDATE notifications SET status = 'skipped', error = 'Telegram not configured' WHERE id = ${n.id}`;
      result.skipped++;
      continue;
    }
    try {
      await sendTelegramMessage(`${n.title}\n\n${n.body}`);
      await db`UPDATE notifications SET status = 'sent', sent_at = now(), error = NULL WHERE id = ${n.id}`;
      result.sent++;
    } catch (e) {
      await db`UPDATE notifications SET status = 'failed', error = ${(e as Error).message} WHERE id = ${n.id}`;
      result.failed++;
    }
  }
  if (result.failed) await setIntegrationStatus(db, "telegram", "error", `فشل إرسال ${result.failed} رسالة`);
  else if (result.sent) await setIntegrationStatus(db, "telegram", "connected", null);
  return result;
}

export async function setIntegrationStatus(db: Db, code: string, status: "connected" | "disabled" | "pending_credentials" | "error" | "not_available", error: string | null, details?: object) {
  await db`UPDATE integration_status SET status = ${status}, last_check_at = now(),
           last_success_at = CASE WHEN ${status} = 'connected' THEN now() ELSE last_success_at END,
           last_error = ${error}, details = COALESCE(${details ? db.json(details as never) : null}, details), updated_at = now()
           WHERE code = ${code}`;
}

import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getSql } from "@/lib/db/client";
import { updateToSupplierPost } from "@/lib/adapters/telegram";
import { ingestTelegramPosts } from "@/lib/services/suppliers";

/**
 * Optional direct Telegram webhook (alternative to the n8n Telegram Trigger — use only one,
 * Telegram allows a single webhook per bot). Authenticated with the secret_token set in setWebhook.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!expected || got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const update = (await req.json()) as Record<string, unknown>;
  const post = updateToSupplierPost(update);
  if (post) {
    try {
      await ingestTelegramPosts(getSql(), { id: null, label: "telegram" }, [post], `tg-update:${String(update.update_id)}`);
    } catch (e) {
      console.error("[telegram webhook]", e);
    }
  }
  // Always 200 so Telegram doesn't retry forever; failures are visible in ingestion_runs.
  return NextResponse.json({ ok: true });
}

import { machineRoute } from "@/lib/auth/apiAuth";
import { getSql } from "@/lib/db/client";
import { buildDailySummary } from "@/lib/services/reports";

export const dynamic = "force-dynamic";

/** Daily summary text built from recorded data — n8n can forward it to Telegram. */
export const GET = machineRoute(async () => ({ text: await buildDailySummary(getSql()) }));

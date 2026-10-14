import { z } from "zod";
import { machineRoute } from "@/lib/auth/apiAuth";
import { getSql } from "@/lib/db/client";
import { notify } from "@/lib/services/notifications";

const Body = z.object({
  workflow: z.string().max(200),
  node: z.string().max(200).optional(),
  message: z.string().max(2000),
  executionId: z.string().max(100).optional(),
  integration: z.enum(["n8n", "telegram", "meta", "ai", "google_sheets"]).optional(),
});

/** n8n Error Trigger → visible alert in the dashboard and Telegram (never silent). */
export const POST = machineRoute(async (req) => {
  const b = Body.parse(await req.json());
  const sql = getSql();
  const id = await notify(sql, {
    kind: "workflow_failed", severity: "critical", channel: "telegram",
    dedupeKey: b.executionId ? `n8n:${b.executionId}` : undefined,
    title: `فشل workflow: ${b.workflow}`, body: `${b.node ? `العقدة: ${b.node}\n` : ""}${b.message}`,
  });
  if (b.integration) {
    await sql`UPDATE integration_status SET status = 'error', last_error = ${b.message}, last_check_at = now() WHERE code = ${b.integration}`;
  }
  return { notificationId: id };
});

import { z } from "zod";
import { machineRoute, N8N_ACTOR } from "@/lib/auth/apiAuth";
import { getSql } from "@/lib/db/client";
import { consumeQuota, getSource } from "@/lib/services/ingestion";
import { ingestTrendSignals } from "@/lib/services/trends";

const Body = z.object({
  source: z.string().default("n8n_webhook"),
  method: z.enum(["api", "csv_import", "webhook", "third_party", "manual_entry"]).default("webhook"),
  idempotencyKey: z.string().max(200).optional(),
  items: z.array(z.unknown()).max(200),
});

/** n8n → SAFQA: batch of trend signals. Each item follows TrendSignalInput (see docs/API.md). */
export const POST = machineRoute(async (req) => {
  const b = Body.parse(await req.json());
  const sql = getSql();
  const source = await getSource(sql, b.source);
  await consumeQuota(sql, source.id, 1);
  return ingestTrendSignals(sql, N8N_ACTOR, { sourceCode: b.source, method: b.method, items: b.items, idempotencyKey: b.idempotencyKey });
});

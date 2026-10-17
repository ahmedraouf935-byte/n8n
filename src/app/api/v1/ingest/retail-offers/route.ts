import { z } from "zod";
import { machineRoute, N8N_ACTOR } from "@/lib/auth/apiAuth";
import { getSql } from "@/lib/db/client";
import { DomainError } from "@/lib/services/errors";
import { addRetailOffer } from "@/lib/services/retail";
import { refreshOpportunity } from "@/lib/services/analysis";

// Allows long-running jobs on Vercel (Hobby max 60 s).
export const maxDuration = 60;

const Body = z.object({ items: z.array(z.unknown()).max(100) });

/**
 * n8n → SAFQA: retail price observations for KNOWN variants (variantId required).
 * Offers arrive as "unreviewed"/"probable"/"mismatch" — never auto-confirmed as exact.
 */
export const POST = machineRoute(async (req) => {
  const { items } = Body.parse(await req.json());
  const sql = getSql();
  const results: { index: number; id?: number; matchStatus?: string; error?: string }[] = [];
  const touched = new Set<number>();
  for (const [index, item] of items.entries()) {
    try {
      const r = await addRetailOffer(sql, N8N_ACTOR, item, "webhook");
      results.push({ index, ...r });
      touched.add((item as { variantId: number }).variantId);
    } catch (e) {
      results.push({ index, error: e instanceof DomainError ? e.message : (e as Error).message });
    }
  }
  for (const v of touched) await refreshOpportunity(sql, v);
  return { created: results.filter((r) => r.id).length, results };
});

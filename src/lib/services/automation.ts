import type { Sql } from "../db/client";
import { aiEnabled, AiUnavailable, extractSupplierPost } from "../adapters/ai";
import { SYSTEM } from "./audit";
import { generateDrafts } from "./marketing";
import { notify } from "./notifications";
import { matchCandidatesForOffer } from "./suppliers";

/** Re-runs matching for unmatched supplier offers (new products may have been added since). Suggests only. */
export async function matchSupplierOffers(sql: Sql) {
  const offers = await sql<{ id: number }[]>`SELECT id FROM supplier_offers WHERE match_status = 'unmatched' AND status NOT IN ('rejected','unavailable') ORDER BY id DESC LIMIT 200`;
  let suggested = 0;
  for (const o of offers) {
    const best = (await matchCandidatesForOffer(sql, o.id, 3)).find((c) => c.match.decision === "probable");
    if (best) {
      await sql`UPDATE supplier_offers SET variant_id = ${best.variant.id}, match_status = 'probable', match_confidence = ${best.match.similarity} WHERE id = ${o.id} AND match_status = 'unmatched'`;
      suggested++;
    }
  }
  return { checked: offers.length, suggested };
}

/** Flags likely duplicate products for owner review (never merges automatically). */
export async function detectDuplicateProducts(sql: Sql) {
  const pairs = await sql<{ a: number; b: number; an: string; bn: string; sim: number }[]>`
    SELECT p1.id AS a, p2.id AS b, p1.name_ar AS an, p2.name_ar AS bn, similarity(p1.normalized_key, p2.normalized_key) AS sim
    FROM products p1 JOIN products p2 ON p1.id < p2.id AND p1.normalized_key % p2.normalized_key
    WHERE p1.status <> 'rejected' AND p2.status <> 'rejected' AND similarity(p1.normalized_key, p2.normalized_key) >= 0.6 LIMIT 50`;
  for (const p of pairs) {
    await notify(sql, { kind: "possible_duplicate", channel: "dashboard", severity: "info", dedupeKey: `dup:${p.a}:${p.b}`,
      title: "منتجان قد يكونان مكررين", body: `${p.an} ↔ ${p.bn} (تشابه ${Math.round(p.sim * 100)}٪). راجع المواصفات — لا يتم الدمج آليًا.` });
  }
  return { pairs: pairs.length };
}

/**
 * Uses Claude to extract structured details from uncertain supplier posts. The result is stored as an
 * evidence NOTE only — it never overwrites the quoted price or marks anything verified.
 */
export async function aiExtractSupplierPosts(sql: Sql) {
  if (!aiEnabled()) return { skipped: "ANTHROPIC_API_KEY not configured" };
  const offers = await sql<{ id: number; title_raw: string; evidence_note: string | null }[]>`
    SELECT id, title_raw, evidence_note FROM supplier_offers
    WHERE (price_uncertain OR quoted_price IS NULL) AND status = 'unverified' AND (evidence_note IS NULL OR evidence_note NOT LIKE '%[AI]%')
    ORDER BY id DESC LIMIT 10`;
  let done = 0;
  for (const o of offers) {
    try {
      const x = await extractSupplierPost(sql, o.title_raw);
      const note = `[AI] ${x.product_name_ar}${x.unit_price_egp ? ` · سعر مذكور ${x.unit_price_egp}` : ""} · أساس السعر: ${x.price_basis}${x.missing_info.length ? ` · ناقص: ${x.missing_info.join("، ")}` : ""}`;
      await sql`UPDATE supplier_offers SET evidence_note = ${[o.evidence_note, note].filter(Boolean).join(" | ")} WHERE id = ${o.id}`;
      done++;
    } catch (e) {
      if (e instanceof AiUnavailable) return { processed: done, stopped: e.message };
      throw e;
    }
  }
  return { processed: done };
}

/** Creates caption drafts for in-stock testing/active products that have none yet (owner approval still required). */
export async function generateContentDrafts(sql: Sql) {
  const rows = await sql<{ id: number; price: number | null }[]>`
    SELECT v.id, COALESCE(o.owner_price, o.recommended_price) AS price FROM product_variants v
    JOIN products p ON p.id = v.product_id JOIN inventory_levels l ON l.variant_id = v.id LEFT JOIN opportunities o ON o.variant_id = v.id
    WHERE p.status IN ('testing','active') AND l.on_hand - l.reserved > 0
      AND NOT EXISTS (SELECT 1 FROM marketing_assets m WHERE m.variant_id = v.id AND m.asset_type = 'caption' AND m.status IN ('draft','approved'))
    LIMIT 5`;
  let created = 0;
  for (const r of rows) {
    if (!r.price) continue;
    await generateDrafts(sql, SYSTEM, r.id, r.price);
    created++;
  }
  return { created };
}

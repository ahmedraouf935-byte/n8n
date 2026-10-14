import { z } from "zod";
import type { Db } from "../db/client";
import { matchListing } from "../domain/normalize";
import { computeRetailStats, type RetailOfferInput } from "../domain/pricing";
import { audit, type Actor } from "./audit";
import { DomainError } from "./errors";
import { getSource, recordObservation, type CollectionMethod } from "./ingestion";
import { getVariantFull, variantMatchText } from "./catalog";

/**
 * Egyptian retail price research. Offers are captured with URL + timestamp + method.
 * A listed price is never treated as a transaction price; `observed_transaction` must be entered explicitly.
 */
export const RetailOfferInputSchema = z.object({
  variantId: z.number().int().positive(),
  retailer: z.enum(["amazon_eg", "noon", "jumia", "facebook_page", "instagram_shop", "website", "other"]),
  sellerName: z.string().max(200).optional().nullable(),
  url: z.string().url(),
  titleRaw: z.string().max(400).optional().nullable(),
  listedPrice: z.number().positive(),
  originalPrice: z.number().positive().optional().nullable(),
  shippingCost: z.number().min(0).optional().nullable(),
  priceType: z.enum(["listed", "promotional", "historical", "observed_transaction"]).default("listed"),
  availability: z.enum(["in_stock", "out_of_stock", "unknown"]).default("unknown"),
  observedAt: z.coerce.date().optional(),
});
export type RetailOfferInputT = z.infer<typeof RetailOfferInputSchema>;

const RETAILER_SOURCE: Record<string, string> = { amazon_eg: "amazon_eg", noon: "noon_eg", jumia: "jumia_eg" };

export async function addRetailOffer(db: Db, actor: Actor, raw: unknown, method: CollectionMethod = "manual_entry") {
  const o = RetailOfferInputSchema.parse(raw);
  const variant = await getVariantFull(db, o.variantId);
  if (!variant) throw new DomainError("المنتج غير موجود");
  const source = await getSource(db, RETAILER_SOURCE[o.retailer] ?? (method === "webhook" ? "n8n_webhook" : "manual_entry"));
  const observedAt = o.observedAt ?? new Date();

  // Automatic match pre-check against the variant's distinguishing attributes. A conflict is stored as mismatch;
  // anything else stays "unreviewed"/"probable" until the owner confirms it is the exact same variant.
  let matchStatus: "mismatch" | "probable" | "unreviewed" = "unreviewed";
  let matchConfidence = 0;
  if (o.titleRaw) {
    const m = matchListing(o.titleRaw, variantMatchText(variant));
    matchConfidence = m.similarity;
    matchStatus = m.decision === "conflict" ? "mismatch" : m.decision === "probable" ? "probable" : "unreviewed";
  }
  const obsId = await recordObservation(db, {
    sourceId: source.id, runId: null, type: "retail_offer", payload: o as unknown as Record<string, unknown>, sourceUrl: o.url,
    collectedAt: new Date(), method, hashBasis: { v: o.variantId, url: o.url, price: o.listedPrice, at: observedAt.toISOString() },
  });
  const [row] = await db<{ id: number }[]>`
    INSERT INTO retail_offers (variant_id, source_id, raw_observation_id, retailer, seller_name, url, title_raw, listed_price, original_price,
      shipping_cost, price_type, availability, match_status, match_confidence, collection_method, observed_at)
    VALUES (${o.variantId}, ${source.id}, ${obsId}, ${o.retailer}, ${o.sellerName ?? null}, ${o.url}, ${o.titleRaw ?? null}, ${o.listedPrice},
      ${o.originalPrice ?? null}, ${o.shippingCost ?? null}, ${o.priceType}, ${o.availability}, ${matchStatus}, ${matchConfidence}, ${method}, ${observedAt})
    ON CONFLICT (variant_id, url, observed_at) DO NOTHING
    RETURNING id`;
  if (!row) throw new DomainError("هذا العرض مسجل بالفعل بنفس الرابط والتوقيت", "duplicate_offer");
  await audit(db, actor, "retail_offer.create", "retail_offers", row.id, null, { ...o, matchStatus });
  return { id: row.id, matchStatus };
}

export async function setRetailMatch(db: Db, actor: Actor, offerId: number, status: "exact" | "probable" | "mismatch") {
  await db`UPDATE retail_offers SET match_status = ${status}, match_confidence = ${status === "exact" ? 1 : status === "mismatch" ? 0 : 0.6} WHERE id = ${offerId}`;
  await audit(db, actor, "retail_offer.match", "retail_offers", offerId, null, { status });
}

export async function listRetailOffers(db: Db, variantId: number) {
  return db<{
    id: number; retailer: string; seller_name: string | null; url: string; title_raw: string | null; listed_price: number;
    original_price: number | null; shipping_cost: number | null; price_type: RetailOfferInput["priceType"];
    availability: "in_stock" | "out_of_stock" | "unknown"; match_status: RetailOfferInput["matchStatus"]; match_confidence: number;
    collection_method: string; observed_at: Date;
  }[]>`SELECT * FROM retail_offers WHERE variant_id = ${variantId} ORDER BY observed_at DESC`;
}

export async function retailStatsForVariant(db: Db, variantId: number, freshDays: number, now = new Date()) {
  const offers = await listRetailOffers(db, variantId);
  const stats = computeRetailStats(
    offers.map((o) => ({
      id: o.id, listedPrice: o.listed_price, shippingCost: o.shipping_cost, priceType: o.price_type, matchStatus: o.match_status,
      observedAt: o.observed_at, url: o.url, sellerName: o.seller_name, availability: o.availability,
    })),
    { now, freshDays },
  );
  const usableIds = new Set(stats.usable.map((u) => u.id));
  // Persist outlier flags so the table shows what was excluded and why.
  await db`UPDATE retail_offers SET is_outlier = (id = ANY(${stats.excluded.filter((e) => e.excludedReason === "قيمة شاذة").map((e) => e.id!)}::bigint[]))
           WHERE variant_id = ${variantId}`;
  return { offers, stats, usableIds };
}

import { z } from "zod";
import type { Db } from "../db/client";
import { matchListing } from "../domain/normalize";
import { parseSupplierPost, productText } from "../domain/supplierPost";
import { supplierOfferStatus } from "../domain/trust";
import { addDays } from "../domain/time";
import { audit, type Actor } from "./audit";
import { DomainError } from "./errors";
import { finishRun, getSource, recordObservation, startRun } from "./ingestion";
import { getSettings } from "./settings";
import { variantMatchText } from "./catalog";

export const SupplierSchema = z.object({
  name: z.string().min(2).max(200),
  shopName: z.string().max(200).optional().nullable(),
  marketArea: z.enum(["mosky", "ataba", "other_cairo", "other_egypt", "online"]).default("other_cairo"),
  address: z.string().max(500).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  whatsapp: z.string().max(30).optional().nullable(),
  telegramHandle: z.string().max(100).optional().nullable(),
  telegramChatId: z.string().max(40).optional().nullable(),
  returnPolicy: z.string().max(1000).optional().nullable(),
  pickupOptions: z.string().max(500).optional().nullable(),
  deliveryOptions: z.string().max(500).optional().nullable(),
  reliabilityRating: z.number().min(0).max(5).optional().nullable(),
  reliabilityNotes: z.string().max(2000).optional().nullable(),
});

export async function createSupplier(db: Db, actor: Actor, raw: unknown) {
  const s = SupplierSchema.parse(raw);
  const [row] = await db<{ id: number }[]>`
    INSERT INTO suppliers (name, shop_name, market_area, address, phone, whatsapp, telegram_handle, telegram_chat_id, return_policy,
      pickup_options, delivery_options, reliability_rating, reliability_notes)
    VALUES (${s.name}, ${s.shopName ?? null}, ${s.marketArea}, ${s.address ?? null}, ${s.phone ?? null}, ${s.whatsapp ?? null},
      ${s.telegramHandle ?? null}, ${s.telegramChatId ?? null}, ${s.returnPolicy ?? null}, ${s.pickupOptions ?? null},
      ${s.deliveryOptions ?? null}, ${s.reliabilityRating ?? null}, ${s.reliabilityNotes ?? null})
    RETURNING id`;
  await audit(db, actor, "supplier.create", "suppliers", row.id, null, s);
  return row.id;
}

export const SupplierOfferSchema = z.object({
  supplierId: z.number().int().positive(),
  variantId: z.number().int().positive().optional().nullable(),
  titleRaw: z.string().min(2).max(1000),
  quotedPrice: z.number().positive().optional().nullable(),
  priceUncertain: z.boolean().default(false),
  minOrderQty: z.number().int().min(1).default(1),
  sourceUrl: z.string().url().optional().nullable(),
  sourcePostId: z.string().max(100).optional().nullable(),
  evidenceNote: z.string().max(2000).optional().nullable(),
  quotedAt: z.coerce.date().optional(),
});

export async function addSupplierOffer(db: Db, actor: Actor, raw: unknown, opts: { sourceCode?: string; rawObservationId?: number | null } = {}) {
  const o = SupplierOfferSchema.parse(raw);
  const settings = await getSettings(db);
  const source = await getSource(db, opts.sourceCode ?? "manual_entry");
  const [row] = await db<{ id: number }[]>`
    INSERT INTO supplier_offers (supplier_id, variant_id, source_id, raw_observation_id, title_raw, quoted_price, price_uncertain, min_order_qty,
      source_url, source_post_id, evidence_note, quoted_at, stale_after_days, match_status, match_confidence)
    VALUES (${o.supplierId}, ${o.variantId ?? null}, ${source.id}, ${opts.rawObservationId ?? null}, ${o.titleRaw}, ${o.quotedPrice ?? null},
      ${o.priceUncertain}, ${o.minOrderQty}, ${o.sourceUrl ?? null}, ${o.sourcePostId ?? null}, ${o.evidenceNote ?? null},
      ${o.quotedAt ?? new Date()}, ${settings.freshness.supplier_offer_stale_days},
      ${o.variantId ? "probable" : "unmatched"}, ${o.variantId ? 0.5 : 0})
    ON CONFLICT (supplier_id, source_post_id) WHERE source_post_id IS NOT NULL DO NOTHING
    RETURNING id`;
  if (!row) return null; // same Telegram post already captured
  await audit(db, actor, "supplier_offer.create", "supplier_offers", row.id, null, o);
  return row.id;
}

/** Candidate variants for an unmatched supplier offer, ranked; conflicts are listed but never auto-linked. */
export async function matchCandidatesForOffer(db: Db, offerId: number, limit = 8) {
  const [offer] = await db<{ title_raw: string }[]>`SELECT title_raw FROM supplier_offers WHERE id = ${offerId}`;
  if (!offer) throw new DomainError("عرض المورد غير موجود");
  const variants = await db<{ id: number; sku: string; label: string; name_ar: string; name_en: string | null; capacity: string | null;
    dimensions: string | null; model_number: string | null; material: string | null; color: string | null }[]>`
    SELECT v.id, v.sku, v.label, p.name_ar, p.name_en, v.capacity, v.dimensions, v.model_number, v.material, v.color
    FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.status NOT IN ('rejected','stopped')`;
  return variants
    .map((v) => ({ variant: v, match: matchListing(productText(offer.title_raw), variantMatchText(v)) }))
    .filter((x) => x.match.decision !== "different")
    .sort((a, b) => b.match.similarity - a.match.similarity)
    .slice(0, limit);
}

/** Owner links an offer to a variant. `confirmed` means the owner checked it is the exact same item. */
export async function setOfferMatch(db: Db, actor: Actor, offerId: number, variantId: number | null, status: "probable" | "confirmed" | "mismatch" | "unmatched") {
  if (status === "confirmed" && !variantId) throw new DomainError("يجب اختيار المنتج لتأكيد التطابق");
  await db`UPDATE supplier_offers SET variant_id = ${variantId}, match_status = ${status},
           match_confidence = ${status === "confirmed" ? 1 : status === "probable" ? 0.6 : 0} WHERE id = ${offerId}`;
  await audit(db, actor, "supplier_offer.match", "supplier_offers", offerId, null, { variantId, status });
}

export const VerificationSchema = z.object({
  supplierOfferId: z.number().int().positive(),
  method: z.enum(["phone", "whatsapp", "in_person", "telegram", "other"]),
  result: z.enum(["available", "unavailable", "partial", "price_changed"]),
  confirmedPrice: z.number().positive().optional().nullable(),
  confirmedQuantity: z.number().int().min(0).optional().nullable(),
  confirmedMoq: z.number().int().min(1).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  evidenceUrl: z.string().url().optional().nullable(),
  validDays: z.number().int().min(1).max(30).optional(),
});

/**
 * Records a HUMAN confirmation of availability/price. Requires a real user (actor.id);
 * neither the AI nor n8n can create verifications.
 */
export async function recordVerification(db: Db, actor: Actor, raw: unknown) {
  if (!actor.id) throw new DomainError("تأكيد التوفر يجب أن يسجله المالك بنفسه", "human_required");
  const v = VerificationSchema.parse(raw);
  if ((v.result === "available" || v.result === "partial" || v.result === "price_changed") && !v.confirmedPrice)
    throw new DomainError("أدخل السعر الذي أكده المورد");
  const settings = await getSettings(db);
  const now = new Date();
  const validUntil = addDays(now, v.validDays ?? settings.freshness.verification_valid_days);
  const [row] = await db<{ id: number }[]>`
    INSERT INTO availability_verifications (supplier_offer_id, verified_by, method, result, confirmed_price, confirmed_quantity, confirmed_moq,
      notes, evidence_url, verified_at, valid_until)
    VALUES (${v.supplierOfferId}, ${actor.id}, ${v.method}, ${v.result}, ${v.confirmedPrice ?? null}, ${v.confirmedQuantity ?? null},
      ${v.confirmedMoq ?? null}, ${v.notes ?? null}, ${v.evidenceUrl ?? null}, ${now}, ${validUntil})
    RETURNING id`;
  const status = v.result === "unavailable" ? "unavailable" : "verified";
  await db`UPDATE supplier_offers SET status = ${status},
           quoted_price = COALESCE(${v.confirmedPrice ?? null}, quoted_price), price_uncertain = CASE WHEN ${v.confirmedPrice ?? null}::numeric IS NULL THEN price_uncertain ELSE false END,
           min_order_qty = COALESCE(${v.confirmedMoq ?? null}, min_order_qty)
           WHERE id = ${v.supplierOfferId}`;
  await db`UPDATE suppliers SET last_contact_at = ${now} WHERE id = (SELECT supplier_id FROM supplier_offers WHERE id = ${v.supplierOfferId})`;
  await audit(db, actor, "supplier_offer.verify", "availability_verifications", row.id, null, v);
  return row.id;
}

export async function latestVerification(db: Db, offerId: number) {
  const [v] = await db<{ id: number; result: "available" | "unavailable" | "partial" | "price_changed"; confirmed_price: number | null;
    confirmed_quantity: number | null; confirmed_moq: number | null; verified_at: Date; valid_until: Date; method: string; notes: string | null }[]>`
    SELECT id, result, confirmed_price, confirmed_quantity, confirmed_moq, verified_at, valid_until, method, notes
    FROM availability_verifications WHERE supplier_offer_id = ${offerId} ORDER BY verified_at DESC, id DESC LIMIT 1`;
  return v ?? null;
}

/** Marks offers stale/unverified according to their age and verification validity. Idempotent. */
export async function refreshOfferFreshness(db: Db, now = new Date()) {
  const offers = await db<{ id: number; quoted_at: Date; stale_after_days: number; status: string }[]>`
    SELECT id, quoted_at, stale_after_days, status FROM supplier_offers WHERE status IN ('unverified','verified','stale')`;
  let changed = 0;
  for (const o of offers) {
    const latest = await latestVerification(db, o.id);
    const eff = supplierOfferStatus({ quotedAt: o.quoted_at, staleAfterDays: o.stale_after_days, status: o.status },
      latest && { result: latest.result, validUntil: latest.valid_until, verifiedAt: latest.verified_at }, now);
    if (eff !== o.status) {
      await db`UPDATE supplier_offers SET status = ${eff} WHERE id = ${o.id}`;
      changed++;
    }
  }
  return { checked: offers.length, changed };
}

export const TelegramPostSchema = z.object({
  chatId: z.union([z.string(), z.number()]).transform(String),
  chatTitle: z.string().optional().nullable(),
  chatUsername: z.string().optional().nullable(),
  messageId: z.union([z.string(), z.number()]).transform(String),
  date: z.union([z.number(), z.string()]),          // unix seconds (Telegram) or ISO
  text: z.string().default(""),
  hasPhoto: z.boolean().default(false),
});

/**
 * Ingest posts from AUTHORIZED Telegram supplier channels/groups.
 * Only chats registered on a supplier record (telegram_chat_id) are accepted; others are ignored.
 * Images are not copied — only the post link is kept as evidence.
 */
export async function ingestTelegramPosts(db: Db, actor: Actor, posts: unknown[], idempotencyKey?: string | null) {
  const source = await getSource(db, "telegram_suppliers");
  const run = await startRun(db, { sourceId: source.id, jobType: "telegram_ingest", idempotencyKey, triggeredBy: actor.label });
  const result = { runId: run.id, received: posts.length, created: 0, duplicate: 0, ignored: 0, failed: 0, offers: [] as { offerId: number; flags: string[]; candidates: number }[] };
  if (run.duplicate) return { ...result, duplicate: posts.length };

  for (const raw of posts) {
    const parsed = TelegramPostSchema.safeParse(raw);
    if (!parsed.success) { result.failed++; continue; }
    const p = parsed.data;
    const [supplier] = await db<{ id: number }[]>`SELECT id FROM suppliers WHERE telegram_chat_id = ${p.chatId} AND is_active`;
    if (!supplier) { result.ignored++; continue; }
    if (!p.text.trim()) { result.ignored++; continue; }

    const postedAt = typeof p.date === "number" ? new Date(p.date * 1000) : new Date(p.date);
    const url = p.chatUsername ? `https://t.me/${p.chatUsername}/${p.messageId}` : null;
    const obsId = await recordObservation(db, {
      sourceId: source.id, runId: run.id, type: "supplier_post", payload: p as unknown as Record<string, unknown>, sourceUrl: url,
      externalId: `${p.chatId}:${p.messageId}`, collectedAt: new Date(), method: "telegram_bot",
      hashBasis: { chat: p.chatId, msg: p.messageId, text: p.text },
    });
    if (obsId === null) { result.duplicate++; continue; }

    const parsedPost = parseSupplierPost(p.text);
    const offerId = await addSupplierOffer(db, actor, {
      supplierId: supplier.id, titleRaw: p.text.slice(0, 1000), quotedPrice: parsedPost.price, priceUncertain: parsedPost.priceUncertain || parsedPost.price === null,
      minOrderQty: parsedPost.minOrderQty ?? 1, sourceUrl: url, sourcePostId: `${p.chatId}:${p.messageId}`,
      evidenceNote: parsedPost.flags.join(" | ") || null, quotedAt: postedAt,
    }, { sourceCode: "telegram_suppliers", rawObservationId: obsId });
    await db`UPDATE raw_observations SET processing_status = ${offerId ? "processed" : "ignored"}, processed_at = now() WHERE id = ${obsId}`;
    if (!offerId) { result.duplicate++; continue; }

    // Suggest (never confirm) the best non-conflicting match.
    const candidates = await matchCandidatesForOffer(db, offerId, 3);
    const best = candidates.find((c) => c.match.decision === "probable");
    if (best) await db`UPDATE supplier_offers SET variant_id = ${best.variant.id}, match_status = 'probable', match_confidence = ${best.match.similarity} WHERE id = ${offerId}`;
    result.created++;
    result.offers.push({ offerId, flags: parsedPost.flags, candidates: candidates.length });
  }
  await finishRun(db, run.id, { received: result.received, created: result.created, duplicate: result.duplicate + result.ignored, failed: result.failed });
  return result;
}

export async function listSupplierOffersForVariant(db: Db, variantId: number) {
  return db<{ id: number; supplier_id: number; supplier_name: string; market_area: string; reliability_rating: number | null; title_raw: string;
    quoted_price: number | null; price_uncertain: boolean; min_order_qty: number; source_url: string | null; evidence_note: string | null;
    quoted_at: Date; stale_after_days: number; status: string; match_status: string; match_confidence: number; phone: string | null; whatsapp: string | null }[]>`
    SELECT o.*, s.name AS supplier_name, s.market_area, s.reliability_rating, s.phone, s.whatsapp
    FROM supplier_offers o JOIN suppliers s ON s.id = o.supplier_id
    WHERE o.variant_id = ${variantId} ORDER BY o.quoted_at DESC`;
}

import { z } from "zod";
import type { Db, Sql } from "../db/client";
import { AiUnavailable, generateMarketingCopy } from "../adapters/ai";
import { metaEnabled, publishToMeta } from "../adapters/meta";
import { audit, type Actor } from "./audit";
import { getVariantFull } from "./catalog";
import { DomainError } from "./errors";
import { notify } from "./notifications";
import { getSettings } from "./settings";

async function availableUnits(db: Db, variantId: number) {
  const [l] = await db<{ available: number }[]>`SELECT on_hand - reserved AS available FROM inventory_levels WHERE variant_id = ${variantId}`;
  return l?.available ?? 0;
}

/**
 * Generate caption/description drafts from VERIFIED facts only (variant attributes + price + stock).
 * Uses Claude when configured; otherwise a transparent template. Drafts always require owner approval.
 */
export async function generateDrafts(db: Db, actor: Actor, variantId: number, price: number) {
  const v = await getVariantFull(db, variantId);
  if (!v) throw new DomainError("المنتج غير موجود");
  const inStock = (await availableUnits(db, variantId)) > 0;
  const specs = [v.label, v.capacity && `السعة: ${v.capacity}`, v.dimensions && `المقاس: ${v.dimensions}`, v.material && `الخامة: ${v.material}`, v.color && `اللون: ${v.color}`]
    .filter(Boolean) as string[];
  const deliveryNote = inStock ? "متاح للتوصيل" : "غير متوفر حاليًا — حجز مسبق فقط";
  let generatedBy: "ai" | "template" = "template";
  let model: string | null = null;
  let captions: string[];
  let description: string;
  let sellingPoints: string[] = [];
  try {
    const copy = await generateMarketingCopy(db, { name: v.name_ar, specs, price, inStock, deliveryNote });
    captions = copy.captions;
    description = copy.description;
    sellingPoints = copy.selling_points;
    generatedBy = "ai";
    model = process.env.AI_MODEL || (await getSettings(db)).ai.model;
  } catch (e) {
    if (!(e instanceof AiUnavailable)) throw e;
    const cta = inStock ? "اطلب دلوقتي والتوصيل لحد البيت 🚚" : "احجز دلوقتي وهنبلغك أول ما يوصل";
    captions = [
      `${v.name_ar}\n${specs.join(" • ")}\nالسعر: ${price} ج.م\n${cta}\nابعتلنا رسالة واتساب للطلب.`,
      `عايز ${v.name_ar}؟ ✨\n${specs.join("\n")}\n💰 ${price} ج.م\n${cta}`,
    ];
    description = `${v.name_ar}${v.description ? ` — ${v.description}` : ""}\n${specs.join("\n")}`;
  }
  const ids: number[] = [];
  for (const c of captions) {
    const [r] = await db<{ id: number }[]>`INSERT INTO marketing_assets (variant_id, asset_type, content, generated_by, ai_model)
      VALUES (${variantId}, 'caption', ${c}, ${generatedBy}, ${model}) RETURNING id`;
    ids.push(r.id);
  }
  await db`INSERT INTO marketing_assets (variant_id, asset_type, content, generated_by, ai_model) VALUES (${variantId}, 'description', ${description}, ${generatedBy}, ${model})`;
  if (sellingPoints.length)
    await db`INSERT INTO marketing_assets (variant_id, asset_type, content, generated_by, ai_model) VALUES (${variantId}, 'selling_points', ${sellingPoints.join("\n")}, ${generatedBy}, ${model})`;
  await audit(db, actor, "marketing.generate", "product_variants", variantId, null, { generatedBy, count: captions.length });
  return { generatedBy, captionIds: ids };
}

export async function setAssetStatus(db: Db, actor: Actor, assetId: number, status: "approved" | "rejected" | "archived", editedContent?: string) {
  await db`UPDATE marketing_assets SET status = ${status}, content = COALESCE(${editedContent ?? null}, content),
           approved_by = ${status === "approved" ? actor.id : null}, approved_at = ${status === "approved" ? new Date() : null} WHERE id = ${assetId}`;
  await audit(db, actor, `marketing.${status}`, "marketing_assets", assetId, null, { editedContent: !!editedContent });
}

export const ScheduleSchema = z.object({
  captionAssetId: z.number().int().positive(),
  platform: z.enum(["facebook", "instagram"]),
  scheduledFor: z.coerce.date(),
  imageUrl: z.string().url().optional().nullable(),
});

/** Schedule an APPROVED caption. Posts are created awaiting approval unless publishing approval is disabled. */
export async function schedulePost(db: Db, actor: Actor, raw: unknown) {
  const s = ScheduleSchema.parse(raw);
  const [asset] = await db<{ variant_id: number; content: string; status: string }[]>`SELECT variant_id, content, status FROM marketing_assets WHERE id = ${s.captionAssetId}`;
  if (!asset || asset.status !== "approved") throw new DomainError("يجب اعتماد النص قبل الجدولة");
  if (s.imageUrl) {
    const [img] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM marketing_assets WHERE variant_id = ${asset.variant_id} AND asset_type = 'image' AND image_url = ${s.imageUrl} AND status = 'approved'`;
    if (!img.n) throw new DomainError("الصورة غير مسجلة كصورة مملوكة/مصرح بها ومعتمدة");
  }
  const settings = await getSettings(db);
  const status = settings.publishing.require_owner_approval ? "awaiting_approval" : "approved";
  const [row] = await db<{ id: number }[]>`
    INSERT INTO scheduled_posts (variant_id, caption_asset_id, platform, caption, image_url, scheduled_for, status)
    VALUES (${asset.variant_id}, ${s.captionAssetId}, ${s.platform}, ${asset.content}, ${s.imageUrl ?? null}, ${s.scheduledFor}, ${status}) RETURNING id`;
  await audit(db, actor, "post.schedule", "scheduled_posts", row.id, null, s);
  return row.id;
}

export async function approvePost(db: Db, actor: Actor, postId: number) {
  if (!actor.id) throw new DomainError("الاعتماد للمالك فقط");
  const [p] = await db<{ id: number }[]>`UPDATE scheduled_posts SET status = 'approved', approved_by = ${actor.id}, approved_at = now()
    WHERE id = ${postId} AND status IN ('awaiting_approval','failed') RETURNING id`;
  if (!p) throw new DomainError("لا يمكن اعتماد هذا المنشور");
  await audit(db, actor, "post.approve", "scheduled_posts", postId, null, {});
}

export async function addImageAsset(db: Db, actor: Actor, variantId: number, imageUrl: string, rights: "owned" | "authorized") {
  const [r] = await db<{ id: number }[]>`INSERT INTO marketing_assets (variant_id, asset_type, image_url, image_rights, generated_by, status, approved_by, approved_at)
    VALUES (${variantId}, 'image', ${imageUrl}, ${rights}, 'owner', 'approved', ${actor.id}, now()) RETURNING id`;
  await audit(db, actor, "marketing.image", "marketing_assets", r.id, null, { imageUrl, rights });
  return r.id;
}

/**
 * Publishes approved posts whose time has come. Failures are recorded as `failed` with the error —
 * a post is only `published` when Meta returns a post id (enforced by a DB CHECK).
 * Out-of-stock products are not published as "available".
 */
export async function publishDuePosts(sql: Sql, actor: Actor) {
  const due = await sql<{ id: number; variant_id: number; platform: "facebook" | "instagram"; caption: string; image_url: string | null }[]>`
    SELECT id, variant_id, platform, caption, image_url FROM scheduled_posts WHERE status = 'approved' AND scheduled_for <= now() ORDER BY scheduled_for LIMIT 10`;
  const settings = await getSettings(sql);
  const out = { published: 0, failed: 0, skipped: 0 };
  for (const p of due) {
    if (settings.publishing.auto_publish_in_stock_only && (await availableUnits(sql, p.variant_id)) <= 0) {
      await sql`UPDATE scheduled_posts SET status = 'failed', error_message = 'المنتج غير متوفر في المخزون — لم يتم النشر' WHERE id = ${p.id}`;
      out.skipped++;
      continue;
    }
    if (!metaEnabled(p.platform)) {
      await sql`UPDATE scheduled_posts SET status = 'failed', attempts = attempts + 1, error_message = 'Meta غير مُعدّ (بيانات اعتماد ناقصة)' WHERE id = ${p.id}`;
      out.failed++;
      continue;
    }
    await sql`UPDATE scheduled_posts SET status = 'publishing', attempts = attempts + 1 WHERE id = ${p.id}`;
    try {
      const extId = await publishToMeta(p.platform, p.caption, p.image_url);
      await sql`UPDATE scheduled_posts SET status = 'published', external_post_id = ${extId}, published_at = now(), error_message = NULL WHERE id = ${p.id}`;
      await audit(sql, actor, "post.published", "scheduled_posts", p.id, null, { extId });
      out.published++;
    } catch (e) {
      await sql`UPDATE scheduled_posts SET status = 'failed', error_message = ${(e as Error).message.slice(0, 500)} WHERE id = ${p.id}`;
      await notify(sql, { kind: "publish_failed", severity: "warning", channel: "telegram", dedupeKey: `publish_failed:${p.id}`, title: "فشل نشر منشور", body: (e as Error).message });
      out.failed++;
    }
  }
  return out;
}

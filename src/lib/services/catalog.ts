import type { Db } from "../db/client";
import { extractAttributes, matchListing, productKey, variantKey, type ExtractedAttributes } from "../domain/normalize";
import { audit, type Actor } from "./audit";
import { DomainError } from "./errors";

export interface NewProduct {
  nameAr: string;
  nameEn?: string | null;
  category?: string;
  description?: string | null;
  imageUrl?: string | null;
  imageRights?: "owned" | "authorized" | "reference_only" | "none";
  riskCategory?: string;
}

export interface NewVariant {
  label: string;
  brand?: string | null;
  modelNumber?: string | null;
  color?: string | null;
  sizeLabel?: string | null;
  dimensions?: string | null;
  capacity?: string | null;
  material?: string | null;
  qualityGrade?: string | null;
  weightGrams?: number | null;
}

/** Possible duplicates of a product name (trigram similarity + attribute conflict check). */
export async function findSimilarProducts(db: Db, nameAr: string, nameEn?: string | null, limit = 5) {
  const key = productKey(nameAr, nameEn);
  const rows = await db<{ id: number; name_ar: string; name_en: string | null; sim: number }[]>`
    SELECT id, name_ar, name_en, similarity(normalized_key, ${key}) AS sim
    FROM products WHERE normalized_key % ${key} OR normalized_key = ${key}
    ORDER BY sim DESC LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, match: matchListing(`${nameAr} ${nameEn ?? ""}`, `${r.name_ar} ${r.name_en ?? ""}`) }));
}

function variantAttributes(v: NewVariant): ExtractedAttributes {
  const text = [v.label, v.modelNumber, v.color, v.sizeLabel, v.dimensions, v.capacity, v.material].filter(Boolean).join(" ");
  return extractAttributes(text);
}

export async function createProductWithVariant(db: Db, actor: Actor, p: NewProduct, v: NewVariant) {
  if (!p.nameAr.trim()) throw new DomainError("اسم المنتج بالعربي مطلوب");
  const [product] = await db<{ id: number }[]>`
    INSERT INTO products (name_ar, name_en, normalized_key, category, description, image_url, image_rights, risk_category, created_by)
    VALUES (${p.nameAr.trim()}, ${p.nameEn?.trim() || null}, ${productKey(p.nameAr, p.nameEn)}, ${p.category ?? "general"},
            ${p.description ?? null}, ${p.imageUrl ?? null}, ${p.imageRights ?? "none"}, ${p.riskCategory ?? "general"}, ${actor.id})
    RETURNING id`;
  const variantId = await addVariant(db, actor, product.id, v);
  await audit(db, actor, "product.create", "products", product.id, null, { ...p, variant: v });
  return { productId: product.id, variantId };
}

export async function addVariant(db: Db, actor: Actor, productId: number, v: NewVariant) {
  const attrs = variantAttributes(v);
  const key = [variantKey(attrs), v.brand?.toLowerCase(), v.qualityGrade?.toLowerCase()].filter(Boolean).join("|");
  const [existing] = await db<{ id: number }[]>`SELECT id FROM product_variants WHERE product_id = ${productId} AND variant_key = ${key}`;
  if (existing) throw new DomainError("هذا المقاس/الموديل مسجل بالفعل لنفس المنتج", "duplicate_variant", { variantId: existing.id });
  const [{ n }] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM product_variants WHERE product_id = ${productId}`;
  const sku = `SFQ-${String(productId).padStart(4, "0")}-${String(n + 1).padStart(2, "0")}`;
  const [row] = await db<{ id: number }[]>`
    INSERT INTO product_variants (product_id, sku, variant_key, label, brand, model_number, color, size_label, dimensions, capacity, material, quality_grade, weight_grams, attributes)
    VALUES (${productId}, ${sku}, ${key}, ${v.label}, ${v.brand ?? null}, ${v.modelNumber ?? null}, ${v.color ?? null}, ${v.sizeLabel ?? null},
            ${v.dimensions ?? null}, ${v.capacity ?? null}, ${v.material ?? null}, ${v.qualityGrade ?? null}, ${v.weightGrams ?? null}, ${db.json(attrs as never)})
    RETURNING id`;
  await db`INSERT INTO inventory_levels (variant_id) VALUES (${row.id}) ON CONFLICT DO NOTHING`;
  await audit(db, actor, "variant.create", "product_variants", row.id, null, { productId, ...v, variantKey: key });
  return row.id;
}

export async function setVariantVerified(db: Db, actor: Actor, variantId: number, verified: boolean) {
  await db`UPDATE product_variants SET verified = ${verified} WHERE id = ${variantId}`;
  await audit(db, actor, verified ? "variant.verify" : "variant.unverify", "product_variants", variantId, null, { verified });
}

export async function setProductStatus(db: Db, actor: Actor, productId: number, status: string) {
  const [before] = await db<{ status: string }[]>`SELECT status FROM products WHERE id = ${productId}`;
  await db`UPDATE products SET status = ${status} WHERE id = ${productId}`;
  await audit(db, actor, "product.status", "products", productId, before, { status });
}

export async function getVariantFull(db: Db, variantId: number) {
  const [v] = await db<{
    id: number; product_id: number; sku: string; label: string; verified: boolean; variant_key: string; brand: string | null;
    model_number: string | null; color: string | null; size_label: string | null; dimensions: string | null; capacity: string | null;
    material: string | null; quality_grade: string | null; weight_grams: number | null; attributes: ExtractedAttributes;
    name_ar: string; name_en: string | null; category: string; risk_category: string; product_status: string;
    image_url: string | null; image_rights: string; description: string | null;
  }[]>`
    SELECT v.*, p.name_ar, p.name_en, p.category, p.risk_category, p.status AS product_status, p.image_url, p.image_rights, p.description
    FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ${variantId}`;
  return v ?? null;
}

/** Text describing a variant for matching purposes (name + distinguishing attributes). */
export function variantMatchText(v: { name_ar: string; name_en: string | null; label: string; capacity?: string | null; dimensions?: string | null; model_number?: string | null; material?: string | null; color?: string | null }) {
  return [v.name_ar, v.name_en, v.label, v.capacity, v.dimensions, v.model_number, v.material, v.color].filter(Boolean).join(" ");
}

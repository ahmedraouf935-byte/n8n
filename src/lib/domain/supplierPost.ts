/**
 * Rule-based extraction of candidate product details from a wholesale supplier post
 * (Telegram/WhatsApp text). Deterministic and free; the AI extractor may refine it,
 * but anything uncertain is FLAGGED rather than guessed.
 */
import { extractAttributes, normalizeText, toAsciiDigits, type ExtractedAttributes } from "./normalize";

export interface ParsedSupplierPost {
  title: string;
  price: number | null;
  priceUncertain: boolean;
  allPrices: number[];
  minOrderQty: number | null;
  attributes: ExtractedAttributes;
  flags: string[];
}

const CURRENCY = "(?:ج\\.?م|جنيه|جنية|ج|le|egp|l\\.e|pound)";

export function parseSupplierPost(text: string): ParsedSupplierPost {
  const ascii = toAsciiDigits(text);
  const flags: string[] = [];

  const lines = ascii.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const title = (lines.find((l) => /\p{L}{3,}/u.test(l) && !/^(السعر|سعر|price)/i.test(l)) ?? lines[0] ?? "").slice(0, 160);

  const prices = new Set<number>();
  const priceRe = new RegExp(
    `(?:(?:السعر|سعر|بسعر|price|الجمله|جمله|جملة)\\s*[:：-]?\\s*(\\d+(?:[.,]\\d+)?))|(?:(\\d+(?:[.,]\\d+)?)\\s*${CURRENCY}(?![\\p{L}]))`,
    "giu",
  );
  for (const m of ascii.matchAll(priceRe)) {
    const v = Number((m[1] ?? m[2]).replace(",", "."));
    if (v > 0 && v < 1_000_000) prices.add(v);
  }
  const allPrices = [...prices];
  let price: number | null = null;
  let priceUncertain = false;
  if (allPrices.length === 1) price = allPrices[0];
  else if (allPrices.length > 1) {
    price = Math.min(...allPrices);
    priceUncertain = true;
    flags.push(`أكثر من سعر في المنشور (${allPrices.join("، ")}) — قد تكون أسعار شرائح كمية أو مقاسات مختلفة.`);
  } else flags.push("لا يوجد سعر واضح في المنشور.");

  const norm = normalizeText(ascii);
  if (/(دسته|الدسته|دستة|الدستة|dozen)/.test(norm)) {
    priceUncertain = true;
    flags.push("السعر قد يكون للدستة وليس للقطعة.");
  }
  if (/(كرتونه|الكرتونه|كرتون|carton)/.test(norm)) {
    priceUncertain = true;
    flags.push("السعر قد يكون للكرتونة وليس للقطعة.");
  }

  let minOrderQty: number | null = null;
  const moq = norm.match(/(?:اقل|حد ادني|الحد الادني|minimum|moq)[^\d]{0,15}(\d+)/);
  if (moq) minOrderQty = Number(moq[1]);
  else if (/(دسته|دستة)/.test(norm)) minOrderQty = 12;

  const attributes = extractAttributes(ascii);
  if (!attributes.capacityMl && !attributes.dimensionsCm && !attributes.modelNumber && !attributes.packCount) {
    flags.push("مواصفات ناقصة (مقاس/سعة/موديل) — اسأل المورد قبل المطابقة.");
  }
  return { title, price, priceUncertain, allPrices, minOrderQty, attributes, flags };
}

/** The product-describing part of a post: drops price, quantity, contact and delivery lines before matching. */
export function productText(text: string): string {
  const noise = /(السعر|سعر|بسعر|price|جنيه|جنية|ج\.م|egp|اقل|أقل|الحد|كميه|كمية|moq|للتواصل|تواصل|واتس|whats|توصيل|شحن|متاح|\+?20?1[0125]\d{8})/i;
  const lines = toAsciiDigits(text).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const kept = lines.filter((l) => !noise.test(l));
  return (kept.length ? kept : lines.slice(0, 1)).join(" ");
}

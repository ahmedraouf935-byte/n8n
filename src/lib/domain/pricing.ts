import { round2 } from "./money";
import { minPriceForMargin, type EconomicsInput } from "./economics";

export interface RetailOfferInput {
  id?: number;
  listedPrice: number;
  shippingCost?: number | null;
  priceType: "listed" | "promotional" | "historical" | "observed_transaction";
  matchStatus: "exact" | "probable" | "mismatch" | "unreviewed";
  observedAt: Date | string;
  url: string;
  sellerName?: string | null;
  availability?: "in_stock" | "out_of_stock" | "unknown";
}

export interface CleanedOffer extends RetailOfferInput {
  customerTotal: number;
  excludedReason?: string;
}

export interface RetailStats {
  usable: CleanedOffer[];
  excluded: CleanedOffer[];
  sampleSize: number;
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
  distinctSellers: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

/**
 * Clean retail offers for the SAME variant and compute the price range.
 * Excludes: mismatched/unreviewed variants, historical prices, stale observations,
 * duplicate URLs (keeps the newest) and statistical outliers.
 * Prices compared are what the customer pays: listed price + shipping when known.
 */
export function computeRetailStats(offers: RetailOfferInput[], opts: { now?: Date; freshDays?: number } = {}): RetailStats {
  const now = opts.now ?? new Date();
  const freshDays = opts.freshDays ?? 14;
  const excluded: CleanedOffer[] = [];
  const byUrl = new Map<string, CleanedOffer>();

  for (const o of offers) {
    const c: CleanedOffer = { ...o, customerTotal: round2(o.listedPrice + (o.shippingCost ?? 0)) };
    const ageDays = (now.getTime() - new Date(o.observedAt).getTime()) / 86_400_000;
    if (o.matchStatus === "mismatch") c.excludedReason = "منتج/مقاس مختلف";
    else if (o.matchStatus === "unreviewed") c.excludedReason = "لم تتم مراجعة التطابق";
    else if (o.priceType === "historical") c.excludedReason = "سعر تاريخي";
    else if (ageDays > freshDays) c.excludedReason = `قديم (${Math.floor(ageDays)} يوم)`;
    if (c.excludedReason) {
      excluded.push(c);
      continue;
    }
    const key = o.url.trim().toLowerCase().replace(/[?#].*$/, "");
    const prev = byUrl.get(key);
    if (prev) {
      const older = new Date(prev.observedAt) < new Date(o.observedAt) ? prev : c;
      const newer = older === prev ? c : prev;
      excluded.push({ ...older, excludedReason: "مكرر (نفس الرابط)" });
      byUrl.set(key, newer);
    } else byUrl.set(key, c);
  }

  let usable = [...byUrl.values()];
  if (usable.length >= 3) {
    const sorted = usable.map((o) => o.customerTotal).sort((a, b) => a - b);
    const med = quantile(sorted, 0.5);
    let lo = med * 0.4;
    let hi = med * 2.5;
    if (sorted.length >= 4) {
      const q1 = quantile(sorted, 0.25);
      const q3 = quantile(sorted, 0.75);
      const iqr = q3 - q1;
      lo = Math.max(lo, q1 - 1.5 * iqr);
      hi = Math.min(hi, q3 + 1.5 * iqr);
    }
    const kept: CleanedOffer[] = [];
    for (const o of usable) {
      if (o.customerTotal < lo || o.customerTotal > hi) excluded.push({ ...o, excludedReason: "قيمة شاذة" });
      else kept.push(o);
    }
    usable = kept;
  }

  const prices = usable.map((o) => o.customerTotal).sort((a, b) => a - b);
  const n = prices.length;
  return {
    usable,
    excluded,
    sampleSize: n,
    min: n ? prices[0] : null,
    p25: n ? round2(quantile(prices, 0.25)) : null,
    median: n ? round2(quantile(prices, 0.5)) : null,
    p75: n ? round2(quantile(prices, 0.75)) : null,
    max: n ? prices[n - 1] : null,
    distinctSellers: new Set(usable.map((o) => (o.sellerName ?? o.url).toLowerCase())).size,
  };
}

export interface PriceRecommendation {
  recommendedPrice: number | null;   // product price (excluding our shipping fee)
  customerTotal: number | null;
  floorPrice: number | null;         // minimum price reaching the target margin
  competitive: boolean;
  confidence: "low" | "medium" | "high";
  reasons: string[];
}

/**
 * Recommend a selling price: slightly under the market median (attractive, not necessarily cheapest),
 * never below the price that protects the target contribution margin.
 */
export function recommendPrice(
  stats: RetailStats,
  economics: Omit<EconomicsInput, "sellingPrice">,
  opts: { targetMarginPct?: number; undercutPct?: number } = {},
): PriceRecommendation {
  const targetMarginPct = opts.targetMarginPct ?? 20;
  const undercut = opts.undercutPct ?? 5;
  const ourShipFee = economics.shippingFeeCharged ?? 0;
  const floor = minPriceForMargin(economics, targetMarginPct);
  const reasons: string[] = [];

  if (stats.median === null) {
    reasons.push("لا توجد عروض تجزئة صالحة للمقارنة لنفس المنتج والمقاس — حدّد السعر يدويًا بعد البحث.");
    if (floor !== null) reasons.push(`أقل سعر يحقق هامش ${targetMarginPct}٪ هو ${floor} ج.م.`);
    return { recommendedPrice: null, customerTotal: null, floorPrice: floor, competitive: false, confidence: "low", reasons };
  }

  const targetTotal = stats.median * (1 - undercut / 100);
  let price = Math.max(5, Math.floor((targetTotal - ourShipFee) / 5) * 5);
  reasons.push(`متوسط سعر السوق (شامل الشحن) ${stats.median} ج.م من ${stats.sampleSize} عرض.`);
  reasons.push(`السعر المقترح أقل من المتوسط بحوالي ${undercut}٪ ليكون جذابًا دون حرق الهامش.`);

  let competitive = true;
  if (floor === null) {
    reasons.push(`لا يوجد سعر يحقق هامش ${targetMarginPct}٪ بالتكاليف الحالية.`);
    competitive = false;
  } else if (price < floor) {
    reasons.push(`تم رفع السعر إلى الحد الأدنى ${floor} ج.م للحفاظ على هامش ${targetMarginPct}٪.`);
    price = floor;
    if (floor + ourShipFee > stats.median) {
      competitive = false;
      reasons.push("السعر اللازم لحماية الهامش أعلى من متوسط السوق — المنافسة صعبة.");
    }
  }

  const confidence = stats.sampleSize >= 4 && stats.distinctSellers >= 3 ? "high" : stats.sampleSize >= 2 ? "medium" : "low";
  if (confidence === "low") reasons.push("عدد العروض قليل — الثقة في نطاق السعر منخفضة.");
  return { recommendedPrice: price, customerTotal: round2(price + ourShipFee), floorPrice: floor, competitive, confidence, reasons };
}

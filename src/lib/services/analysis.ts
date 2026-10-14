import type { Db } from "../db/client";
import { computeEconomics, runScenarios, type EconomicsInput, type EconomicsResult, type ScenarioResult } from "../domain/economics";
import { recommendPrice, type PriceRecommendation, type RetailStats } from "../domain/pricing";
import { scoreOpportunity, type RiskCategory, type ScoreResult, type SupplierState, type TrendEvidence } from "../domain/scoring";
import { isFresh, supplierOfferStatus } from "../domain/trust";
import { getVariantFull } from "./catalog";
import { retailStatsForVariant } from "./retail";
import { getSettings, type Settings } from "./settings";
import { latestVerification, listSupplierOffersForVariant } from "./suppliers";

export interface SupplierOfferView {
  id: number;
  supplierId: number;
  supplierName: string;
  marketArea: string;
  reliability: number | null;
  title: string;
  quotedPrice: number | null;
  priceUncertain: boolean;
  effectivePrice: number | null;   // confirmed price if verified, else quoted
  minOrderQty: number;
  status: "verified" | "unverified" | "stale" | "unavailable";
  matchStatus: string;
  sourceUrl: string | null;
  evidenceNote: string | null;
  quotedAt: Date;
  verification: Awaited<ReturnType<typeof latestVerification>>;
  phone: string | null;
  whatsapp: string | null;
}

export interface OpportunityAnalysis {
  variantId: number;
  computedAt: Date;
  retail: RetailStats;
  supplierOffers: SupplierOfferView[];
  bestOffer: SupplierOfferView | null;
  pricing: PriceRecommendation | null;
  sellingPrice: number | null;
  sellingPriceSource: "owner" | "recommendation" | "none";
  testQuantity: number | null;
  economicsInput: EconomicsInput | null;
  economics: EconomicsResult | null;
  scenarios: ScenarioResult[];
  trends: (TrendEvidence & { id: number; title: string; sourceUrl: string | null })[];
  score: ScoreResult;
  risks: string[];
}

export function economicsDefaults(s: Settings): Omit<EconomicsInput, "wholesaleUnitPrice" | "sellingPrice" | "quantity"> {
  const d = s.unit_economics_defaults;
  return {
    pickupCostTotal: d.pickup_cost_total, packagingPerOrder: d.packaging_per_order, carrierCostPerOrder: d.carrier_cost_per_order,
    shippingFeeCharged: d.shipping_fee_charged, codFeePct: d.cod_fee_pct, codFeeFixed: d.cod_fee_fixed, adCostPerOrder: d.ad_cost_per_order,
    failedDeliveryRate: d.failed_delivery_rate, failedDeliveryCost: d.failed_delivery_cost, returnRate: d.return_rate, returnCost: d.return_cost,
    resellableReturnRate: d.resellable_return_rate, discountPerOrder: d.discount_per_order, taxPct: d.tax_pct, otherCostPerUnit: d.other_cost_per_unit,
  };
}

function pickBestOffer(offers: SupplierOfferView[]): SupplierOfferView | null {
  const usable = offers.filter((o) => o.status !== "unavailable" && o.matchStatus !== "mismatch" && o.effectivePrice !== null);
  const rank = (o: SupplierOfferView) => (o.status === "verified" ? 0 : o.status === "unverified" ? 1 : 2) * 10 + (o.matchStatus === "confirmed" ? 0 : 1);
  usable.sort((a, b) => rank(a) - rank(b) || a.effectivePrice! - b.effectivePrice!);
  return usable[0] ?? null;
}

export async function analyzeVariant(db: Db, variantId: number, now = new Date()): Promise<OpportunityAnalysis | null> {
  const v = await getVariantFull(db, variantId);
  if (!v) return null;
  const settings = await getSettings(db);
  const [opp] = await db<{ owner_price: number | null; test_quantity: number | null; economics_overrides: Partial<EconomicsInput> }[]>`
    SELECT owner_price, test_quantity, economics_overrides FROM opportunities WHERE variant_id = ${variantId}`;

  // Retail market
  const { stats } = await retailStatsForVariant(db, variantId, settings.freshness.retail_offer_fresh_days, now);

  // Supplier offers with effective status
  const rawOffers = await listSupplierOffersForVariant(db, variantId);
  const supplierOffers: SupplierOfferView[] = [];
  for (const o of rawOffers) {
    const ver = await latestVerification(db, o.id);
    const status = supplierOfferStatus({ quotedAt: o.quoted_at, staleAfterDays: o.stale_after_days, status: o.status },
      ver && { result: ver.result, validUntil: ver.valid_until, verifiedAt: ver.verified_at }, now);
    supplierOffers.push({
      id: o.id, supplierId: o.supplier_id, supplierName: o.supplier_name, marketArea: o.market_area, reliability: o.reliability_rating,
      title: o.title_raw, quotedPrice: o.quoted_price, priceUncertain: o.price_uncertain,
      effectivePrice: status === "verified" && ver?.confirmed_price ? ver.confirmed_price : o.quoted_price,
      minOrderQty: ver?.confirmed_moq ?? o.min_order_qty, status, matchStatus: o.match_status, sourceUrl: o.source_url,
      evidenceNote: o.evidence_note, quotedAt: o.quoted_at, verification: ver, phone: o.phone, whatsapp: o.whatsapp,
    });
  }
  const bestOffer = pickBestOffer(supplierOffers);

  // Economics & pricing
  const defaults = { ...economicsDefaults(settings), ...(opp?.economics_overrides ?? {}) };
  let pricing: PriceRecommendation | null = null;
  let economicsInput: EconomicsInput | null = null;
  let economics: EconomicsResult | null = null;
  let scenarios: ScenarioResult[] = [];
  let sellingPrice: number | null = null;
  let sellingPriceSource: OpportunityAnalysis["sellingPriceSource"] = "none";
  let testQuantity: number | null = null;

  if (bestOffer?.effectivePrice) {
    const wholesale = bestOffer.effectivePrice;
    const budgetForTest = Math.min(settings.risk.max_test_spend_per_product, settings.capital.allocations.inventory);
    testQuantity = opp?.test_quantity ?? Math.max(bestOffer.minOrderQty, Math.min(30, Math.floor((budgetForTest * 0.7) / wholesale)));
    const base = { ...defaults, wholesaleUnitPrice: wholesale, quantity: testQuantity, minOrderQty: bestOffer.minOrderQty };
    pricing = recommendPrice(stats, base, { targetMarginPct: Math.max(settings.risk.min_margin_pct, 20) });
    if (opp?.owner_price) { sellingPrice = opp.owner_price; sellingPriceSource = "owner"; }
    else if (pricing.recommendedPrice) { sellingPrice = pricing.recommendedPrice; sellingPriceSource = "recommendation"; }
    if (sellingPrice) {
      economicsInput = { ...base, sellingPrice };
      economics = computeEconomics(economicsInput);
      scenarios = runScenarios(economicsInput);
    }
  }

  // Trend evidence (linked to this product)
  const trendRows = await db<{ id: number; title_raw: string; evidence_type: TrendEvidence["evidenceType"]; region: string; platform: string;
    measured_growth_pct: number | null; discovered_at: Date; source_url: string | null }[]>`
    SELECT id, title_raw, evidence_type, region, platform, measured_growth_pct, discovered_at, source_url
    FROM trend_signals WHERE product_id = ${v.product_id} ORDER BY discovered_at DESC`;
  const trends = trendRows.map((t) => ({
    id: t.id, title: t.title_raw, sourceUrl: t.source_url, evidenceType: t.evidence_type, region: t.region, platform: t.platform,
    measuredGrowthPct: t.measured_growth_pct, discoveredAt: t.discovered_at,
  }));

  const supplierState: SupplierState = !bestOffer ? (supplierOffers.some((o) => o.status === "unavailable") ? "unavailable" : "none")
    : bestOffer.status === "verified" ? "verified_fresh" : bestOffer.status === "stale" && bestOffer.verification ? "verified_stale" : "unverified";
  const freshOffers = stats.usable.filter((o) => isFresh(o.observedAt, settings.freshness.retail_offer_fresh_days, now)).length;
  const ourTotal = sellingPrice !== null ? sellingPrice + (defaults.shippingFeeCharged ?? 0) : null;

  const score = scoreOpportunity(
    {
      now,
      trendFreshDays: settings.freshness.trend_fresh_days,
      trends,
      economics: economics ? { marginPct: economics.contributionMarginPct, contributionPerDeliveredUnit: economics.contributionPerDeliveredUnit } : null,
      supplier: {
        state: supplierState,
        reliability: bestOffer?.reliability ?? null,
        moqFitsBudget: bestOffer?.effectivePrice ? bestOffer.minOrderQty * bestOffer.effectivePrice <= settings.risk.max_test_spend_per_product : true,
      },
      risk: { category: v.risk_category as RiskCategory, weightGrams: v.weight_grams },
      competition: {
        freshOfferCount: freshOffers,
        ourPriceVsMedianPct: ourTotal !== null && stats.median ? Math.round(((ourTotal - stats.median) / stats.median) * 1000) / 10 : null,
      },
    },
    settings.scoring.weights,
    settings.scoring.bands,
  );

  const risks: string[] = [];
  if (!v.verified) risks.push("المقاس/الموديل لم يتم تأكيده من المالك.");
  if (bestOffer?.priceUncertain) risks.push("سعر المورد غير مؤكد (قد يكون للدستة/الكرتونة أو أكثر من سعر).");
  if (bestOffer && bestOffer.status !== "verified") risks.push("توفر المورد غير مؤكد — تواصل مع المورد قبل أي قرار.");
  if (!bestOffer) risks.push("لا يوجد عرض جملة مرتبط بهذا المنتج.");
  if (stats.sampleSize === 0) risks.push("لا توجد أسعار تجزئة حديثة ومطابقة للمقارنة.");
  if (v.risk_category !== "general") risks.push(`فئة حساسة (${v.risk_category}) — تحقق من التراخيص/الصلاحية/الضمان والأصالة.`);
  if (economics) risks.push(...economics.warnings);
  if (pricing && !pricing.competitive) risks.push("السعر اللازم لحماية الهامش غير تنافسي.");
  if (!trends.length) risks.push("لا يوجد دليل ترند مرتبط بالمنتج.");
  else if (trends.every((t) => t.evidenceType === "ai_hypothesis")) risks.push("الطلب مبني على فرضية ذكاء اصطناعي فقط.");

  return {
    variantId, computedAt: now, retail: stats, supplierOffers, bestOffer, pricing, sellingPrice, sellingPriceSource, testQuantity,
    economicsInput, economics, scenarios, trends, score, risks,
  };
}

/** Recompute and persist score, price snapshots and the opportunity row. Safe to rerun. */
export async function refreshOpportunity(db: Db, variantId: number, now = new Date()) {
  const a = await analyzeVariant(db, variantId, now);
  if (!a) return null;
  const s = a.score;
  const line = (k: string) => s.lines.find((l) => l.key === k)!.score;
  const [score] = await db<{ id: number }[]>`
    INSERT INTO product_scores (variant_id, total_score, demand_score, profit_score, supplier_score, risk_score, competition_score, weights,
      confidence, band, explanation, inputs, model_version, computed_at)
    VALUES (${variantId}, ${s.total}, ${line("demand")}, ${line("profit")}, ${line("supplier")}, ${line("risk")}, ${line("competition")},
      ${db.json(s.weights as never)}, ${s.confidence}, ${s.band},
      ${db.json({ lines: s.lines, confidenceReasons: s.confidenceReasons, bandReasons: s.bandReasons, risks: a.risks } as never)},
      ${db.json({ retailSample: a.retail.sampleSize, median: a.retail.median, bestOfferId: a.bestOffer?.id ?? null, wholesale: a.bestOffer?.effectivePrice ?? null,
        sellingPrice: a.sellingPrice, sellingPriceSource: a.sellingPriceSource, economics: a.economicsInput } as never)},
      ${s.modelVersion}, ${now})
    RETURNING id`;

  const snaps: [string, number | null, number][] = [
    ["retail_min", a.retail.min, a.retail.sampleSize], ["retail_median", a.retail.median, a.retail.sampleSize],
    ["retail_max", a.retail.max, a.retail.sampleSize], ["wholesale_best", a.bestOffer?.effectivePrice ?? null, a.supplierOffers.length],
    ["recommended_price", a.pricing?.recommendedPrice ?? null, a.retail.sampleSize],
  ];
  for (const [kind, value, n] of snaps) {
    if (value === null) continue;
    // avoid repeated identical snapshots on reruns the same day
    const [last] = await db<{ value: number; day: string }[]>`SELECT value, (computed_at AT TIME ZONE 'Africa/Cairo')::date::text AS day FROM price_snapshots
      WHERE variant_id = ${variantId} AND kind = ${kind} ORDER BY computed_at DESC LIMIT 1`;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(now);
    if (last && last.value === value && last.day === today) continue;
    await db`INSERT INTO price_snapshots (variant_id, kind, value, sample_size, computed_at) VALUES (${variantId}, ${kind}, ${value}, ${n}, ${now})`;
  }

  await db`
    INSERT INTO opportunities (variant_id, latest_score_id, recommended_price, best_supplier_offer_id, estimated_unit_profit)
    VALUES (${variantId}, ${score.id}, ${a.pricing?.recommendedPrice ?? null}, ${a.bestOffer?.id ?? null}, ${a.economics?.contributionPerDeliveredUnit ?? null})
    ON CONFLICT (variant_id) DO UPDATE SET latest_score_id = EXCLUDED.latest_score_id, recommended_price = EXCLUDED.recommended_price,
      best_supplier_offer_id = EXCLUDED.best_supplier_offer_id, estimated_unit_profit = EXCLUDED.estimated_unit_profit`;
  return a;
}

/** Score every active variant (daily job). */
export async function refreshAllOpportunities(db: Db, now = new Date()) {
  const variants = await db<{ id: number }[]>`
    SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.status NOT IN ('rejected','stopped')`;
  let ok = 0;
  const errors: { variantId: number; error: string }[] = [];
  for (const v of variants) {
    try { await refreshOpportunity(db, v.id, now); ok++; }
    catch (e) { errors.push({ variantId: v.id, error: (e as Error).message }); }
  }
  return { scored: ok, errors };
}

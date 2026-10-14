import { describe, it, expect } from "vitest";
import { computeRetailStats, recommendPrice, type RetailOfferInput } from "@/lib/domain/pricing";
import { scoreOpportunity, type ScoreInput } from "@/lib/domain/scoring";
import { checkPurchaseGates, type GateInput } from "@/lib/domain/gates";
import { supplierOfferStatus } from "@/lib/domain/trust";
import { canTransition } from "@/lib/domain/orders";
import { parseSupplierPost } from "@/lib/domain/supplierPost";

const now = new Date("2026-10-14T10:00:00Z");
const day = (n: number) => new Date(now.getTime() - n * 86_400_000);
const offer = (p: number, extra: Partial<RetailOfferInput> = {}): RetailOfferInput => ({
  listedPrice: p, priceType: "listed", matchStatus: "exact", observedAt: day(1), url: `https://x.eg/${p}`, ...extra,
});

describe("computeRetailStats", () => {
  it("excludes mismatched, unreviewed, historical, stale, duplicate and outlier offers", () => {
    const s = computeRetailStats(
      [
        offer(200), offer(220), offer(210), offer(230),
        offer(150, { matchStatus: "mismatch" }),
        offer(160, { matchStatus: "unreviewed" }),
        offer(170, { priceType: "historical" }),
        offer(180, { observedAt: day(40) }),
        offer(205, { url: "https://x.eg/200?ref=1", observedAt: day(3) }), // older duplicate of /200
        offer(900),                                                          // outlier
      ],
      { now, freshDays: 14 },
    );
    expect(s.sampleSize).toBe(4);
    expect(s.min).toBe(200);
    expect(s.max).toBe(230);
    expect(s.median).toBe(215);
    expect(s.excluded.map((e) => e.excludedReason)).toEqual(
      expect.arrayContaining(["منتج/مقاس مختلف", "لم تتم مراجعة التطابق", "سعر تاريخي", "مكرر (نفس الرابط)", "قيمة شاذة"]),
    );
  });
  it("compares customer totals including shipping", () => {
    const s = computeRetailStats([offer(100, { shippingCost: 30 })], { now });
    expect(s.median).toBe(130);
  });
});

describe("recommendPrice", () => {
  const econ = { wholesaleUnitPrice: 50, quantity: 20, carrierCostPerOrder: 60, shippingFeeCharged: 50, adCostPerOrder: 40, packagingPerOrder: 8 };
  it("undercuts the median slightly while protecting margin", () => {
    const s = computeRetailStats([offer(250), offer(260), offer(270), offer(280)], { now });
    const r = recommendPrice(s, econ, { targetMarginPct: 20, undercutPct: 5 });
    expect(r.recommendedPrice).not.toBeNull();
    expect(r.customerTotal!).toBeLessThan(s.median!);
    expect(r.recommendedPrice!).toBeGreaterThanOrEqual(r.floorPrice!);
  });
  it("refuses to recommend without market data", () => {
    const r = recommendPrice(computeRetailStats([], { now }), econ);
    expect(r.recommendedPrice).toBeNull();
    expect(r.confidence).toBe("low");
  });
  it("marks non-competitive when the margin floor is above the market", () => {
    const s = computeRetailStats([offer(90), offer(95)], { now });
    const r = recommendPrice(s, econ, { targetMarginPct: 20 });
    expect(r.competitive).toBe(false);
  });
});

const goodScore: ScoreInput = {
  now,
  trends: [
    { evidenceType: "measured", region: "EG", platform: "tiktok", measuredGrowthPct: 300, discoveredAt: day(2) },
    { evidenceType: "measured", region: "EG", platform: "facebook", measuredGrowthPct: 120, discoveredAt: day(3) },
  ],
  economics: { marginPct: 35, contributionPerDeliveredUnit: 60 },
  supplier: { state: "verified_fresh", reliability: 4, moqFitsBudget: true },
  risk: { category: "general", weightGrams: 300 },
  competition: { freshOfferCount: 3, ourPriceVsMedianPct: -6 },
};

describe("scoreOpportunity", () => {
  it("scores strong, verified evidence highly with high confidence", () => {
    const r = scoreOpportunity(goodScore);
    expect(r.total).toBeGreaterThanOrEqual(80);
    expect(r.confidence).toBe("high");
    expect(r.band).toBe("high_priority");
    expect(r.lines.every((l) => l.reasons.length > 0)).toBe(true);
  });
  it("caps AI-only hypotheses and lowers confidence", () => {
    const r = scoreOpportunity({ ...goodScore, trends: [{ evidenceType: "ai_hypothesis", region: "GLOBAL", platform: "ai", discoveredAt: day(1) }] });
    expect(r.lines.find((l) => l.key === "demand")!.score).toBeLessThanOrEqual(25);
    expect(r.confidence).not.toBe("high");
  });
  it("never puts weak-data candidates in the high-priority band", () => {
    const r = scoreOpportunity({ ...goodScore, supplier: { state: "unverified", reliability: null, moqFitsBudget: true }, competition: { freshOfferCount: 0, ourPriceVsMedianPct: null } }, { demand: 60, profit: 40, supplier: 0, risk: 0, competition: 0 });
    expect(r.confidence).toBe("low");
    expect(r.band).not.toBe("high_priority");
  });
  it("rejects negative economics regardless of score", () => {
    expect(scoreOpportunity({ ...goodScore, economics: { marginPct: -10, contributionPerDeliveredUnit: -15 } }).band).toBe("reject");
  });
  it("respects custom weights", () => {
    const r = scoreOpportunity(goodScore, { demand: 0, profit: 100, supplier: 0, risk: 0, competition: 0 });
    expect(r.total).toBe(r.lines.find((l) => l.key === "profit")!.score);
  });
});

const okGate: GateInput = {
  now, quantity: 20, plannedTotalCost: 1040, variantVerified: true, offerMatchStatus: "confirmed",
  verification: { result: "available", validUntil: new Date(now.getTime() + 86_400_000), confirmedQuantity: 50 },
  availableCash: 5000, committedCash: 0, inventoryBudgetRemaining: 2500, maxTestSpendPerProduct: 1500,
  activeTests: 0, maxConcurrentTests: 2, economicsBase: { contributionPerDeliveredUnit: 36, marginPct: 20 },
  minMarginPct: 15, scoreConfidence: "high", riskCategory: "general", complianceAck: false,
  requireComplianceFor: ["cosmetics", "electronics"], blockedCategories: ["prohibited"],
};
const failed = (g: GateInput) => checkPurchaseGates(g).gates.filter((x) => !x.passed && x.severity === "block").map((x) => x.code);

describe("checkPurchaseGates", () => {
  it("approves when every gate passes", () => {
    expect(checkPurchaseGates(okGate).approved).toBe(true);
  });
  it("blocks unverified or expired stock", () => {
    expect(failed({ ...okGate, verification: null })).toContain("supplier_verified");
    expect(failed({ ...okGate, verification: { ...okGate.verification!, validUntil: day(1) } })).toContain("supplier_verified");
    expect(failed({ ...okGate, verification: { ...okGate.verification!, result: "unavailable" } })).toContain("supplier_verified");
    expect(failed({ ...okGate, verification: { ...okGate.verification!, confirmedQuantity: 5 } })).toContain("quantity_available");
  });
  it("blocks unconfirmed variant matches", () => {
    expect(failed({ ...okGate, offerMatchStatus: "probable" })).toContain("variant_match");
    expect(failed({ ...okGate, variantVerified: false })).toContain("variant_match");
  });
  it("blocks overspending", () => {
    expect(failed({ ...okGate, availableCash: 1500, committedCash: 600 })).toContain("cash_available");
    expect(failed({ ...okGate, inventoryBudgetRemaining: 1000 })).toContain("inventory_budget");
    expect(failed({ ...okGate, plannedTotalCost: 1600, availableCash: 5000 })).toContain("per_product_cap");
    expect(failed({ ...okGate, activeTests: 2 })).toContain("concurrent_tests");
  });
  it("blocks weak economics, low confidence, sensitive categories without ack, and demo data", () => {
    expect(failed({ ...okGate, economicsBase: { contributionPerDeliveredUnit: 5, marginPct: 8 } })).toContain("unit_economics");
    expect(failed({ ...okGate, scoreConfidence: "low" })).toContain("data_confidence");
    expect(failed({ ...okGate, riskCategory: "cosmetics" })).toContain("compliance_ack");
    expect(checkPurchaseGates({ ...okGate, riskCategory: "cosmetics", complianceAck: true }).approved).toBe(true);
    expect(failed({ ...okGate, riskCategory: "prohibited" })).toContain("category_blocked");
    expect(failed({ ...okGate, isDemoData: true, productionEnvironment: true })).toContain("not_demo");
  });
});

describe("supplierOfferStatus", () => {
  const o = { quotedAt: day(2), staleAfterDays: 7 };
  it("derives effective status", () => {
    expect(supplierOfferStatus(o, null, now)).toBe("unverified");
    expect(supplierOfferStatus({ ...o, quotedAt: day(10) }, null, now)).toBe("stale");
    expect(supplierOfferStatus(o, { result: "available", verifiedAt: day(1), validUntil: day(-2) }, now)).toBe("verified");
    expect(supplierOfferStatus(o, { result: "available", verifiedAt: day(5), validUntil: day(2) }, now)).toBe("stale");
    expect(supplierOfferStatus(o, { result: "unavailable", verifiedAt: day(1), validUntil: day(-2) }, now)).toBe("unavailable");
  });
});

describe("order transitions", () => {
  it("allows only the defined lifecycle", () => {
    expect(canTransition("new", "confirmed")).toBe(true);
    expect(canTransition("new", "shipped")).toBe(false);
    expect(canTransition("shipped", "delivered")).toBe(true);
    expect(canTransition("delivered", "returned")).toBe(true);
    expect(canTransition("cancelled", "confirmed")).toBe(false);
  });
});

describe("parseSupplierPost", () => {
  it("extracts price, MOQ and attributes from an Arabic wholesale post", () => {
    const p = parseSupplierPost("منظم أدراج بلاستيك ٣٠×٢٠ سم\nالسعر: ٤٥ جنيه\nأقل كمية ١٢ قطعة");
    expect(p.price).toBe(45);
    expect(p.priceUncertain).toBe(false);
    expect(p.minOrderQty).toBe(12);
    expect(p.attributes.dimensionsCm).toEqual([20, 30]);
  });
  it("flags dozen pricing and multiple prices instead of guessing", () => {
    const p = parseSupplierPost("كوب حراري ستانلس 500 مل\nالدستة 600 ج\nالقطعة 55 ج");
    expect(p.priceUncertain).toBe(true);
    expect(p.flags.length).toBeGreaterThan(0);
  });
  it("flags missing prices", () => {
    expect(parseSupplierPost("وصل جديد شنط").price).toBeNull();
  });
});

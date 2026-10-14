import { describe, it, expect } from "vitest";
import { computeEconomics, runScenarios, minPriceForMargin, type EconomicsInput } from "@/lib/domain/economics";

// Hand-calculated reference case (see comments for each number)
const base: EconomicsInput = {
  wholesaleUnitPrice: 50, sellingPrice: 200, quantity: 20, minOrderQty: 1, pickupCostTotal: 40,
  packagingPerOrder: 8, carrierCostPerOrder: 60, shippingFeeCharged: 50, codFeePct: 1, codFeeFixed: 0,
  adCostPerOrder: 40, failedDeliveryRate: 0.2, failedDeliveryCost: 30, returnRate: 0.1, returnCost: 30,
  resellableReturnRate: 0.5, discountPerOrder: 0, taxPct: 0,
};

describe("computeEconomics", () => {
  const e = computeEconomics(base);

  it("computes landed cost and inventory cash (pickup allocated over the batch)", () => {
    expect(e.landedUnitCost).toBe(52);           // 50 + 40/20
    expect(e.inventoryCashRequired).toBe(1040);  // 20*50 + 40
  });

  it("collects shipping fee only on delivered orders and refunds product price on returns", () => {
    expect(e.probabilities).toEqual({ deliver: 0.8, customerReturn: 0.08, keep: 0.72 });
    expect(e.perShippedOrder.productRevenue).toBe(160);  // 0.8*200
    expect(e.perShippedOrder.shippingFeeIncome).toBe(40); // 0.8*50
    expect(e.perShippedOrder.refunds).toBe(16);          // 0.08*200
    expect(e.perShippedOrder.netRevenue).toBe(184);
    expect(e.perShippedOrder.carrierCost).toBe(60);      // paid on every shipped order
  });

  it("accounts for every configured cost", () => {
    const p = e.perShippedOrder;
    expect(p.collectionFees).toBe(2);       // 0.8 * 250 * 1%
    expect(p.failedDeliveryCost).toBe(6);   // 0.2 * 30
    expect(p.returnCost).toBe(2.4);         // 0.08 * 30
    expect(p.productCost).toBe(39.52);      // (0.72 + 0.08*0.5) * 52
    expect(p.contribution).toBe(26.08);     // 184-2-60-6-2.4-8-40-39.52
    expect(e.contributionPerDeliveredUnit).toBe(36.22);
    expect(e.contributionMarginPct).toBe(14.17);
    expect(e.maxAffordableCac).toBe(66.08);
  });

  it("computes break-even on a cash basis", () => {
    expect(e.cashPerOrderExProduct).toBe(65.6);
    expect(e.breakEvenShippedOrders).toBe(16);    // ceil(1040 / 65.6)
    expect(e.breakEvenDeliveredUnits).toBe(12);   // ceil(16 * 0.72)
    expect(e.maxShippableOrders).toBe(26);        // floor(20 / 0.76)
    expect(e.breakEvenReachable).toBe(true);
  });

  it("flags thin margins", () => {
    expect(e.warnings.some((w) => w.includes("15٪"))).toBe(true);
  });

  it("uses supplier MOQ when it exceeds the requested quantity", () => {
    const m = computeEconomics({ ...base, quantity: 5, minOrderQty: 12, pickupCostTotal: 0 });
    expect(m.purchaseQty).toBe(12);
    expect(m.inventoryCashRequired).toBe(600);
    expect(m.warnings.some((w) => w.includes("الحد الأدنى"))).toBe(true);
  });

  it("flags a negative-margin product", () => {
    const n = computeEconomics({ ...base, sellingPrice: 90 });
    expect(n.perShippedOrder.contribution).toBeLessThan(0);
    expect(n.contributionPerDeliveredUnit).toBeLessThan(0);
    expect(n.breakEvenReachable).toBe(false);
    expect(n.warnings[0]).toContain("سالبة");
  });

  it("perfect delivery with no costs equals simple price minus cost", () => {
    const s = computeEconomics({ wholesaleUnitPrice: 40, sellingPrice: 100, quantity: 10 });
    expect(s.perShippedOrder.contribution).toBe(60);
    expect(s.contributionMarginPct).toBe(60);
  });

  it("applies tax on net revenue and discounts per order", () => {
    const t = computeEconomics({ wholesaleUnitPrice: 40, sellingPrice: 100, quantity: 10, discountPerOrder: 10, taxPct: 10 });
    expect(t.perShippedOrder.netRevenue).toBe(90);
    expect(t.perShippedOrder.tax).toBe(9);
    expect(t.perShippedOrder.contribution).toBe(41); // 90 - 9 - 40
  });
});

describe("runScenarios", () => {
  it("returns pessimistic < base < optimistic and never counts unsold stock as profit", () => {
    const [p, b, o] = runScenarios(base);
    expect(p.batchResult).toBeLessThan(b.batchResult);
    expect(b.batchResult).toBeLessThan(o.batchResult);
    expect(p.unsoldUnits).toBeGreaterThan(0);
    expect(p.unsoldValueAtCost).toBeGreaterThan(0);
    // batch result = cash recovered - inventory outlay
    expect(b.batchResult).toBeCloseTo(b.cashCollectedNet - 1040, 2);
  });
});

describe("minPriceForMargin", () => {
  it("finds the lowest 5-EGP price meeting the margin", () => {
    const { sellingPrice: _ignored, ...rest } = base;
    const p = minPriceForMargin(rest, 20)!;
    expect(computeEconomics({ ...base, sellingPrice: p }).contributionMarginPct).toBeGreaterThanOrEqual(20);
    expect(computeEconomics({ ...base, sellingPrice: p - 5 }).contributionMarginPct).toBeLessThan(20);
    expect(p % 5).toBe(0);
  });
});

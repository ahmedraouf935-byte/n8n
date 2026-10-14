import { round2 } from "./money";

/**
 * Unit economics for Egyptian COD-style micro-commerce.
 *
 * Model (expected values per SHIPPED order; ad cost is per shipped/confirmed order):
 *   - A share `failedDeliveryRate` of shipped orders is refused/undeliverable: nothing is collected,
 *     the carrier fee is still paid, a return-to-origin fee is paid, and the goods come back to stock.
 *   - Of delivered orders, a share `returnRate` is returned by the customer later: the product price is
 *     refunded (the shipping fee is NOT refunded), a return cost is paid, and only a share
 *     `resellableReturnRate` of returned goods can be resold.
 *   - The shipping fee charged to the customer is revenue that is only collected on delivered orders;
 *     the carrier's cost is paid on every shipped order. They are never netted silently.
 *
 * Outputs are CONTRIBUTION figures (before fixed costs such as salaries, rent, tools), never "net profit".
 */
export interface EconomicsInput {
  wholesaleUnitPrice: number;
  sellingPrice: number;            // product price per unit charged to the customer
  quantity: number;                // units the owner intends to buy
  minOrderQty?: number;            // supplier MOQ; purchase quantity is max(quantity, MOQ)
  pickupCostTotal?: number;        // transport to collect goods from the supplier (whole batch)
  packagingPerOrder?: number;
  carrierCostPerOrder?: number;    // what the courier charges us per shipped order
  shippingFeeCharged?: number;     // what we charge the customer for shipping
  codFeePct?: number;              // % of collected amount (COD/payment collection)
  codFeeFixed?: number;            // fixed fee per collected order
  adCostPerOrder?: number;         // customer acquisition cost per shipped order
  failedDeliveryRate?: number;     // 0..1 share of shipped orders refused/undeliverable
  failedDeliveryCost?: number;     // return-to-origin fee per failed order
  returnRate?: number;             // 0..1 share of DELIVERED orders later returned
  returnCost?: number;             // cost per customer return (pickup/handling)
  resellableReturnRate?: number;   // 0..1 share of returned units that can be resold
  discountPerOrder?: number;
  taxPct?: number;                 // % of net revenue (0 by default; configure if registered)
  otherCostPerUnit?: number;
  unitsPerOrder?: number;
}

export interface Assumption {
  key: string;
  label: string;
  value: number | string;
}

export interface EconomicsResult {
  purchaseQty: number;
  landedUnitCost: number;
  inventoryCashRequired: number;
  probabilities: { deliver: number; customerReturn: number; keep: number };
  perShippedOrder: {
    productRevenue: number;
    shippingFeeIncome: number;
    refunds: number;
    netRevenue: number;
    collectionFees: number;
    carrierCost: number;
    failedDeliveryCost: number;
    returnCost: number;
    packaging: number;
    advertising: number;
    productCost: number;
    otherCost: number;
    tax: number;
    contribution: number;
  };
  contributionPerDeliveredUnit: number;   // per unit the customer keeps
  contributionMarginPct: number;          // contribution / net revenue
  maxAffordableCac: number;               // ad cost per order at which contribution = 0
  cashPerOrderExProduct: number;          // cash recovered per shipped order, product already paid
  breakEvenShippedOrders: number | null;  // orders needed to recover the inventory outlay
  breakEvenDeliveredUnits: number | null;
  maxShippableOrders: number;             // orders the batch can serve (failed deliveries restock)
  breakEvenReachable: boolean;
  unitsPerOrder: number;
  assumptions: Assumption[];
  warnings: string[];
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

export function computeEconomics(input: EconomicsInput): EconomicsResult {
  const u = Math.max(1, Math.floor(input.unitsPerOrder ?? 1));
  const moq = Math.max(1, Math.floor(input.minOrderQty ?? 1));
  const purchaseQty = Math.max(Math.floor(input.quantity), moq);
  const pickup = input.pickupCostTotal ?? 0;
  const f = clamp01(input.failedDeliveryRate ?? 0);
  const r = clamp01(input.returnRate ?? 0);
  const resell = clamp01(input.resellableReturnRate ?? 1);
  const codPct = (input.codFeePct ?? 0) / 100;
  const taxPct = (input.taxPct ?? 0) / 100;

  const landedUnitCost = input.wholesaleUnitPrice + (purchaseQty > 0 ? pickup / purchaseQty : 0);
  const inventoryCashRequired = round2(purchaseQty * input.wholesaleUnitPrice + pickup);

  const pDeliver = 1 - f;
  const pReturn = pDeliver * r;
  const pKeep = pDeliver * (1 - r);

  const discount = input.discountPerOrder ?? 0;
  const orderProductValue = Math.max(0, input.sellingPrice * u - discount);
  const shipFee = input.shippingFeeCharged ?? 0;

  const productRevenue = pDeliver * orderProductValue;
  const shippingFeeIncome = pDeliver * shipFee;
  const refunds = pReturn * orderProductValue;
  const netRevenue = productRevenue + shippingFeeIncome - refunds;
  const collectionFees = pDeliver * ((orderProductValue + shipFee) * codPct + (input.codFeeFixed ?? 0));
  const carrierCost = input.carrierCostPerOrder ?? 0;
  const failedDeliveryCost = f * (input.failedDeliveryCost ?? 0);
  const returnCost = pReturn * (input.returnCost ?? 0);
  const packaging = input.packagingPerOrder ?? 0;
  const advertising = input.adCostPerOrder ?? 0;
  // Units consumed per shipped order: kept units + returned units that cannot be resold.
  const unitsConsumedPerOrder = u * (pKeep + pReturn * (1 - resell));
  const productCost = unitsConsumedPerOrder * landedUnitCost;
  const otherCost = pDeliver * u * (input.otherCostPerUnit ?? 0);
  const tax = Math.max(0, netRevenue) * taxPct;

  const contribution =
    netRevenue - collectionFees - carrierCost - failedDeliveryCost - returnCost - packaging - advertising - productCost - otherCost - tax;

  const keptUnitsPerOrder = pKeep * u;
  const contributionPerDeliveredUnit = keptUnitsPerOrder > 0 ? contribution / keptUnitsPerOrder : -Infinity;
  const contributionMarginPct = netRevenue > 0 ? (contribution / netRevenue) * 100 : -100;
  const maxAffordableCac = contribution + advertising;

  // Cash view: inventory is paid upfront, so each order recovers contribution + its product cost.
  const cashPerOrderExProduct = contribution + productCost;
  const maxShippableOrders = unitsConsumedPerOrder > 0 ? Math.floor(purchaseQty / unitsConsumedPerOrder) : 0;
  let breakEvenShippedOrders: number | null = null;
  let breakEvenDeliveredUnits: number | null = null;
  if (cashPerOrderExProduct > 0) {
    breakEvenShippedOrders = Math.ceil(inventoryCashRequired / cashPerOrderExProduct);
    breakEvenDeliveredUnits = Math.ceil(breakEvenShippedOrders * keptUnitsPerOrder);
  }
  const breakEvenReachable = breakEvenShippedOrders !== null && breakEvenShippedOrders <= maxShippableOrders;

  const warnings: string[] = [];
  if (contribution <= 0) warnings.push("المساهمة لكل طلب سالبة أو صفر — المنتج يخسر مع كل طلب بالافتراضات الحالية.");
  else if (contributionMarginPct < 15) warnings.push("هامش المساهمة أقل من 15٪ — أي زيادة في المرتجعات أو الإعلانات قد تمحو الربح.");
  if (!breakEvenReachable) warnings.push("لا يمكن استرداد تكلفة المخزون حتى لو بيعت الدفعة بالكامل بالافتراضات الحالية.");
  if (moq > input.quantity) warnings.push(`الحد الأدنى للطلب عند المورد (${moq}) أكبر من الكمية المطلوبة — تم الحساب على ${moq}.`);
  if (shipFee < carrierCost) warnings.push("رسوم الشحن المحصّلة من العميل أقل من تكلفة شركة الشحن — الفرق يُخصم من الهامش.");

  const assumptions: Assumption[] = [
    { key: "wholesaleUnitPrice", label: "سعر الجملة للقطعة", value: input.wholesaleUnitPrice },
    { key: "sellingPrice", label: "سعر البيع للقطعة", value: input.sellingPrice },
    { key: "purchaseQty", label: "كمية الشراء الفعلية", value: purchaseQty },
    { key: "pickupCostTotal", label: "مواصلات الاستلام (للدفعة)", value: pickup },
    { key: "packagingPerOrder", label: "تغليف لكل طلب", value: packaging },
    { key: "carrierCostPerOrder", label: "تكلفة شركة الشحن لكل طلب مشحون", value: carrierCost },
    { key: "shippingFeeCharged", label: "رسوم الشحن على العميل (تُحصَّل عند التسليم فقط)", value: shipFee },
    { key: "codFeePct", label: "عمولة التحصيل ٪", value: input.codFeePct ?? 0 },
    { key: "codFeeFixed", label: "رسوم تحصيل ثابتة", value: input.codFeeFixed ?? 0 },
    { key: "adCostPerOrder", label: "تكلفة إعلان لكل طلب", value: advertising },
    { key: "failedDeliveryRate", label: "نسبة فشل التسليم", value: f },
    { key: "failedDeliveryCost", label: "تكلفة المرتجع عند فشل التسليم", value: input.failedDeliveryCost ?? 0 },
    { key: "returnRate", label: "نسبة الإرجاع بعد التسليم", value: r },
    { key: "returnCost", label: "تكلفة الإرجاع", value: input.returnCost ?? 0 },
    { key: "resellableReturnRate", label: "نسبة المرتجعات القابلة لإعادة البيع", value: resell },
    { key: "discountPerOrder", label: "خصم لكل طلب", value: discount },
    { key: "taxPct", label: "ضرائب ٪ من صافي الإيراد", value: input.taxPct ?? 0 },
    { key: "otherCostPerUnit", label: "تكاليف متغيرة أخرى للقطعة", value: input.otherCostPerUnit ?? 0 },
    { key: "unitsPerOrder", label: "قطع لكل طلب", value: u },
  ];

  return {
    purchaseQty,
    landedUnitCost: round2(landedUnitCost),
    inventoryCashRequired,
    probabilities: { deliver: round2(pDeliver), customerReturn: round2(pReturn), keep: round2(pKeep) },
    perShippedOrder: {
      productRevenue: round2(productRevenue),
      shippingFeeIncome: round2(shippingFeeIncome),
      refunds: round2(refunds),
      netRevenue: round2(netRevenue),
      collectionFees: round2(collectionFees),
      carrierCost: round2(carrierCost),
      failedDeliveryCost: round2(failedDeliveryCost),
      returnCost: round2(returnCost),
      packaging: round2(packaging),
      advertising: round2(advertising),
      productCost: round2(productCost),
      otherCost: round2(otherCost),
      tax: round2(tax),
      contribution: round2(contribution),
    },
    contributionPerDeliveredUnit: Number.isFinite(contributionPerDeliveredUnit) ? round2(contributionPerDeliveredUnit) : -Infinity,
    contributionMarginPct: round2(contributionMarginPct),
    maxAffordableCac: round2(maxAffordableCac),
    cashPerOrderExProduct: round2(cashPerOrderExProduct),
    breakEvenShippedOrders,
    breakEvenDeliveredUnits,
    maxShippableOrders,
    breakEvenReachable,
    unitsPerOrder: u,
    assumptions,
    warnings,
  };
}

export type ScenarioName = "pessimistic" | "base" | "optimistic";

export interface ScenarioSpec {
  name: ScenarioName;
  label: string;
  sellThrough: number;           // share of the batch actually consumed by orders in the test window
  failedDeliveryMultiplier: number;
  returnMultiplier: number;
  adCostMultiplier: number;
}

export const DEFAULT_SCENARIOS: ScenarioSpec[] = [
  { name: "pessimistic", label: "متشائم", sellThrough: 0.4, failedDeliveryMultiplier: 1.5, returnMultiplier: 1.5, adCostMultiplier: 1.5 },
  { name: "base", label: "أساسي", sellThrough: 0.75, failedDeliveryMultiplier: 1, returnMultiplier: 1, adCostMultiplier: 1 },
  { name: "optimistic", label: "متفائل", sellThrough: 1, failedDeliveryMultiplier: 0.7, returnMultiplier: 0.7, adCostMultiplier: 0.75 },
];

export interface ScenarioResult {
  name: ScenarioName;
  label: string;
  sellThrough: number;
  shippedOrders: number;
  deliveredUnits: number;
  cashCollectedNet: number;       // cash recovered from orders (after all per-order costs, excluding inventory)
  batchResult: number;            // cashCollectedNet - inventory outlay (unsold stock NOT counted as profit)
  unsoldUnits: number;
  unsoldValueAtCost: number;      // cash still tied up in stock
  contributionPerDeliveredUnit: number;
  contributionMarginPct: number;
  economics: EconomicsResult;
}

export function runScenarios(input: EconomicsInput, specs: ScenarioSpec[] = DEFAULT_SCENARIOS): ScenarioResult[] {
  return specs.map((s) => {
    const adjusted: EconomicsInput = {
      ...input,
      failedDeliveryRate: Math.min(0.9, (input.failedDeliveryRate ?? 0) * s.failedDeliveryMultiplier),
      returnRate: Math.min(0.9, (input.returnRate ?? 0) * s.returnMultiplier),
      adCostPerOrder: (input.adCostPerOrder ?? 0) * s.adCostMultiplier,
    };
    const e = computeEconomics(adjusted);
    const unitsPerOrderConsumed = e.unitsPerOrder * (e.probabilities.keep + e.probabilities.customerReturn * (1 - (input.resellableReturnRate ?? 1)));
    const unitsToConsume = Math.floor(e.purchaseQty * s.sellThrough);
    const shippedOrders = unitsPerOrderConsumed > 0 ? Math.floor(unitsToConsume / unitsPerOrderConsumed) : 0;
    const consumed = Math.min(e.purchaseQty, Math.round(shippedOrders * unitsPerOrderConsumed));
    const deliveredUnits = Math.round(shippedOrders * e.probabilities.keep * e.unitsPerOrder);
    const cashCollectedNet = round2(shippedOrders * e.cashPerOrderExProduct);
    const unsoldUnits = e.purchaseQty - consumed;
    return {
      name: s.name,
      label: s.label,
      sellThrough: s.sellThrough,
      shippedOrders,
      deliveredUnits,
      cashCollectedNet,
      batchResult: round2(cashCollectedNet - e.inventoryCashRequired),
      unsoldUnits,
      unsoldValueAtCost: round2(unsoldUnits * e.landedUnitCost),
      contributionPerDeliveredUnit: e.contributionPerDeliveredUnit,
      contributionMarginPct: e.contributionMarginPct,
      economics: e,
    };
  });
}

/** Lowest selling price (rounded up to 5 EGP) that reaches the target contribution margin. */
export function minPriceForMargin(input: Omit<EconomicsInput, "sellingPrice">, targetMarginPct: number): number | null {
  let lo = 0;
  let hi = Math.max(50, input.wholesaleUnitPrice * 20);
  const margin = (p: number) => computeEconomics({ ...input, sellingPrice: p }).contributionMarginPct;
  if (margin(hi) < targetMarginPct) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (margin(mid) >= targetMarginPct) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi / 5) * 5;
}

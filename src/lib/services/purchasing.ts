import { z } from "zod";
import type { Db, Sql } from "../db/client";
import { computeEconomics, runScenarios } from "../domain/economics";
import { checkPurchaseGates, type GateResult } from "../domain/gates";
import { round2 } from "../domain/money";
import type { RiskCategory } from "../domain/scoring";
import { cairoDateKey } from "../domain/time";
import { analyzeVariant, economicsDefaults } from "./analysis";
import { audit, type Actor } from "./audit";
import { addLedgerEntry, getCashPosition } from "./cash";
import { DomainError } from "./errors";
import { addExpense } from "./expenses";
import { receiveStock } from "./inventory";
import { notify } from "./notifications";
import { getSettings } from "./settings";
import { getDatabaseEnvironment } from "../db/migrate";

export const PurchaseRequestSchema = z.object({
  variantId: z.number().int().positive(),
  supplierOfferId: z.number().int().positive(),
  quantity: z.number().int().positive().max(10_000),
  sellingPrice: z.number().positive(),
  pickupCost: z.number().min(0).optional(),
  complianceAck: z.boolean().default(false),
});

async function evaluateGates(db: Db, p: z.infer<typeof PurchaseRequestSchema>) {
  const settings = await getSettings(db);
  const analysis = await analyzeVariant(db, p.variantId);
  if (!analysis) throw new DomainError("المنتج غير موجود");
  const offer = analysis.supplierOffers.find((o) => o.id === p.supplierOfferId);
  if (!offer) throw new DomainError("عرض المورد غير مرتبط بهذا المنتج");
  if (!offer.effectivePrice) throw new DomainError("لا يوجد سعر جملة مؤكد لهذا العرض");
  const [variant] = await db<{ verified: boolean; risk_category: RiskCategory; product_id: number }[]>`
    SELECT v.verified, p.risk_category, p.id AS product_id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ${p.variantId}`;

  const pickup = p.pickupCost ?? settings.unit_economics_defaults.pickup_cost_total;
  const input = { ...economicsDefaults(settings), wholesaleUnitPrice: offer.effectivePrice, sellingPrice: p.sellingPrice, quantity: p.quantity,
    minOrderQty: offer.minOrderQty, pickupCostTotal: pickup };
  const economics = computeEconomics(input);
  const scenarios = runScenarios(input);
  const plannedTotalCost = economics.inventoryCashRequired;

  const cash = await getCashPosition(db);
  const [{ n: activeTests }] = await db<{ n: number }[]>`
    SELECT count(DISTINCT p.id)::int AS n FROM products p WHERE p.status = 'testing' AND p.id <> ${variant.product_id}`;
  // pending decisions already approved but not yet turned into paid POs are inside committedUnpaid via purchase_orders
  const env = await getDatabaseEnvironment(db as Sql);
  const { approved, gates } = checkPurchaseGates({
    quantity: economics.purchaseQty,
    plannedTotalCost,
    variantVerified: variant.verified,
    offerMatchStatus: offer.matchStatus as "confirmed",
    verification: offer.verification
      ? { result: offer.verification.result, validUntil: offer.verification.valid_until, confirmedQuantity: offer.verification.confirmed_quantity }
      : null,
    availableCash: cash.cashBalance,
    committedCash: cash.committedUnpaid,
    inventoryBudgetRemaining: cash.inventoryBudgetRemaining,
    maxTestSpendPerProduct: settings.risk.max_test_spend_per_product,
    activeTests,
    maxConcurrentTests: settings.risk.max_concurrent_tests,
    economicsBase: { contributionPerDeliveredUnit: economics.contributionPerDeliveredUnit, marginPct: economics.contributionMarginPct },
    economicsPessimistic: { batchResult: scenarios[0].batchResult },
    minMarginPct: settings.risk.min_margin_pct,
    scoreConfidence: analysis.score.confidence,
    riskCategory: variant.risk_category,
    complianceAck: p.complianceAck,
    requireComplianceFor: settings.risk.require_compliance_ack_for,
    blockedCategories: settings.risk.blocked_categories,
    isDemoData: env === "demo",
    productionEnvironment: env === "production",
  });
  return { approved, gates, economics, scenarios, offer, plannedTotalCost, pickup, analysis, productId: variant.product_id };
}

/** Creates a pending purchase decision with its gate evaluation. Never buys anything. */
export async function requestPurchase(db: Db, actor: Actor, raw: unknown) {
  const p = PurchaseRequestSchema.parse(raw);
  const ev = await evaluateGates(db, p);
  const [opp] = await db<{ id: number }[]>`SELECT id FROM opportunities WHERE variant_id = ${p.variantId}`;
  const [row] = await db<{ id: number }[]>`
    INSERT INTO purchase_decisions (opportunity_id, variant_id, supplier_offer_id, verification_id, quantity, unit_cost, pickup_cost,
      planned_total_cost, planned_sell_price, compliance_ack, gate_results, economics, requested_by)
    VALUES (${opp?.id ?? null}, ${p.variantId}, ${p.supplierOfferId}, ${ev.offer.verification?.id ?? null}, ${ev.economics.purchaseQty},
      ${ev.offer.effectivePrice!}, ${ev.pickup}, ${ev.plannedTotalCost}, ${p.sellingPrice}, ${p.complianceAck},
      ${db.json(ev.gates as never)}, ${db.json({ base: ev.economics, scenarios: ev.scenarios.map(({ economics: _e, ...s }) => s) } as never)}, ${actor.id})
    RETURNING id`;
  if (opp) await db`UPDATE opportunities SET status = 'awaiting_approval' WHERE id = ${opp.id}`;
  await audit(db, actor, "purchase_decision.request", "purchase_decisions", row.id, null, { ...p, gatesPassed: ev.approved });
  await notify(db, {
    kind: "approval_needed", severity: "info", channel: "telegram", dedupeKey: `decision:${row.id}`,
    title: "قرار شراء بانتظار موافقتك",
    body: `طلب شراء ${ev.economics.purchaseQty} قطعة بتكلفة ${ev.plannedTotalCost} ج.م — ${ev.approved ? "كل بوابات الأمان ناجحة" : "بوابات أمان غير مستوفاة"}.`,
  });
  return { decisionId: row.id, gatesPassed: ev.approved, gates: ev.gates };
}

/**
 * Owner approval. Gates are RE-EVALUATED inside a serialized transaction (cash or verification may have changed).
 * On success a purchase order is created; no money moves until the owner records the payment.
 */
export async function approvePurchase(sql: Sql, actor: Actor & { role?: string }, decisionId: number) {
  if (!actor.id || (actor.role && actor.role !== "owner")) throw new DomainError("الموافقة على الشراء للمالك فقط", "forbidden");
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(4242)`; // one spending decision at a time
    const [d] = await tx<{ id: number; status: string; variant_id: number; supplier_offer_id: number; quantity: number; planned_sell_price: number;
      pickup_cost: number; compliance_ack: boolean }[]>`SELECT * FROM purchase_decisions WHERE id = ${decisionId} FOR UPDATE`;
    if (!d) throw new DomainError("القرار غير موجود");
    if (d.status !== "pending") throw new DomainError("تم اتخاذ قرار بالفعل في هذا الطلب");
    const ev = await evaluateGates(tx, { variantId: d.variant_id, supplierOfferId: d.supplier_offer_id, quantity: d.quantity,
      sellingPrice: d.planned_sell_price, pickupCost: d.pickup_cost, complianceAck: d.compliance_ack });
    await tx`UPDATE purchase_decisions SET gate_results = ${tx.json(ev.gates as never)} WHERE id = ${decisionId}`;
    if (!ev.approved) {
      const failed = ev.gates.filter((g: GateResult) => !g.passed && g.severity === "block").map((g: GateResult) => g.message);
      return { approved: false as const, failed, gates: ev.gates };
    }
    await tx`UPDATE purchase_decisions SET status = 'approved', decided_by = ${actor.id}, decided_at = now() WHERE id = ${decisionId}`;
    const [{ supplier_id }] = await tx<{ supplier_id: number }[]>`SELECT supplier_id FROM supplier_offers WHERE id = ${d.supplier_offer_id}`;
    const unit = ev.offer.effectivePrice!;
    const qty = ev.economics.purchaseQty;
    const poNumber = `PO-${cairoDateKey().replace(/-/g, "")}-${decisionId}`;
    const [po] = await tx<{ id: number }[]>`
      INSERT INTO purchase_orders (po_number, decision_id, supplier_id, variant_id, quantity_ordered, unit_cost, pickup_cost, total_cost)
      VALUES (${poNumber}, ${decisionId}, ${supplier_id}, ${d.variant_id}, ${qty}, ${unit}, ${d.pickup_cost}, ${round2(qty * unit)})
      RETURNING id`;
    await tx`UPDATE opportunities SET status = 'approved' WHERE variant_id = ${d.variant_id}`;
    await tx`UPDATE products SET status = 'testing' WHERE id = ${ev.productId}`;
    await audit(tx, actor, "purchase_decision.approve", "purchase_decisions", decisionId, { status: "pending" },
      { status: "approved", purchaseOrderId: po.id, poNumber, total: round2(qty * unit) });
    return { approved: true as const, purchaseOrderId: po.id, poNumber };
  });
}

export async function rejectPurchase(db: Db, actor: Actor, decisionId: number, reason: string) {
  if (!actor.id) throw new DomainError("القرار للمالك فقط", "forbidden");
  const [d] = await db<{ variant_id: number }[]>`
    UPDATE purchase_decisions SET status = 'rejected', decided_by = ${actor.id}, decided_at = now(), reason = ${reason}
    WHERE id = ${decisionId} AND status = 'pending' RETURNING variant_id`;
  if (!d) throw new DomainError("لا يمكن رفض هذا الطلب");
  await db`UPDATE opportunities SET status = 'rejected' WHERE variant_id = ${d.variant_id}`;
  await audit(db, actor, "purchase_decision.reject", "purchase_decisions", decisionId, null, { reason });
}

export async function recordPoPayment(sql: Sql, actor: Actor, poId: number, amount: number) {
  if (!(amount > 0)) throw new DomainError("المبلغ غير صالح");
  return sql.begin(async (tx) => {
    const [po] = await tx<{ total_cost: number; paid_amount: number; status: string; po_number: string }[]>`
      SELECT total_cost, paid_amount, status, po_number FROM purchase_orders WHERE id = ${poId} FOR UPDATE`;
    if (!po || po.status === "cancelled") throw new DomainError("أمر الشراء غير صالح");
    if (round2(po.paid_amount + amount) > po.total_cost) throw new DomainError(`المبلغ يتجاوز المتبقي (${round2(po.total_cost - po.paid_amount)} ج.م)`);
    await tx`UPDATE purchase_orders SET paid_amount = paid_amount + ${amount} WHERE id = ${poId}`;
    await addLedgerEntry(tx, actor, { type: "purchase_payment", amount: -amount, description: `دفع للمورد ${po.po_number}`, refType: "purchase_order", refId: poId });
    await audit(tx, actor, "purchase_order.pay", "purchase_orders", poId, { paid: po.paid_amount }, { paid: round2(po.paid_amount + amount) });
  });
}

/** Records goods received against a PO; updates inventory with landed cost (goods + actual pickup transport). */
export async function receivePurchaseOrder(sql: Sql, actor: Actor, poId: number, p: { quantity: number; actualPickupCost?: number; note?: string }) {
  return sql.begin(async (tx) => {
    const [po] = await tx<{ variant_id: number; quantity_ordered: number; quantity_received: number; unit_cost: number; status: string; po_number: string }[]>`
      SELECT variant_id, quantity_ordered, quantity_received, unit_cost, status, po_number FROM purchase_orders WHERE id = ${poId} FOR UPDATE`;
    if (!po || po.status === "cancelled" || po.status === "received") throw new DomainError("أمر الشراء غير صالح للاستلام");
    if (p.quantity < 1 || po.quantity_received + p.quantity > po.quantity_ordered)
      throw new DomainError(`الكمية تتجاوز المتبقي (${po.quantity_ordered - po.quantity_received})`);
    const pickup = p.actualPickupCost ?? 0;
    if (pickup > 0) await addExpense(tx, actor, { category: "transport", amount: pickup, description: `مواصلات استلام ${po.po_number}`, variantId: po.variant_id });
    const landed = po.unit_cost + pickup / p.quantity;
    const res = await receiveStock(tx, actor, { variantId: po.variant_id, quantity: p.quantity, landedUnitCost: landed, purchaseOrderId: poId, note: p.note });
    const received = po.quantity_received + p.quantity;
    await tx`UPDATE purchase_orders SET quantity_received = ${received},
             status = ${received === po.quantity_ordered ? "received" : "partially_received"},
             received_at = CASE WHEN ${received === po.quantity_ordered} THEN now() ELSE received_at END WHERE id = ${poId}`;
    await audit(tx, actor, "purchase_order.receive", "purchase_orders", poId, { received: po.quantity_received }, { received, landedUnitCost: round2(landed) });
    return { ...res, received };
  });
}

export async function cancelPurchaseOrder(db: Db, actor: Actor, poId: number, reason: string) {
  const [po] = await db<{ paid_amount: number; quantity_received: number }[]>`SELECT paid_amount, quantity_received FROM purchase_orders WHERE id = ${poId}`;
  if (!po) throw new DomainError("أمر الشراء غير موجود");
  if (po.quantity_received > 0 || po.paid_amount > 0) throw new DomainError("لا يمكن إلغاء أمر تم الدفع أو الاستلام عليه — سجّل مرتجعًا/تسوية بدلًا من ذلك");
  await db`UPDATE purchase_orders SET status = 'cancelled', notes = ${reason} WHERE id = ${poId}`;
  await audit(db, actor, "purchase_order.cancel", "purchase_orders", poId, null, { reason });
}

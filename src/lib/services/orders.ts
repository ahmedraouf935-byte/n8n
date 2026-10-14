import { z } from "zod";
import type { Sql, Tx } from "../db/client";
import { round2 } from "../domain/money";
import { canTransition, type OrderStatus } from "../domain/orders";
import { cairoDateKey } from "../domain/time";
import { audit, type Actor } from "./audit";
import { addLedgerEntry } from "./cash";
import { DomainError } from "./errors";
import { addExpense } from "./expenses";
import { applyStock } from "./inventory";

export const OrderSchema = z.object({
  customer: z.object({
    name: z.string().min(2).max(200),
    phone: z.string().regex(/^\+?[0-9]{8,15}$/, "رقم هاتف غير صالح"),
    city: z.string().max(100).optional().nullable(),
    address: z.string().max(500).optional().nullable(),
  }),
  channel: z.enum(["facebook", "instagram", "whatsapp", "tiktok", "other"]).default("whatsapp"),
  paymentMethod: z.enum(["cod", "instapay", "vodafone_cash", "bank", "cash", "other"]).default("cod"),
  items: z.array(z.object({ variantId: z.number().int().positive(), quantity: z.number().int().positive(), unitPrice: z.number().min(0) })).min(1),
  shippingFeeCharged: z.number().min(0).default(0),
  discountTotal: z.number().min(0).default(0),
  campaignId: z.number().int().positive().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export async function createOrder(sql: Sql, actor: Actor, raw: unknown) {
  const o = OrderSchema.parse(raw);
  const subtotal = round2(o.items.reduce((a, i) => a + i.quantity * i.unitPrice, 0));
  if (o.discountTotal > subtotal) throw new DomainError("الخصم أكبر من قيمة الطلب");
  const totalDue = round2(subtotal - o.discountTotal + o.shippingFeeCharged);
  return sql.begin(async (tx) => {
    const [c] = await tx<{ id: number }[]>`
      INSERT INTO customers (name, phone, city, address) VALUES (${o.customer.name}, ${o.customer.phone}, ${o.customer.city ?? null}, ${o.customer.address ?? null})
      ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, city = COALESCE(EXCLUDED.city, customers.city), address = COALESCE(EXCLUDED.address, customers.address)
      RETURNING id`;
    const [{ seq }] = await tx<{ seq: number }[]>`SELECT count(*)::int + 1 AS seq FROM sales_orders WHERE created_at::date = now()::date`;
    const orderNumber = `SO-${cairoDateKey().replace(/-/g, "")}-${String(seq).padStart(3, "0")}-${Math.random().toString(36).slice(2, 5)}`;
    const [order] = await tx<{ id: number }[]>`
      INSERT INTO sales_orders (order_number, customer_id, channel, campaign_id, payment_method, subtotal, discount_total, shipping_fee_charged, total_due,
        delivery_address, city, notes, created_by)
      VALUES (${orderNumber}, ${c.id}, ${o.channel}, ${o.campaignId ?? null}, ${o.paymentMethod}, ${subtotal}, ${o.discountTotal}, ${o.shippingFeeCharged},
        ${totalDue}, ${o.customer.address ?? null}, ${o.customer.city ?? null}, ${o.notes ?? null}, ${actor.id})
      RETURNING id`;
    for (const i of o.items) {
      await tx`INSERT INTO order_items (order_id, variant_id, quantity, unit_price) VALUES (${order.id}, ${i.variantId}, ${i.quantity}, ${i.unitPrice})`;
    }
    await audit(tx, actor, "order.create", "sales_orders", order.id, null, { orderNumber, subtotal, totalDue, items: o.items });
    return { orderId: order.id, orderNumber, totalDue };
  });
}

type Item = { id: number; variant_id: number; quantity: number; returned_quantity: number; unit_cost_snapshot: number | null; unit_price: number };

async function lockOrder(tx: Tx, orderId: number) {
  const [o] = await tx<{ id: number; status: OrderStatus; total_due: number; payment_method: string; order_number: string; reconciled_at: Date | null }[]>`
    SELECT id, status, total_due, payment_method, order_number, reconciled_at FROM sales_orders WHERE id = ${orderId} FOR UPDATE`;
  if (!o) throw new DomainError("الطلب غير موجود");
  const items = await tx<Item[]>`SELECT id, variant_id, quantity, returned_quantity, unit_cost_snapshot, unit_price FROM order_items WHERE order_id = ${orderId} ORDER BY id`;
  return { o, items };
}

export interface TransitionExtra {
  carrier?: string;
  trackingNumber?: string;
  carrierCost?: number;          // charged by courier for this shipment
  packagingCost?: number;
  collected?: boolean;           // on delivery: cash actually collected/remitted now
  collectionFee?: number;
  returnCost?: number;           // on failed delivery: return-to-origin fee
  reason?: string;
}

/**
 * Moves an order through its lifecycle and applies the matching stock and cash effects in ONE transaction.
 *  confirmed : reserve stock (fails if not enough available)
 *  cancelled : release reservation
 *  packed    : optional packaging expense
 *  shipped   : stock leaves (on_hand-, reserved-, in_transit+), COGS snapshot, carrier cost paid
 *  delivered : in_transit- sold+, cash collected (if collected now) minus collection fee
 *  failed_delivery : goods return to stock, return-to-origin fee paid, nothing collected
 */
export async function transitionOrder(sql: Sql, actor: Actor, orderId: number, to: OrderStatus, extra: TransitionExtra = {}) {
  return sql.begin(async (tx) => {
    const { o, items } = await lockOrder(tx, orderId);
    if (!canTransition(o.status, to)) throw new DomainError(`لا يمكن الانتقال من "${o.status}" إلى "${to}"`, "invalid_transition");
    const ref = { type: "sales_order", id: orderId };

    switch (to) {
      case "confirmed":
        for (const i of items) await applyStock(tx, actor, i.variant_id, "reserve", { reserved: i.quantity }, ref);
        await tx`UPDATE sales_orders SET status = 'confirmed', confirmed_at = now() WHERE id = ${orderId}`;
        break;
      case "cancelled":
        if (o.status !== "new") for (const i of items) await applyStock(tx, actor, i.variant_id, "unreserve", { reserved: -i.quantity }, ref);
        await tx`UPDATE sales_orders SET status = 'cancelled', cancelled_at = now(), notes = COALESCE(${extra.reason ?? null}, notes) WHERE id = ${orderId}`;
        break;
      case "packed":
        if (extra.packagingCost && extra.packagingCost > 0)
          await addExpense(tx, actor, { category: "packaging", amount: extra.packagingCost, description: `تغليف ${o.order_number}`, orderId });
        await tx`UPDATE sales_orders SET status = 'packed', packed_at = now() WHERE id = ${orderId}`;
        break;
      case "shipped": {
        if (!extra.carrier) throw new DomainError("اختر شركة الشحن");
        for (const i of items) {
          const [lvl] = await tx<{ avg_unit_cost: number }[]>`SELECT avg_unit_cost FROM inventory_levels WHERE variant_id = ${i.variant_id}`;
          await tx`UPDATE order_items SET unit_cost_snapshot = ${lvl?.avg_unit_cost ?? 0} WHERE id = ${i.id}`;
          await applyStock(tx, actor, i.variant_id, "ship", { onHand: -i.quantity, reserved: -i.quantity, inTransit: i.quantity }, ref);
        }
        const carrierCost = extra.carrierCost ?? 0;
        await tx`INSERT INTO shipments (order_id, carrier, tracking_number, carrier_cost) VALUES (${orderId}, ${extra.carrier}, ${extra.trackingNumber ?? null}, ${carrierCost})`;
        if (carrierCost > 0) await addLedgerEntry(tx, actor, { type: "carrier_cost", amount: -carrierCost, description: `شحن ${o.order_number}`, refType: "sales_order", refId: orderId });
        await tx`UPDATE sales_orders SET status = 'shipped', shipped_at = now() WHERE id = ${orderId}`;
        break;
      }
      case "delivered": {
        for (const i of items) await applyStock(tx, actor, i.variant_id, "deliver", { inTransit: -i.quantity, sold: i.quantity }, ref);
        await tx`UPDATE shipments SET status = 'delivered', closed_at = now() WHERE order_id = ${orderId}`;
        const collected = extra.collected ?? true;
        const fee = extra.collectionFee ?? 0;
        await tx`INSERT INTO payments (order_id, direction, amount, fee_amount, method, collected_by, status, created_by)
                 VALUES (${orderId}, 'in', ${o.total_due}, ${fee}, ${o.payment_method}, ${o.payment_method === "cod" ? "carrier" : "self"},
                         ${collected ? "collected" : "pending"}, ${actor.id})`;
        if (collected) await recordCollectionLedger(tx, actor, orderId, o.order_number, o.total_due, fee);
        await tx`UPDATE sales_orders SET status = 'delivered', delivered_at = now() WHERE id = ${orderId}`;
        break;
      }
      case "failed_delivery": {
        for (const i of items) {
          await applyStock(tx, actor, i.variant_id, "return_restock", { inTransit: -i.quantity, onHand: i.quantity }, ref);
          await tx`INSERT INTO returns (order_id, order_item_id, kind, quantity, condition, return_shipping_cost, reason, created_by)
                   VALUES (${orderId}, ${i.id}, 'failed_delivery', ${i.quantity}, 'resellable', 0, ${extra.reason ?? null}, ${actor.id})`;
        }
        const rc = extra.returnCost ?? 0;
        await tx`UPDATE shipments SET status = 'failed', return_cost = ${rc}, closed_at = now() WHERE order_id = ${orderId}`;
        if (rc > 0) await addLedgerEntry(tx, actor, { type: "carrier_cost", amount: -rc, description: `مرتجع فشل تسليم ${o.order_number}`, refType: "sales_order", refId: orderId });
        await tx`UPDATE sales_orders SET status = 'failed_delivery', returned_at = now() WHERE id = ${orderId}`;
        break;
      }
      default:
        throw new DomainError("استخدم تسجيل المرتجع لهذه الحالة");
    }
    await audit(tx, actor, `order.${to}`, "sales_orders", orderId, { status: o.status }, { status: to, ...extra });
  });
}

async function recordCollectionLedger(tx: Tx, actor: Actor, orderId: number, orderNumber: string, amount: number, fee: number) {
  await addLedgerEntry(tx, actor, { type: "customer_collection", amount, description: `تحصيل ${orderNumber}`, refType: "sales_order", refId: orderId });
  if (fee > 0) await addLedgerEntry(tx, actor, { type: "collection_fee", amount: -fee, description: `عمولة تحصيل ${orderNumber}`, refType: "sales_order", refId: orderId });
}

/** Mark a pending COD remittance as actually received. */
export async function confirmCollection(sql: Sql, actor: Actor, orderId: number) {
  return sql.begin(async (tx) => {
    const { o } = await lockOrder(tx, orderId);
    const [p] = await tx<{ id: number; amount: number; fee_amount: number }[]>`
      SELECT id, amount, fee_amount FROM payments WHERE order_id = ${orderId} AND direction = 'in' AND status = 'pending' FOR UPDATE`;
    if (!p) throw new DomainError("لا يوجد تحصيل معلّق لهذا الطلب");
    await tx`UPDATE payments SET status = 'collected', occurred_at = now() WHERE id = ${p.id}`;
    await recordCollectionLedger(tx, actor, orderId, o.order_number, p.amount, p.fee_amount);
    await audit(tx, actor, "order.collection_confirmed", "sales_orders", orderId, null, { amount: p.amount });
  });
}

export const ReturnSchema = z.object({
  orderItemId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  condition: z.enum(["resellable", "defective"]),
  refundAmount: z.number().min(0),
  returnShippingCost: z.number().min(0).default(0),
  reason: z.string().max(500).optional().nullable(),
});

/** Customer return after delivery: reverses sold units, restocks or writes off, refunds cash. */
export async function recordReturn(sql: Sql, actor: Actor, orderId: number, raw: unknown) {
  const r = ReturnSchema.parse(raw);
  return sql.begin(async (tx) => {
    const { o, items } = await lockOrder(tx, orderId);
    if (o.status !== "delivered") throw new DomainError("المرتجع يُسجل فقط على طلب تم تسليمه");
    const item = items.find((i) => i.id === r.orderItemId);
    if (!item) throw new DomainError("الصنف غير موجود في الطلب");
    if (item.returned_quantity + r.quantity > item.quantity) throw new DomainError("الكمية المرتجعة أكبر من المباعة");
    const [{ refunded }] = await tx<{ refunded: number }[]>`SELECT COALESCE(SUM(amount),0) AS refunded FROM payments WHERE order_id = ${orderId} AND direction = 'refund'`;
    if (round2(refunded + r.refundAmount) > o.total_due) throw new DomainError("إجمالي المسترد أكبر من قيمة الطلب");

    const ref = { type: "sales_order", id: orderId };
    if (r.condition === "resellable") await applyStock(tx, actor, item.variant_id, "return_restock", { sold: -r.quantity, onHand: r.quantity, returned: r.quantity }, ref);
    else await applyStock(tx, actor, item.variant_id, "return_defective", { sold: -r.quantity, defective: r.quantity, returned: r.quantity }, ref);
    await tx`UPDATE order_items SET returned_quantity = returned_quantity + ${r.quantity} WHERE id = ${item.id}`;
    await tx`INSERT INTO returns (order_id, order_item_id, kind, quantity, condition, refund_amount, return_shipping_cost, reason, created_by)
             VALUES (${orderId}, ${item.id}, 'customer_return', ${r.quantity}, ${r.condition}, ${r.refundAmount}, ${r.returnShippingCost}, ${r.reason ?? null}, ${actor.id})`;
    if (r.refundAmount > 0) {
      await tx`INSERT INTO payments (order_id, direction, amount, method, collected_by, status, created_by)
               VALUES (${orderId}, 'refund', ${r.refundAmount}, ${o.payment_method}, 'self', 'collected', ${actor.id})`;
      await addLedgerEntry(tx, actor, { type: "refund", amount: -r.refundAmount, description: `استرداد ${o.order_number}`, refType: "sales_order", refId: orderId });
    }
    if (r.returnShippingCost > 0)
      await addLedgerEntry(tx, actor, { type: "carrier_cost", amount: -r.returnShippingCost, description: `شحن مرتجع ${o.order_number}`, refType: "sales_order", refId: orderId });

    const fully = items.every((i) => (i.id === item.id ? i.returned_quantity + r.quantity : i.returned_quantity) === i.quantity);
    if (fully) await tx`UPDATE sales_orders SET status = 'returned', returned_at = now() WHERE id = ${orderId}`;
    await audit(tx, actor, "order.return", "sales_orders", orderId, null, r);
  });
}

/** Actual (realized) contribution of an order from recorded facts only. */
export async function orderActuals(db: Sql | Tx, orderId: number) {
  const [money] = await db<{ collected: number; fees: number; refunds: number; pending: number }[]>`
    SELECT COALESCE(SUM(amount) FILTER (WHERE direction='in' AND status='collected'),0) AS collected,
           COALESCE(SUM(fee_amount) FILTER (WHERE direction='in' AND status='collected'),0) AS fees,
           COALESCE(SUM(amount) FILTER (WHERE direction='refund'),0) AS refunds,
           COALESCE(SUM(amount) FILTER (WHERE direction='in' AND status='pending'),0) AS pending
    FROM payments WHERE order_id = ${orderId}`;
  const [ship] = await db<{ carrier: number; ret: number }[]>`SELECT COALESCE(SUM(carrier_cost),0) AS carrier, COALESCE(SUM(return_cost),0) AS ret FROM shipments WHERE order_id = ${orderId}`;
  const [retShip] = await db<{ v: number }[]>`SELECT COALESCE(SUM(return_shipping_cost),0) AS v FROM returns WHERE order_id = ${orderId}`;
  const [exp] = await db<{ v: number }[]>`SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE order_id = ${orderId}`;
  // COGS: units that left inventory for good = delivered units minus resellable returns
  const [cogs] = await db<{ v: number }[]>`
    SELECT COALESCE(SUM(oi.unit_cost_snapshot * (oi.quantity - COALESCE(r.restocked,0))),0) AS v
    FROM order_items oi
    JOIN sales_orders so ON so.id = oi.order_id AND so.status IN ('delivered','returned')
    LEFT JOIN (SELECT order_item_id, SUM(quantity) AS restocked FROM returns WHERE kind='customer_return' AND condition='resellable' GROUP BY order_item_id) r
      ON r.order_item_id = oi.id
    WHERE oi.order_id = ${orderId}`;
  const contribution = round2(money.collected - money.fees - money.refunds - ship.carrier - ship.ret - retShip.v - exp.v - cogs.v);
  return { collected: money.collected, pendingCollection: money.pending, fees: money.fees, refunds: money.refunds, carrierCost: ship.carrier,
    returnCosts: round2(ship.ret + retShip.v), otherExpenses: exp.v, cogs: round2(cogs.v), contribution };
}

export async function reconcileOrder(sql: Sql, actor: Actor, orderId: number) {
  return sql.begin(async (tx) => {
    const { o } = await lockOrder(tx, orderId);
    if (!["delivered", "returned", "failed_delivery", "cancelled"].includes(o.status)) throw new DomainError("لا يمكن تسوية طلب لم يكتمل");
    if (o.reconciled_at) throw new DomainError("تمت التسوية بالفعل");
    const a = await orderActuals(tx, orderId);
    if (a.pendingCollection > 0) throw new DomainError("يوجد تحصيل معلّق — أكد استلام المبلغ أولًا");
    await tx`UPDATE sales_orders SET reconciled_at = now() WHERE id = ${orderId}`;
    await audit(tx, actor, "order.reconcile", "sales_orders", orderId, null, a);
    return a;
  });
}

import type { Db } from "../db/client";
import { round2 } from "../domain/money";
import { DomainError } from "./errors";
import type { Actor } from "./audit";

export type MovementType = "receive" | "reserve" | "unreserve" | "ship" | "deliver" | "return_restock" | "return_defective" | "adjust" | "damage";

export interface StockDeltas {
  onHand?: number;
  reserved?: number;
  inTransit?: number;
  sold?: number;
  returned?: number;
  defective?: number;
  received?: number;
}

/**
 * Applies a stock movement atomically: inserts the movement row and updates inventory_levels.
 * DB CHECK constraints (on_hand >= 0, reserved <= on_hand, ...) make overselling impossible;
 * violations are converted into a readable DomainError.
 */
export async function applyStock(
  db: Db, actor: Actor, variantId: number, type: MovementType, d: StockDeltas,
  ref: { type?: string; id?: number; batchId?: number | null; note?: string } = {},
) {
  await db`INSERT INTO inventory_levels (variant_id) VALUES (${variantId}) ON CONFLICT DO NOTHING`;
  try {
    await db`
      UPDATE inventory_levels SET
        on_hand = on_hand + ${d.onHand ?? 0}, reserved = reserved + ${d.reserved ?? 0}, in_transit = in_transit + ${d.inTransit ?? 0},
        sold = sold + ${d.sold ?? 0}, returned = returned + ${d.returned ?? 0}, defective = defective + ${d.defective ?? 0},
        total_received = total_received + ${d.received ?? 0}, updated_at = now()
      WHERE variant_id = ${variantId}`;
  } catch (e) {
    const msg = (e as Error).message;
    if (/check constraint/i.test(msg)) throw new DomainError("المخزون غير كافٍ لهذه العملية", "insufficient_stock", { variantId, type, d });
    throw e;
  }
  await db`
    INSERT INTO stock_movements (variant_id, batch_id, movement_type, on_hand_delta, reserved_delta, in_transit_delta, sold_delta, defective_delta,
      reference_type, reference_id, note, created_by)
    VALUES (${variantId}, ${ref.batchId ?? null}, ${type}, ${d.onHand ?? 0}, ${d.reserved ?? 0}, ${d.inTransit ?? 0}, ${d.sold ?? 0},
      ${d.defective ?? 0}, ${ref.type ?? null}, ${ref.id ?? null}, ${ref.note ?? null}, ${actor.id})`;
}

/** Receive goods: creates a batch and recalculates the weighted-average landed cost. */
export async function receiveStock(
  db: Db, actor: Actor, p: { variantId: number; quantity: number; landedUnitCost: number; purchaseOrderId?: number | null; note?: string },
) {
  if (!(p.quantity > 0)) throw new DomainError("الكمية المستلمة يجب أن تكون أكبر من صفر");
  const [lvl] = await db<{ on_hand: number; in_transit: number; avg_unit_cost: number }[]>`
    SELECT on_hand, in_transit, avg_unit_cost FROM inventory_levels WHERE variant_id = ${p.variantId} FOR UPDATE`;
  const existingUnits = (lvl?.on_hand ?? 0) + (lvl?.in_transit ?? 0);
  const newAvg = round2((existingUnits * (lvl?.avg_unit_cost ?? 0) + p.quantity * p.landedUnitCost) / (existingUnits + p.quantity));
  const [batch] = await db<{ id: number }[]>`
    INSERT INTO inventory_batches (variant_id, purchase_order_id, quantity_received, unit_cost, received_by, notes)
    VALUES (${p.variantId}, ${p.purchaseOrderId ?? null}, ${p.quantity}, ${round2(p.landedUnitCost)}, ${actor.id}, ${p.note ?? null})
    RETURNING id`;
  await applyStock(db, actor, p.variantId, "receive", { onHand: p.quantity, received: p.quantity },
    { type: "purchase_order", id: p.purchaseOrderId ?? undefined, batchId: batch.id, note: p.note });
  await db`UPDATE inventory_levels SET avg_unit_cost = ${newAvg} WHERE variant_id = ${p.variantId}`;
  return { batchId: batch.id, avgUnitCost: newAvg };
}

export async function getInventory(db: Db) {
  return db<{ variant_id: number; sku: string; label: string; name_ar: string; on_hand: number; reserved: number; in_transit: number; sold: number;
    returned: number; defective: number; total_received: number; avg_unit_cost: number; reorder_threshold: number; available: number; product_status: string }[]>`
    SELECT l.*, l.on_hand - l.reserved AS available, v.sku, v.label, p.name_ar, p.status AS product_status
    FROM inventory_levels l JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
    WHERE l.total_received > 0 OR l.on_hand > 0
    ORDER BY p.name_ar`;
}

export async function setReorderThreshold(db: Db, variantId: number, threshold: number) {
  if (!(threshold >= 0)) throw new DomainError("حد إعادة الطلب غير صالح");
  await db`UPDATE inventory_levels SET reorder_threshold = ${Math.floor(threshold)} WHERE variant_id = ${variantId}`;
}

export async function lowStock(db: Db) {
  return db<{ variant_id: number; sku: string; name_ar: string; available: number; reorder_threshold: number }[]>`
    SELECT l.variant_id, v.sku, p.name_ar, l.on_hand - l.reserved AS available, l.reorder_threshold
    FROM inventory_levels l JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
    WHERE l.total_received > 0 AND l.on_hand - l.reserved <= l.reorder_threshold AND p.status IN ('testing','active')`;
}

import type { Db } from "../db/client";
import { round2 } from "../domain/money";
import { audit, type Actor } from "./audit";
import { DomainError } from "./errors";
import { getSettings } from "./settings";

export type LedgerType =
  | "capital_in" | "capital_out" | "purchase_payment" | "expense" | "customer_collection" | "collection_fee"
  | "refund" | "carrier_cost" | "adjustment";

export async function addLedgerEntry(
  db: Db, actor: Actor, e: { type: LedgerType; amount: number; description: string; refType?: string; refId?: number; occurredAt?: Date },
) {
  const amount = round2(e.amount);
  if (amount === 0) return null;
  const [row] = await db<{ id: number }[]>`
    INSERT INTO cash_ledger (entry_type, amount, reference_type, reference_id, description, occurred_at, created_by)
    VALUES (${e.type}, ${amount}, ${e.refType ?? null}, ${e.refId ?? null}, ${e.description}, ${e.occurredAt ?? new Date()}, ${actor.id})
    RETURNING id`;
  return row.id;
}

export async function recordCapital(db: Db, actor: Actor, amount: number, note: string) {
  if (!(amount > 0)) throw new DomainError("المبلغ يجب أن يكون أكبر من صفر");
  const id = await addLedgerEntry(db, actor, { type: "capital_in", amount, description: note || "إيداع رأس مال" });
  await audit(db, actor, "cash.capital_in", "cash_ledger", id, null, { amount, note });
  return id;
}

export interface CashPosition {
  cashBalance: number;            // real cash according to the ledger
  capitalIn: number;
  committedUnpaid: number;        // approved purchase orders not yet paid
  freeCash: number;               // cash - committed
  inventoryAtCost: number;        // stock on hand + in transit valued at average landed cost
  pendingReceiptValue: number;    // ordered, not yet received
  inventoryBudget: number;
  inventoryBudgetRemaining: number;
  adBudget: number;
  adSpent: number;
  hasCapitalRecorded: boolean;
}

export async function getCashPosition(db: Db): Promise<CashPosition> {
  const settings = await getSettings(db);
  const [ledger] = await db<{ balance: number; capital_in: number }[]>`
    SELECT COALESCE(SUM(amount),0) AS balance,
           COALESCE(SUM(amount) FILTER (WHERE entry_type = 'capital_in'),0) AS capital_in
    FROM cash_ledger`;
  const [po] = await db<{ committed: number; pending: number }[]>`
    SELECT COALESCE(SUM(total_cost - paid_amount),0) AS committed,
           COALESCE(SUM((quantity_ordered - quantity_received) * unit_cost),0) AS pending
    FROM purchase_orders WHERE status <> 'cancelled'`;
  const [inv] = await db<{ value: number }[]>`
    SELECT COALESCE(SUM((on_hand + in_transit) * avg_unit_cost),0) AS value FROM inventory_levels`;
  const [ads] = await db<{ spent: number }[]>`SELECT COALESCE(SUM(amount),0) AS spent FROM expenses WHERE category = 'advertising'`;
  const inventoryBudget = settings.capital.allocations.inventory;
  const tied = inv.value + po.pending;
  return {
    cashBalance: round2(ledger.balance),
    capitalIn: round2(ledger.capital_in),
    committedUnpaid: round2(po.committed),
    freeCash: round2(ledger.balance - po.committed),
    inventoryAtCost: round2(inv.value),
    pendingReceiptValue: round2(po.pending),
    inventoryBudget,
    inventoryBudgetRemaining: round2(inventoryBudget - tied),
    adBudget: settings.capital.allocations.advertising,
    adSpent: round2(ads.spent),
    hasCapitalRecorded: ledger.capital_in > 0,
  };
}

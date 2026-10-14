import { z } from "zod";
import type { Db } from "../db/client";
import { audit, type Actor } from "./audit";
import { addLedgerEntry } from "./cash";

export const ExpenseSchema = z.object({
  category: z.enum(["advertising", "packaging", "transport", "shipping", "payment_fees", "returns", "tools", "software", "other"]),
  amount: z.number().positive(),
  description: z.string().min(2).max(500),
  variantId: z.number().int().positive().optional().nullable(),
  campaignId: z.number().int().positive().optional().nullable(),
  orderId: z.number().int().positive().optional().nullable(),
  receiptUrl: z.string().url().optional().nullable(),
  incurredAt: z.coerce.date().optional(),
});

/** Every expense is also a cash-out ledger entry, so the cash balance can never silently drift. */
export async function addExpense(db: Db, actor: Actor, raw: unknown) {
  const e = ExpenseSchema.parse(raw);
  const [row] = await db<{ id: number }[]>`
    INSERT INTO expenses (category, amount, description, variant_id, campaign_id, order_id, receipt_url, incurred_at, created_by)
    VALUES (${e.category}, ${e.amount}, ${e.description}, ${e.variantId ?? null}, ${e.campaignId ?? null}, ${e.orderId ?? null},
      ${e.receiptUrl ?? null}, ${e.incurredAt ?? new Date()}, ${actor.id})
    RETURNING id`;
  await addLedgerEntry(db, actor, { type: "expense", amount: -e.amount, description: e.description, refType: "expense", refId: row.id, occurredAt: e.incurredAt });
  await audit(db, actor, "expense.create", "expenses", row.id, null, e);
  return row.id;
}

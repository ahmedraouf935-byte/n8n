import { z } from "zod";
import type { Db } from "../db/client";
import { audit, type Actor } from "./audit";

export const SettingsSchemas = {
  capital: z.object({
    initial_capital: z.number().nonnegative(),
    allocations: z.object({
      inventory: z.number().nonnegative(),
      advertising: z.number().nonnegative(),
      packaging_transport: z.number().nonnegative(),
      contingency: z.number().nonnegative(),
    }),
  }),
  risk: z.object({
    max_concurrent_tests: z.number().int().min(1).max(20),
    max_test_spend_per_product: z.number().positive(),
    min_margin_pct: z.number().min(0).max(90),
    require_compliance_ack_for: z.array(z.string()),
    blocked_categories: z.array(z.string()),
  }),
  scoring: z.object({
    weights: z.object({ demand: z.number().min(0), profit: z.number().min(0), supplier: z.number().min(0), risk: z.number().min(0), competition: z.number().min(0) }),
    bands: z.object({ high_priority: z.number().min(0).max(100), manual_review: z.number().min(0).max(100) }),
  }),
  freshness: z.object({
    supplier_offer_stale_days: z.number().int().positive(),
    verification_valid_days: z.number().int().positive(),
    retail_offer_fresh_days: z.number().int().positive(),
    trend_fresh_days: z.number().int().positive(),
  }),
  unit_economics_defaults: z.object({
    packaging_per_order: z.number().min(0), carrier_cost_per_order: z.number().min(0), shipping_fee_charged: z.number().min(0),
    cod_fee_pct: z.number().min(0).max(100), cod_fee_fixed: z.number().min(0), ad_cost_per_order: z.number().min(0),
    failed_delivery_rate: z.number().min(0).max(1), failed_delivery_cost: z.number().min(0), return_rate: z.number().min(0).max(1),
    return_cost: z.number().min(0), resellable_return_rate: z.number().min(0).max(1), discount_per_order: z.number().min(0),
    tax_pct: z.number().min(0).max(100), other_cost_per_unit: z.number().min(0), pickup_cost_total: z.number().min(0),
  }),
  research: z.object({ daily_candidate_limit: z.number().int().min(1).max(100), top_recommendations: z.number().int().min(1).max(20), schedule_cron: z.string() }),
  publishing: z.object({ require_owner_approval: z.boolean(), auto_publish_in_stock_only: z.boolean() }),
  ai: z.object({ monthly_budget_usd: z.number().min(0), model: z.string() }),
};

export type SettingsKey = keyof typeof SettingsSchemas;
export type Settings = { [K in SettingsKey]: z.infer<(typeof SettingsSchemas)[K]> };

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db<{ key: string; value: unknown }[]>`SELECT key, value FROM app_settings`;
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out: Partial<Settings> = {};
  for (const key of Object.keys(SettingsSchemas) as SettingsKey[]) {
    (out as Record<string, unknown>)[key] = SettingsSchemas[key].parse(map[key]);
  }
  return out as Settings;
}

export async function updateSetting<K extends SettingsKey>(db: Db, actor: Actor, key: K, value: Settings[K]) {
  const parsed = SettingsSchemas[key].parse(value);
  if (key === "scoring") {
    const s = parsed as Settings["scoring"];
    if (Object.values(s.weights).reduce((a, b) => a + b, 0) <= 0) throw new Error("مجموع الأوزان يجب أن يكون أكبر من صفر");
    if (s.bands.manual_review > s.bands.high_priority) throw new Error("حد المراجعة يجب أن يكون أقل من حد الأولوية العالية");
  }
  const [before] = await db<{ value: unknown }[]>`SELECT value FROM app_settings WHERE key = ${key}`;
  await db`INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (${key}, ${db.json(parsed as never)}, ${actor.id}, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await audit(db, actor, "settings.update", "app_settings", null, before?.value ?? null, parsed);
}

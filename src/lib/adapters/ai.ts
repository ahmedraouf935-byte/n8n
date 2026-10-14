/**
 * Claude adapter for extraction and Arabic copywriting.
 * - Optional: every caller has a deterministic fallback when ANTHROPIC_API_KEY is absent or the call fails.
 * - Every call is logged in ai_usage (tokens + estimated cost) and checked against the monthly budget.
 * - Output is schema-validated; the model is instructed never to invent prices, stock or claims.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { Db } from "../db/client";
import { getSettings } from "../services/settings";

// USD per million tokens (input, output). Update when pricing changes.
const PRICING: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export function aiEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

let client: Anthropic | null = null;
function getClient() {
  if (!client) client = new Anthropic({ maxRetries: 2, timeout: 60_000 });
  return client;
}

async function logUsage(db: Db, p: { model: string; purpose: string; input: number; output: number; success: boolean; error?: string }) {
  const [inP, outP] = PRICING[p.model] ?? [4, 20];
  const cost = (p.input * inP + p.output * outP) / 1_000_000;
  await db`INSERT INTO ai_usage (provider, model, purpose, input_tokens, output_tokens, est_cost_usd, success, error)
           VALUES ('anthropic', ${p.model}, ${p.purpose}, ${p.input}, ${p.output}, ${cost}, ${p.success}, ${p.error ?? null})`;
}

export async function aiMonthSpendUsd(db: Db): Promise<number> {
  const [r] = await db<{ v: number }[]>`SELECT COALESCE(SUM(est_cost_usd),0) AS v FROM ai_usage WHERE created_at >= date_trunc('month', now())`;
  return r.v;
}

export class AiUnavailable extends Error {}

async function structured<T>(db: Db, purpose: string, system: string, user: string, schema: z.ZodType<T>, maxTokens = 2000): Promise<T> {
  if (!aiEnabled()) throw new AiUnavailable("ANTHROPIC_API_KEY not configured");
  const settings = await getSettings(db);
  if ((await aiMonthSpendUsd(db)) >= settings.ai.monthly_budget_usd) throw new AiUnavailable("Monthly AI budget reached");
  const model = process.env.AI_MODEL || settings.ai.model;
  try {
    const res = await getClient().messages.parse({
      model,
      max_tokens: maxTokens,
      output_config: { effort: "low", format: zodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content: user }],
    });
    await logUsage(db, { model, purpose, input: res.usage.input_tokens, output: res.usage.output_tokens, success: res.stop_reason !== "refusal" });
    if (res.stop_reason === "refusal") throw new AiUnavailable("Model declined the request");
    if (!res.parsed_output) throw new AiUnavailable("Model output did not match the schema");
    return res.parsed_output;
  } catch (e) {
    if (e instanceof AiUnavailable) throw e;
    await logUsage(db, { model, purpose, input: 0, output: 0, success: false, error: (e as Error).message.slice(0, 500) });
    throw new AiUnavailable((e as Error).message);
  }
}

const SupplierExtraction = z.object({
  product_name_ar: z.string(),
  product_name_en: z.string().nullable(),
  unit_price_egp: z.number().nullable(),
  price_basis: z.enum(["per_piece", "per_dozen", "per_carton", "multiple_prices", "unknown"]),
  min_order_qty: z.number().nullable(),
  capacity: z.string().nullable(),
  dimensions: z.string().nullable(),
  material: z.string().nullable(),
  color: z.string().nullable(),
  model_number: z.string().nullable(),
  missing_info: z.array(z.string()),
});
export type SupplierExtraction = z.infer<typeof SupplierExtraction>;

export async function extractSupplierPost(db: Db, text: string) {
  return structured(
    db, "supplier_post_extraction",
    "You extract product data from Egyptian wholesale supplier posts (Arabic/Egyptian dialect). " +
      "Copy only what is explicitly written. If a value is not stated, return null and list it in missing_info. " +
      "Never estimate prices or stock. If several prices appear, set price_basis to multiple_prices and unit_price_egp to null.",
    `Supplier post:\n"""\n${text.slice(0, 4000)}\n"""`,
    SupplierExtraction, 1200,
  );
}

const MarketingCopy = z.object({
  captions: z.array(z.string()).min(1).max(5),
  description: z.string(),
  selling_points: z.array(z.string()).max(6),
  post_concepts: z.array(z.string()).max(4),
});
export type MarketingCopy = z.infer<typeof MarketingCopy>;

export async function generateMarketingCopy(db: Db, facts: { name: string; specs: string[]; price: number; inStock: boolean; deliveryNote: string }) {
  return structured(
    db, "marketing_copy",
    "You write short, honest Egyptian-Arabic social media copy for a small e-commerce shop. " +
      "Use ONLY the facts provided. Do not invent features, materials, certifications, warranties, discounts or health claims. " +
      "If the product is not in stock, do not say it is available for immediate delivery; use 'احجز الآن' wording instead.",
    JSON.stringify(facts),
    MarketingCopy, 2000,
  );
}

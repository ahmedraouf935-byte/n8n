import { z } from "zod";
import type { Db } from "../db/client";
import { productKey } from "../domain/normalize";
import { audit, type Actor } from "./audit";
import { DomainError } from "./errors";
import { finishRun, getSource, recordObservation, startRun, type CollectionMethod } from "./ingestion";

/**
 * Trend Discovery Engine — evidence intake.
 *
 * Every trend signal is stored with: source, URL, collection method, discovery time and evidence type.
 * `measured` = numbers read from the platform/tool (with URL), `owner_reported` = owner observation,
 * `ai_hypothesis` = model suggestion with NO measured numbers (enforced by a DB constraint).
 */
export const TrendSignalInput = z.object({
  title: z.string().min(2).max(300),
  titleEn: z.string().max(300).optional().nullable(),
  platform: z.enum(["tiktok", "facebook", "instagram", "google_trends", "amazon_eg", "noon", "jumia", "youtube", "other", "ai"]),
  sourceUrl: z.string().url().optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  region: z.string().min(2).max(10).default("EG"),
  category: z.string().max(60).optional().nullable(),
  metricType: z.string().max(60).optional().nullable(),
  metricValue: z.number().nonnegative().optional().nullable(),
  previousValue: z.number().nonnegative().optional().nullable(),
  evidenceType: z.enum(["measured", "owner_reported", "ai_hypothesis"]),
  discoveredAt: z.coerce.date().optional(),
  notes: z.string().max(2000).optional().nullable(),
  externalId: z.string().max(200).optional().nullable(),
});
export type TrendSignalInput = z.infer<typeof TrendSignalInput>;

function growth(cur?: number | null, prev?: number | null): number | null {
  if (cur == null || prev == null || prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 10000) / 100;
}

function baseConfidence(t: TrendSignalInput): number {
  if (t.evidenceType === "ai_hypothesis") return 0.15;
  let c = t.evidenceType === "measured" ? 0.6 : 0.45;
  if (t.sourceUrl) c += 0.1;
  if (t.metricValue != null && t.previousValue != null) c += 0.15;
  if (t.region === "EG") c += 0.05;
  return Math.min(0.95, Math.round(c * 100) / 100);
}

export interface IngestTrendsResult {
  runId: number;
  received: number;
  created: number;
  duplicate: number;
  failed: number;
  errors: { index: number; error: string }[];
  signalIds: number[];
}

/** Ingest a batch of trend signals (manual form, CSV, or n8n). Idempotent per (source, content). */
export async function ingestTrendSignals(
  db: Db, actor: Actor,
  p: { sourceCode: string; method: CollectionMethod; items: unknown[]; idempotencyKey?: string | null },
): Promise<IngestTrendsResult> {
  const source = await getSource(db, p.sourceCode);
  if (source.access_status !== "enabled") throw new DomainError(`المصدر ${source.code} غير مفعّل (${source.access_status})`, "source_disabled");
  const run = await startRun(db, { sourceId: source.id, jobType: "trend_ingest", idempotencyKey: p.idempotencyKey, triggeredBy: actor.label });
  if (run.duplicate) {
    return { runId: run.id, received: p.items.length, created: 0, duplicate: p.items.length, failed: 0, errors: [], signalIds: [] };
  }
  const res: IngestTrendsResult = { runId: run.id, received: p.items.length, created: 0, duplicate: 0, failed: 0, errors: [], signalIds: [] };

  for (const [index, raw] of p.items.entries()) {
    const parsed = TrendSignalInput.safeParse(raw);
    if (!parsed.success) {
      res.failed++;
      res.errors.push({ index, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      continue;
    }
    const t = parsed.data;
    if (t.evidenceType === "measured" && !t.sourceUrl) {
      res.failed++;
      res.errors.push({ index, error: "الإشارة المقاسة تتطلب رابط المصدر" });
      continue;
    }
    const discoveredAt = t.discoveredAt ?? new Date();
    const obsId = await recordObservation(db, {
      sourceId: source.id, runId: run.id, type: "trend", payload: t as Record<string, unknown>, sourceUrl: t.sourceUrl,
      externalId: t.externalId, collectedAt: new Date(), method: p.method,
      hashBasis: { title: t.title, url: t.sourceUrl ?? null, metric: t.metricType ?? null, value: t.metricValue ?? null, day: discoveredAt.toISOString().slice(0, 10) },
    });
    if (obsId === null) {
      res.duplicate++;
      continue;
    }
    const g = t.evidenceType === "ai_hypothesis" ? null : growth(t.metricValue, t.previousValue);
    const [row] = await db<{ id: number }[]>`
      INSERT INTO trend_signals (source_id, raw_observation_id, title_raw, platform, source_url, image_url, region, metric_type,
        metric_value, previous_value, measured_growth_pct, evidence_type, confidence, collection_method, discovered_at, last_verified_at, notes)
      VALUES (${source.id}, ${obsId}, ${t.titleEn ? `${t.title} | ${t.titleEn}` : t.title}, ${t.platform}, ${t.sourceUrl ?? null},
        ${t.imageUrl ?? null}, ${t.region}, ${t.metricType ?? null},
        ${t.evidenceType === "ai_hypothesis" ? null : (t.metricValue ?? null)}, ${t.evidenceType === "ai_hypothesis" ? null : (t.previousValue ?? null)},
        ${g}, ${t.evidenceType}, ${baseConfidence(t)}, ${p.method}, ${discoveredAt},
        ${t.evidenceType === "ai_hypothesis" ? null : new Date()}, ${t.notes ?? null})
      RETURNING id`;
    await db`UPDATE raw_observations SET processing_status = 'processed', processed_at = now() WHERE id = ${obsId}`;
    res.created++;
    res.signalIds.push(row.id);
  }
  await finishRun(db, run.id, { received: res.received, created: res.created, duplicate: res.duplicate, failed: res.failed, error: res.errors[0]?.error });
  await audit(db, actor, "trends.ingest", "ingestion_runs", run.id, null, { source: p.sourceCode, created: res.created, duplicate: res.duplicate, failed: res.failed });
  return res;
}

/** Suggest existing products a signal may belong to (owner confirms the link). */
export async function suggestProductsForSignal(db: Db, signalId: number) {
  const [s] = await db<{ title_raw: string }[]>`SELECT title_raw FROM trend_signals WHERE id = ${signalId}`;
  if (!s) return [];
  const key = productKey(s.title_raw);
  return db<{ id: number; name_ar: string; name_en: string | null; sim: number }[]>`
    SELECT id, name_ar, name_en, similarity(normalized_key, ${key}) AS sim FROM products
    WHERE normalized_key % ${key} ORDER BY sim DESC LIMIT 5`;
}

export async function linkSignalToProduct(db: Db, actor: Actor, signalId: number, productId: number) {
  await db`UPDATE trend_signals SET product_id = ${productId}, status = 'linked' WHERE id = ${signalId}`;
  await audit(db, actor, "trend.link", "trend_signals", signalId, null, { productId });
}

export async function setSignalStatus(db: Db, actor: Actor, signalId: number, status: "saved" | "researching" | "rejected" | "new") {
  await db`UPDATE trend_signals SET status = ${status} WHERE id = ${signalId}`;
  await audit(db, actor, "trend.status", "trend_signals", signalId, null, { status });
}

/**
 * Parse a CSV exported from Google Trends / TikTok Creative Center / owner sheet.
 * Required columns: title, platform, evidence_type. Optional: url, region, metric_type, metric_value, previous_value, discovered_at, notes, image_url, title_en.
 */
export function parseTrendCsv(text: string): { items: Record<string, unknown>[]; errors: string[] } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { items: [], errors: ["الملف فارغ"] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (n: string) => header.indexOf(n);
  const errors: string[] = [];
  for (const col of ["title", "platform", "evidence_type"]) if (idx(col) < 0) errors.push(`عمود مفقود: ${col}`);
  if (errors.length) return { items: [], errors };
  const num = (v: string | undefined) => (v && v.trim() !== "" ? Number(v.replace(/,/g, "")) : null);
  const items = rows.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => {
    const get = (n: string) => (idx(n) >= 0 ? r[idx(n)]?.trim() || null : null);
    return {
      title: get("title"), titleEn: get("title_en"), platform: get("platform"), evidenceType: get("evidence_type"),
      sourceUrl: get("url"), imageUrl: get("image_url"), region: get("region") ?? "EG", metricType: get("metric_type"),
      metricValue: num(get("metric_value") ?? undefined), previousValue: num(get("previous_value") ?? undefined),
      discoveredAt: get("discovered_at") ?? undefined, notes: get("notes"),
    };
  });
  return { items, errors };
}

/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

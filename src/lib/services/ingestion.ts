import crypto from "node:crypto";
import type { Db } from "../db/client";
import { DomainError } from "./errors";

export type CollectionMethod = "api" | "manual_entry" | "csv_import" | "telegram_bot" | "owner_screenshot" | "webhook" | "third_party";

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

export function contentHash(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

export async function getSource(db: Db, code: string) {
  const [s] = await db<{ id: number; code: string; access_status: string; is_demo: boolean; daily_request_limit: number; requests_today: number; requests_day: string | null }[]>`
    SELECT id, code, access_status, is_demo, daily_request_limit, requests_today, requests_day::text FROM data_sources WHERE code = ${code}`;
  if (!s) throw new DomainError(`مصدر بيانات غير معروف: ${code}`, "unknown_source");
  return s;
}

/** Consumes N requests of a source's daily quota; throws when exhausted. */
export async function consumeQuota(db: Db, sourceId: number, n = 1) {
  const [row] = await db<{ ok: boolean }[]>`
    UPDATE data_sources SET
      requests_today = CASE WHEN requests_day = (now() AT TIME ZONE 'Africa/Cairo')::date THEN requests_today + ${n} ELSE ${n} END,
      requests_day = (now() AT TIME ZONE 'Africa/Cairo')::date
    WHERE id = ${sourceId}
      AND (CASE WHEN requests_day = (now() AT TIME ZONE 'Africa/Cairo')::date THEN requests_today + ${n} ELSE ${n} END) <= daily_request_limit
    RETURNING true AS ok`;
  if (!row) throw new DomainError("تم تجاوز الحد اليومي لطلبات هذا المصدر", "quota_exceeded");
}

export async function startRun(db: Db, p: { sourceId: number | null; jobType: string; idempotencyKey?: string | null; triggeredBy: string; meta?: object }) {
  if (p.idempotencyKey) {
    const [existing] = await db<{ id: number; status: string }[]>`SELECT id, status FROM ingestion_runs WHERE idempotency_key = ${p.idempotencyKey}`;
    if (existing) return { id: existing.id, duplicate: true, status: existing.status };
  }
  const [run] = await db<{ id: number }[]>`
    INSERT INTO ingestion_runs (source_id, job_type, idempotency_key, triggered_by, meta)
    VALUES (${p.sourceId}, ${p.jobType}, ${p.idempotencyKey ?? null}, ${p.triggeredBy}, ${db.json((p.meta ?? {}) as never)})
    RETURNING id`;
  return { id: run.id, duplicate: false, status: "running" };
}

export async function finishRun(db: Db, runId: number, c: { received: number; created: number; duplicate: number; failed: number; error?: string | null }) {
  const status = c.failed === 0 ? "succeeded" : c.created > 0 || c.duplicate > 0 ? "partial" : "failed";
  await db`UPDATE ingestion_runs SET status = ${status}, items_received = ${c.received}, items_created = ${c.created},
           items_duplicate = ${c.duplicate}, items_failed = ${c.failed}, error_message = ${c.error ?? null}, finished_at = now()
           WHERE id = ${runId}`;
  return status;
}

/** Stores an observation once per (source, content). Returns null if it was already recorded. */
export async function recordObservation(db: Db, p: {
  sourceId: number; runId: number | null; type: "trend" | "retail_offer" | "supplier_post" | "other";
  payload: Record<string, unknown>; sourceUrl?: string | null; externalId?: string | null;
  collectedAt: Date; method: CollectionMethod; hashBasis?: unknown;
}) {
  const hash = contentHash(p.hashBasis ?? p.payload);
  const [row] = await db<{ id: number }[]>`
    INSERT INTO raw_observations (source_id, ingestion_run_id, observation_type, external_id, source_url, content_hash, payload, collected_at, collection_method)
    VALUES (${p.sourceId}, ${p.runId}, ${p.type}, ${p.externalId ?? null}, ${p.sourceUrl ?? null}, ${hash}, ${db.json(p.payload as never)}, ${p.collectedAt}, ${p.method})
    ON CONFLICT (source_id, content_hash) DO NOTHING
    RETURNING id`;
  return row?.id ?? null;
}

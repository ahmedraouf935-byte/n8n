import type { Sql } from "../db/client";
import { refreshAllOpportunities } from "./analysis";
import { SYSTEM } from "./audit";
import { lowStock } from "./inventory";
import { dispatchPendingTelegram, notify } from "./notifications";
import { buildDailySummary } from "./reports";
import { refreshOfferFreshness } from "./suppliers";
import { publishDuePosts } from "./marketing";
import { cairoDateKey } from "../domain/time";
import { aiExtractSupplierPosts, detectDuplicateProducts, generateContentDrafts, matchSupplierOffers } from "./automation";

/**
 * Durable job queue in Postgres (FOR UPDATE SKIP LOCKED). n8n's schedule triggers call
 * POST /api/v1/jobs/tick, which runs ready jobs with retries and exponential backoff.
 * Enqueue is idempotent through idempotency_key (e.g. "daily-research:2026-10-14").
 */
export const JOB_HANDLERS: Record<string, (sql: Sql, payload: Record<string, unknown>) => Promise<unknown>> = {
  refresh_freshness: (sql) => refreshOfferFreshness(sql),
  score_opportunities: (sql) => refreshAllOpportunities(sql),
  low_stock_alerts: async (sql) => {
    const low = await lowStock(sql);
    for (const l of low) {
      await notify(sql, { kind: "low_stock", severity: "warning", channel: "telegram", dedupeKey: `low_stock:${l.variant_id}:${cairoDateKey()}`,
        title: "تنبيه مخزون منخفض", body: `${l.name_ar} (${l.sku}) — المتاح ${l.available} (حد إعادة الطلب ${l.reorder_threshold})` });
    }
    return { low: low.length };
  },
  daily_summary: async (sql) => {
    const text = await buildDailySummary(sql);
    await notify(sql, { kind: "daily_summary", channel: "telegram", dedupeKey: `daily_summary:${cairoDateKey()}`, title: "الملخص اليومي", body: text });
    return { length: text.length };
  },
  dispatch_notifications: (sql) => dispatchPendingTelegram(sql),
  publish_due_posts: (sql) => publishDuePosts(sql, SYSTEM),
  match_supplier_offers: (sql) => matchSupplierOffers(sql),
  detect_duplicates: (sql) => detectDuplicateProducts(sql),
  ai_extract_supplier_posts: (sql) => aiExtractSupplierPosts(sql),
  generate_content_drafts: (sql) => generateContentDrafts(sql),
  daily_research: async (sql) => ({
    freshness: await refreshOfferFreshness(sql),
    matching: await matchSupplierOffers(sql),
    duplicates: await detectDuplicateProducts(sql),
    scoring: await refreshAllOpportunities(sql),
  }),
};

export async function enqueueJob(sql: Sql, jobType: string, payload: Record<string, unknown> = {}, idempotencyKey?: string, runAfter?: Date) {
  if (!JOB_HANDLERS[jobType]) throw new Error(`Unknown job type ${jobType}`);
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO jobs (job_type, payload, idempotency_key, run_after) VALUES (${jobType}, ${sql.json(payload as never)}, ${idempotencyKey ?? null}, ${runAfter ?? new Date()})
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`;
  return row?.id ?? null;
}

export async function runReadyJobs(sql: Sql, limit = 5) {
  // Recover jobs stuck in "running" (worker died) after 15 minutes.
  await sql`UPDATE jobs SET status = 'queued', locked_at = NULL WHERE status = 'running' AND locked_at < now() - interval '15 minutes'`;
  const results: { id: number; jobType: string; status: string; error?: string }[] = [];
  for (let i = 0; i < limit; i++) {
    const [job] = await sql<{ id: number; job_type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }[]>`
      UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
      WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= now() ORDER BY run_after, id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, job_type, payload, attempts, max_attempts`;
    if (!job) break;
    try {
      const result = await JOB_HANDLERS[job.job_type](sql, job.payload);
      await sql`UPDATE jobs SET status = 'succeeded', result = ${sql.json((result ?? {}) as never)}, finished_at = now(), last_error = NULL WHERE id = ${job.id}`;
      results.push({ id: job.id, jobType: job.job_type, status: "succeeded" });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 1000);
      const dead = job.attempts >= job.max_attempts;
      await sql`UPDATE jobs SET status = ${dead ? "dead" : "queued"}, last_error = ${msg}, locked_at = NULL,
               run_after = now() + (${2 ** job.attempts} || ' minutes')::interval WHERE id = ${job.id}`;
      if (dead) await notify(sql, { kind: "job_failed", severity: "critical", channel: "telegram", dedupeKey: `job_dead:${job.id}`,
        title: "فشل مهمة مجدولة", body: `${job.job_type} فشلت ${job.attempts} مرات: ${msg}` });
      results.push({ id: job.id, jobType: job.job_type, status: dead ? "dead" : "retry", error: msg });
    }
  }
  return results;
}

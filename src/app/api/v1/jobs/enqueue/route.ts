import { z } from "zod";
import { machineRoute } from "@/lib/auth/apiAuth";
import { getSql } from "@/lib/db/client";
import { enqueueJob, JOB_HANDLERS, runReadyJobs } from "@/lib/services/jobs";

const Body = z.object({
  jobType: z.string().refine((j) => j in JOB_HANDLERS, "unknown job type"),
  idempotencyKey: z.string().max(200).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  runNow: z.boolean().default(true),
});

/** Idempotent enqueue (e.g. idempotencyKey "daily_research:2026-10-14"), optionally running ready jobs immediately. */
export const POST = machineRoute(async (req) => {
  const b = Body.parse(await req.json());
  const sql = getSql();
  const id = await enqueueJob(sql, b.jobType, b.payload ?? {}, b.idempotencyKey);
  const ran = b.runNow ? await runReadyJobs(sql, 3) : [];
  return { enqueued: id !== null, jobId: id, ran };
});

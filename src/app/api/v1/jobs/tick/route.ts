import { machineRoute } from "@/lib/auth/apiAuth";
import { getSql } from "@/lib/db/client";
import { runReadyJobs } from "@/lib/services/jobs";

export const maxDuration = 60;

/** Runs ready jobs (with retry/backoff). Called by n8n every 15 minutes. */
export const POST = machineRoute(async () => ({ ran: await runReadyJobs(getSql(), 5) }));

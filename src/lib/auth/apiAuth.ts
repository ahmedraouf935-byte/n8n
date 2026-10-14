import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { getSql } from "../db/client";
import { DomainError } from "../services/errors";
import type { Actor } from "../services/audit";
import { hitRateLimit } from "./rateLimit";

export const N8N_ACTOR: Actor = { id: null, label: "n8n" };

function safeEqual(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

/**
 * Machine-to-machine auth for n8n: `Authorization: Bearer <N8N_WEBHOOK_SECRET>`.
 * Rate limited to 120 requests/minute.
 */
export async function authorizeMachine(req: NextRequest): Promise<NextResponse | null> {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret || secret.length < 24) return NextResponse.json({ error: "N8N_WEBHOOK_SECRET is not configured on the server" }, { status: 503 });
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !safeEqual(token, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (await hitRateLimit(getSql(), "api:n8n", 120, 60)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  return null;
}

/** Wraps an API handler: auth, JSON errors, never leaks stack traces. */
export function machineRoute(handler: (req: NextRequest) => Promise<unknown>) {
  return async (req: NextRequest) => {
    const denied = await authorizeMachine(req);
    if (denied) return denied;
    try {
      const result = await handler(req);
      return NextResponse.json({ ok: true, ...(result as object) });
    } catch (e) {
      if (e instanceof ZodError) return NextResponse.json({ ok: false, error: "validation_error", issues: e.issues }, { status: 400 });
      if (e instanceof DomainError) return NextResponse.json({ ok: false, error: e.code, message: e.message }, { status: 422 });
      console.error("[api]", e);
      return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
    }
  };
}

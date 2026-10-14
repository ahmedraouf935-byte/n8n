import { NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** Public liveness probe — reveals nothing beyond "up". */
export async function GET() {
  try {
    await getSql()`SELECT 1`;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

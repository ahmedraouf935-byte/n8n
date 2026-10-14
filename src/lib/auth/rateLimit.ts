import type { Db } from "../db/client";

/** Fixed-window rate limiter stored in Postgres. Returns true when the limit is exceeded. */
export async function hitRateLimit(db: Db, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const [row] = await db<{ count: number }[]>`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds}), 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count`;
  if (Math.random() < 0.01) await db`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`;
  return row.count > limit;
}

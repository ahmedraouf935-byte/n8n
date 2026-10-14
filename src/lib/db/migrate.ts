import fs from "node:fs";
import path from "node:path";
import type { Sql } from "./client";

export type AppEnvironment = "production" | "demo" | "test";

/**
 * Applies pending SQL migrations in lexical order, each in its own transaction.
 * On first run, stamps the database with its environment. The stamp is immutable:
 * a demo database can never be relabelled as production (acceptance criterion 15).
 */
export async function migrate(sql: Sql, environment: AppEnvironment, dir = path.join(process.cwd(), "migrations")) {
  // Session-level advisory lock: concurrent deploys/CI runs wait instead of racing.
  // Held on one reserved connection for the whole run.
  const lockConn = await sql.reserve();
  try {
    await lockConn`SELECT pg_advisory_lock(727001)`;
    return await migrateLocked(sql, environment, dir);
  } finally {
    await lockConn`SELECT pg_advisory_unlock(727001)`.catch(() => {});
    lockConn.release();
  }
}

async function migrateLocked(sql: Sql, environment: AppEnvironment, dir: string) {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS environment_stamp (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    environment text NOT NULL CHECK (environment IN ('production','demo','test')),
    created_at timestamptz NOT NULL DEFAULT now())`;
  const [stamp] = await sql<{ environment: AppEnvironment }[]>`SELECT environment FROM environment_stamp`;
  if (!stamp) {
    await sql`INSERT INTO environment_stamp (environment) VALUES (${environment})`;
  } else if (stamp.environment !== environment) {
    throw new Error(`Database is stamped as '${stamp.environment}' but SAFQA_ENV is '${environment}'. Refusing to continue.`);
  }

  const applied = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = fs.readFileSync(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    ran.push(file);
  }
  return ran;
}

export async function getDatabaseEnvironment(sql: Sql): Promise<AppEnvironment | null> {
  try {
    const [row] = await sql<{ environment: AppEnvironment }[]>`SELECT environment FROM environment_stamp`;
    return row?.environment ?? null;
  } catch {
    return null;
  }
}

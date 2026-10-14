import postgres from "postgres";

export type Sql = postgres.Sql<Record<string, unknown>>;
export type Tx = postgres.TransactionSql<Record<string, unknown>>;
/** Either the pool or an open transaction — services accept both. */
export type Db = Sql | Tx;

declare global {
  // eslint-disable-next-line no-var
  var __safqaSql: Sql | undefined;
}

export function createSql(url = process.env.DATABASE_URL): Sql {
  if (!url) throw new Error("DATABASE_URL is not set");
  // Transaction-mode poolers (Supabase :6543, Neon "-pooler" hosts, PgBouncer) don't support prepared statements.
  const pooled = /pooler|:6543\b|pgbouncer=true/.test(url);
  const sql = postgres(url, {
    // Serverless (Vercel) functions should each hold very few connections.
    max: Number(process.env.DATABASE_POOL_MAX ?? (process.env.VERCEL ? 1 : 5)),
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: process.env.DATABASE_PREPARE ? process.env.DATABASE_PREPARE !== "false" : !pooled,
    ssl: process.env.DATABASE_SSL === "require" || /sslmode=require/.test(url) ? "require" : undefined,
    // numeric/bigint -> JS number. All money values are < 2^53 piastres so this is safe.
    types: {
      numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
      bigint: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
    },
    onnotice: () => {},
  });
  return sql as unknown as Sql;
}

/** Process-wide pool (reused across Next.js hot reloads). */
export function getSql(): Sql {
  if (!globalThis.__safqaSql) globalThis.__safqaSql = createSql();
  return globalThis.__safqaSql;
}

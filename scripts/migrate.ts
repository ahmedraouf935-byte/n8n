import "./_env";
import { createSql } from "../src/lib/db/client";
import { migrate, type AppEnvironment } from "../src/lib/db/migrate";

/**
 * Applies pending migrations. Uses MIGRATION_DATABASE_URL / DATABASE_URL_UNPOOLED (direct connection)
 * when available, because advisory locks and DDL should not go through a transaction pooler.
 */
const env = (process.env.SAFQA_ENV ?? "production") as AppEnvironment;
if (!["production", "demo", "test"].includes(env)) {
  console.error(`Invalid SAFQA_ENV '${env}'`);
  process.exit(1);
}
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
const sql = createSql(url);
migrate(sql, env)
  .then((ran) => {
    console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date.");
    console.log(`Environment stamp: ${env}`);
  })
  .catch((e) => {
    console.error(`Migration failed: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => sql.end());

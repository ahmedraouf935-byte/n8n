// Build entry for Vercel/Render: optionally run migrations first, then `next build`.
// Enable with SAFQA_MIGRATE_ON_BUILD=true. Migrations are transactional and lock-protected.
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit", env: process.env });
if (process.env.SAFQA_MIGRATE_ON_BUILD === "true") {
  if (!process.env.DATABASE_URL && !process.env.MIGRATION_DATABASE_URL) {
    console.error("SAFQA_MIGRATE_ON_BUILD=true but no DATABASE_URL is set");
    process.exit(1);
  }
  run("npx tsx scripts/migrate.ts");
} else {
  console.log("Skipping migrations (set SAFQA_MIGRATE_ON_BUILD=true to run them during build).");
}
run("npx next build");

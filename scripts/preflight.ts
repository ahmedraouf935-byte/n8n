import "./_env";
import fs from "node:fs";
import path from "node:path";
import { createSql } from "../src/lib/db/client";
import { getDatabaseEnvironment } from "../src/lib/db/migrate";

/** Deployment preflight: prints PASS/WARN/FAIL for configuration, database and secrets. Exit 1 on any FAIL. */
type R = { check: string; status: "PASS" | "WARN" | "FAIL"; detail: string };
const out: R[] = [];
const add = (check: string, status: R["status"], detail: string) => out.push({ check, status, detail });
const env = process.env;

function secret(name: string, min: number, required: boolean) {
  const v = env[name];
  if (!v) return add(name, required ? "FAIL" : "WARN", required ? "missing" : "not set (feature disabled)");
  if (v.length < min) return add(name, "FAIL", `too short (${v.length} < ${min})`);
  if (/CHANGE_ME|example|changeme|password/i.test(v)) return add(name, "FAIL", "looks like a placeholder");
  add(name, "PASS", `set (${v.length} chars)`);
}

async function main() {
  secret("SESSION_SECRET", 32, true);
  secret("N8N_WEBHOOK_SECRET", 24, true);
  secret("SAFQA_SETUP_TOKEN", 16, false);
  add("SAFQA_ENV", ["production", "demo"].includes(env.SAFQA_ENV ?? "") ? "PASS" : "FAIL", env.SAFQA_ENV ?? "missing");
  add("SAFQA_PUBLIC_URL", env.SAFQA_PUBLIC_URL?.startsWith("https://") ? "PASS" : "WARN", env.SAFQA_PUBLIC_URL ?? "missing (needed for n8n workflows)");
  add("TELEGRAM_BOT_TOKEN", env.TELEGRAM_BOT_TOKEN ? (/^\d+:[\w-]{30,}$/.test(env.TELEGRAM_BOT_TOKEN) ? "PASS" : "FAIL") : "WARN", env.TELEGRAM_BOT_TOKEN ? "format check only" : "not set (Telegram disabled)");
  add("TELEGRAM_OWNER_CHAT_ID", env.TELEGRAM_OWNER_CHAT_ID ? "PASS" : "WARN", env.TELEGRAM_OWNER_CHAT_ID ? "set" : "not set");
  add("ANTHROPIC_API_KEY", env.ANTHROPIC_API_KEY ? "PASS" : "WARN", env.ANTHROPIC_API_KEY ? "set" : "not set (rule-based fallback)");
  add("META credentials", env.META_PAGE_ID && env.META_PAGE_ACCESS_TOKEN ? "PASS" : "WARN", env.META_PAGE_ID ? "set" : "not set (publishing disabled)");

  const url = env.DATABASE_URL;
  if (!url) add("DATABASE_URL", "FAIL", "missing");
  else {
    const local = /localhost|127\.0\.0\.1/.test(url);
    add("DATABASE_URL host", local && env.SAFQA_ENV === "production" ? "WARN" : "PASS", local ? "local database — not persistent for hosting" : new URL(url).hostname);
    add("DATABASE TLS", local || /sslmode=require/.test(url) || env.DATABASE_SSL === "require" ? "PASS" : "FAIL", local ? "local" : "remote DB must use TLS (sslmode=require or DATABASE_SSL=require)");
    const sql = createSql(url);
    try {
      await sql`SELECT 1`;
      add("Database connection", "PASS", "connected");
      const dbEnv = await getDatabaseEnvironment(sql);
      add("Environment stamp", dbEnv === env.SAFQA_ENV ? "PASS" : "FAIL", `db=${dbEnv ?? "none (run migrations)"} app=${env.SAFQA_ENV}`);
      const files = fs.readdirSync(path.join(process.cwd(), "migrations")).filter((f) => f.endsWith(".sql"));
      const applied = dbEnv ? (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name) : [];
      const pending = files.filter((f) => !applied.includes(f));
      add("Migrations", pending.length ? "FAIL" : "PASS", pending.length ? `pending: ${pending.join(", ")}` : `${applied.length} applied`);
      if (dbEnv) {
        const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE role = 'owner' AND is_active`;
        add("Owner account", n ? "PASS" : "WARN", n ? `${n} owner(s)` : "none yet — open /setup (needs SAFQA_SETUP_TOKEN) or run db:create-admin");
        const [{ c }] = await sql<{ c: number }[]>`SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type='capital_in'),0) AS c FROM cash_ledger`;
        add("Capital recorded", c > 0 ? "PASS" : "WARN", c > 0 ? `${c} EGP` : "record real capital in Settings → رأس المال");
      }
    } catch (e) {
      add("Database connection", "FAIL", (e as Error).message);
    } finally {
      await sql.end();
    }
  }
  const w = Math.max(...out.map((r) => r.check.length));
  for (const r of out) console.log(`${r.status.padEnd(4)}  ${r.check.padEnd(w)}  ${r.detail}`);
  const fails = out.filter((r) => r.status === "FAIL").length;
  console.log(`\n${fails ? "FAIL" : "PASS"} — ${out.filter((r) => r.status === "PASS").length} pass, ${out.filter((r) => r.status === "WARN").length} warn, ${fails} fail`);
  if (fails) process.exitCode = 1;
}
main();

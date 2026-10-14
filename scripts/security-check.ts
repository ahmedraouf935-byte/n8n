import "./_env";
import { chromium } from "playwright-core";

/**
 * Black-box security checks against a RUNNING instance.
 *   BASE_URL=https://… N8N_WEBHOOK_SECRET=… npm run security:check
 * Uses random, non-existent accounts for brute-force tests, so real users are never locked out.
 */
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.N8N_WEBHOOK_SECRET ?? "";
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results: { check: string; ok: boolean; detail: string }[] = [];
const rec = (check: string, ok: boolean, detail: string) => { results.push({ check, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${check} — ${detail}`); };

const PAGES = ["/", "/trends", "/products", "/products/new", "/products/1", "/suppliers", "/suppliers/inbox", "/purchases", "/inventory", "/orders", "/marketing", "/finance", "/settings"];
const API: [string, string][] = [["GET", "/api/v1/health"], ["POST", "/api/v1/ingest/trends"], ["POST", "/api/v1/ingest/retail-offers"], ["POST", "/api/v1/ingest/supplier-posts"],
  ["POST", "/api/v1/jobs/enqueue"], ["POST", "/api/v1/jobs/tick"], ["GET", "/api/v1/reports/daily"], ["POST", "/api/v1/alerts"]];

async function main() {
  const home = await fetch(`${BASE}/login`, { redirect: "manual" });
  const h = home.headers;
  const need = { "x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "strict-transport-security": "max-age" };
  const missing = Object.entries(need).filter(([k, v]) => !(h.get(k) ?? "").includes(v)).map(([k]) => k);
  rec("Security headers", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "HSTS, X-Frame-Options, nosniff, Referrer-Policy");
  rec("No X-Powered-By", !h.get("x-powered-by"), h.get("x-powered-by") ?? "absent");

  const leaks: string[] = [];
  for (const p of PAGES) {
    const r = await fetch(`${BASE}${p}`, { redirect: "manual" });
    if (!(r.status === 307 || r.status === 302) || !(r.headers.get("location") ?? "").includes("/login")) leaks.push(`${p}:${r.status}`);
  }
  rec("Dashboard requires login", leaks.length === 0, leaks.length ? leaks.join(", ") : `${PAGES.length} routes redirect to /login`);

  const bad: string[] = [];
  for (const [m, p] of API) {
    for (const auth of [undefined, "Bearer wrong-token-value-xxxxxxxxxxxxxxxx", `Bearer ${SECRET}x`]) {
      const r = await fetch(`${BASE}${p}`, { method: m, headers: auth ? { authorization: auth, "content-type": "application/json" } : { "content-type": "application/json" }, body: m === "POST" ? "{}" : undefined });
      if (r.status !== 401) bad.push(`${m} ${p} (${auth ? "bad token" : "no token"}) → ${r.status}`);
    }
  }
  rec("Machine API rejects missing/invalid tokens", bad.length === 0, bad.length ? bad.join("; ") : `${API.length} endpoints × 3 cases → 401`);

  if (SECRET) {
    const r = await fetch(`${BASE}/api/v1/ingest/trends`, { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: "{not json" });
    const t = await r.text();
    rec("Malformed JSON → 400 without internals", r.status === 400 && !/at \w+ \(|node_modules|stack/i.test(t), `${r.status} ${t.slice(0, 80)}`);
  }
  const tg = await fetch(`${BASE}/api/telegram/webhook`, { method: "POST", body: "{}", headers: { "x-telegram-bot-api-secret-token": "wrong" } });
  rec("Telegram webhook requires secret token", tg.status === 401, String(tg.status));
  const health = await (await fetch(`${BASE}/api/health`)).text();
  rec("Public health endpoint reveals nothing", health === '{"ok":true}' || health === '{"ok":false}', health);
  const setup = await fetch(`${BASE}/setup`, { redirect: "manual" });
  rec("/setup closed once an owner exists", setup.status === 404, String(setup.status));

  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const email = `nobody-${Date.now()}@example.invalid`;
    let limited = false;
    for (let i = 0; i < 7; i++) {
      await page.goto(`${BASE}/login`);
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', `wrong-${i}`);
      await page.click('button[type="submit"]');
      const msg = await page.locator("text=/غير صحيحة|محاولات كثيرة/").first().innerText({ timeout: 15000 });
      if (msg.includes("محاولات كثيرة")) { limited = true; rec("Login brute-force rate limit", i >= 5, `blocked at attempt ${i + 1}`); break; }
    }
    if (!limited) rec("Login brute-force rate limit", false, "7 attempts without lockout");
    await ctx.addCookies([{ name: "safqa_session", value: "eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOjEsInJvbGUiOiJvd25lciIsIm5hbWUiOiJ4In0.forged", url: BASE }]);
    await page.goto(`${BASE}/finance`);
    rec("Forged session cookie rejected", page.url().includes("/login"), page.url());
  } finally {
    await browser.close();
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n${fails ? "FAIL" : "PASS"} — ${results.length - fails}/${results.length} checks passed`);
  if (fails) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

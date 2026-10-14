import "./_env";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";

/**
 * End-to-end product workflow against a RUNNING SAFQA instance whose database is stamped 'demo'.
 * Uses the real machine API (as n8n would) and a real browser (as the owner would):
 *   trend import → product → Egyptian retail comparison → Telegram supplier post → match → owner verification
 *   → profitability → recommendation → purchase request (gates) — stops BEFORE approval.
 *
 * Inputs are clearly marked test values (example.invalid URLs); this is a workflow test, not market research.
 *
 *   BASE_URL=http://localhost:3000 N8N_WEBHOOK_SECRET=… E2E_EMAIL=… E2E_PASSWORD=… [SAFQA_SETUP_TOKEN=…] npm run test:e2e
 */
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.N8N_WEBHOOK_SECRET ?? "";
const EMAIL = process.env.E2E_EMAIL ?? "e2e-owner@safqa.local";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-owner-password-123";
const OUT = process.env.E2E_OUT ?? path.join(process.cwd(), "docs", "e2e");
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const RUN = Date.now().toString(36);

type Step = { step: string; status: "PASS" | "FAIL"; detail: string };
const steps: Step[] = [];
const record = (step: string, ok: boolean, detail: string) => { steps.push({ step, status: ok ? "PASS" : "FAIL", detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${step} — ${detail}`); if (!ok) throw new Error(`${step}: ${detail}`); };

async function api(method: string, route: string, body?: unknown) {
  const r = await fetch(`${BASE}${route}`, { method, headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${method} ${route} → ${r.status} ${JSON.stringify(j)}`);
  return j as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function submit(page: Page, locator: string) {
  await Promise.all([page.waitForLoadState("networkidle"), page.locator(locator).first().click()]);
  await page.waitForTimeout(300);
}
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const health = await api("GET", "/api/v1/health");
  if (health.environment !== "demo") throw new Error(`Refusing to run: target environment is '${health.environment}', not 'demo'.`);
  record("Target is a demo database", true, `${BASE} (environment=${health.environment})`);

  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-EG" })).newPage();
  try {
    // 0. Owner account (first-run setup page if the DB is empty), login, capital
    await page.goto(`${BASE}/login`);
    if (page.url().endsWith("/setup")) {
      await page.fill('input[name="token"]', process.env.SAFQA_SETUP_TOKEN ?? "");
      await page.fill('input[name="name"]', "مالك الاختبار");
      await page.fill('input[name="email"]', EMAIL);
      await page.fill('input[name="password"]', PASSWORD);
      await page.fill('input[name="confirm"]', PASSWORD);
      await submit(page, 'button[type="submit"]');
      record("First-run owner setup (/setup)", page.url().includes("/settings"), page.url());
    } else {
      await page.fill('input[name="email"]', EMAIL);
      await page.fill('input[name="password"]', PASSWORD);
      await submit(page, 'button[type="submit"]');
      record("Owner login", !page.url().includes("/login"), page.url());
    }
    await page.goto(`${BASE}/settings`);
    const cashText = await page.locator("#capital").innerText();
    const deposited = cashText.split("المودَع:")[1] ?? "";
    if (/^[\s\u200f]*٠٫٠٠/.test(deposited)) {
      await page.fill('form:has(input[name="note"]) input[name="amount"]', "5000");
      await submit(page, 'form:has(input[name="note"]) button');
    }
    record("Capital recorded in cash ledger", (await page.locator("#capital").innerText()).length > 0, (await page.locator("#capital").innerText()).replace(/\s+/g, " "));

    // 1. Discovery via machine API (as the n8n research-sheet workflow does)
    const title = `منظم أدراج قماش 30×20 سم رمادي [E2E ${RUN}]`;
    const t = await api("POST", "/api/v1/ingest/trends", { source: "n8n_webhook", method: "webhook", idempotencyKey: `e2e-${RUN}`, items: [
      { title, platform: "tiktok", evidenceType: "measured", sourceUrl: `https://example.invalid/tiktok/${RUN}`, region: "EG", metricType: "views", metricValue: 240000, previousValue: 80000 },
      { title, platform: "facebook", evidenceType: "measured", sourceUrl: `https://example.invalid/adlib/${RUN}`, region: "EG", metricType: "ad_count", metricValue: 9, previousValue: 4 },
    ] });
    record("1. Trend import (API)", t.created === 2, `created=${t.created} duplicate=${t.duplicate} run=${t.runId}`);
    const again = await api("POST", "/api/v1/ingest/trends", { source: "n8n_webhook", method: "webhook", idempotencyKey: `e2e-${RUN}`, items: [{ title, platform: "tiktok", evidenceType: "measured", sourceUrl: "https://example.invalid/x" }] });
    record("1b. Re-import is idempotent", again.created === 0, `created=${again.created} duplicate=${again.duplicate}`);

    // 2. Owner turns the signal into a product (exact variant)
    await page.goto(`${BASE}/trends?q=${encodeURIComponent(RUN)}`);
    await shot(page, "01-trend-radar");
    await Promise.all([page.waitForURL(/\/products\/new/), page.locator('a:has-text("بحث ← منتج")').first().click()]);
    await page.fill('input[name="nameEn"]', `Fabric drawer organizer [E2E ${RUN}]`);
    await page.fill('input[name="label"]', "30×20 سم رمادي");
    await page.fill('input[name="dimensions"]', "30×20 سم");
    await page.fill('input[name="color"]', "رمادي");
    await page.fill('input[name="material"]', "قماش");
    await page.fill('input[name="weightGrams"]', "180");
    await Promise.all([page.waitForURL(/\/products\/\d+$/), page.locator('button:has-text("إنشاء المنتج")').click()]);
    const variantId = Number(page.url().split("/").pop());
    record("2. Product + variant created from signal", variantId > 0, `variantId=${variantId}`);

    // 3. Egyptian retail prices (as an n8n/manual capture would post them)
    const offers = [
      { retailer: "amazon_eg", listedPrice: 245, shippingCost: 0, titleRaw: "منظم أدراج قماش قابل للطي 30×20 سم رمادي" },
      { retailer: "noon", listedPrice: 229, shippingCost: 25, titleRaw: "منظم ادراج 30x20cm رمادي" },
      { retailer: "jumia", listedPrice: 239, shippingCost: 30, titleRaw: "منظم أدراج قماش 30 × 20 سم" },
      { retailer: "facebook_page", listedPrice: 220, shippingCost: 45, titleRaw: "منظم أدراج رمادي 30×20" },
      { retailer: "noon", listedPrice: 199, shippingCost: 25, titleRaw: "منظم أدراج قماش 40×30 سم رمادي" },
    ].map((o, i) => ({ ...o, variantId, url: `https://example.invalid/retail/${RUN}/${i}`, availability: "in_stock" }));
    const ro = await api("POST", "/api/v1/ingest/retail-offers", { items: offers });
    const statuses = (ro.results as { matchStatus?: string; id?: number }[]).map((r) => r.matchStatus);
    record("3. Retail offers ingested; different size auto-excluded", statuses[4] === "mismatch" && statuses.slice(0, 4).every((s) => s !== "mismatch"), statuses.join(", "));
    await page.goto(`${BASE}/products/${variantId}`);
    for (const r of (ro.results as { id: number; matchStatus: string }[]).slice(0, 4)) {
      await submit(page, `#retail form:has(input[name="offerId"][value="${r.id}"]):has(input[name="status"][value="exact"]) button`);
    }
    const included = await page.locator('#retail td:has-text("مؤكد")').count();
    record("3b. Owner confirmed exact matches → included in comparison", included === 4, `${included} offers in price range`);

    // 4. Supplier + Telegram post (as the n8n Telegram Trigger forwards it)
    const chatId = `-100${Date.now()}`.slice(0, 14);
    await page.goto(`${BASE}/suppliers`);
    await page.fill('form:has(input[name="telegramChatId"]) input[name="name"]', `مورد الموسكي [E2E ${RUN}]`);
    await page.selectOption('form:has(input[name="telegramChatId"]) select[name="marketArea"]', "mosky");
    await page.fill('form:has(input[name="telegramChatId"]) input[name="phone"]', "01000000000");
    await page.fill('input[name="telegramChatId"]', chatId);
    await page.fill('input[name="reliabilityRating"]', "4");
    await Promise.all([page.waitForURL(/\/suppliers\/\d+$/), page.locator('button:has-text("إضافة المورد")').click()]);
    record("4. Supplier registered with Telegram chat id", true, `chat ${chatId}`);
    const tg = await api("POST", "/api/v1/ingest/supplier-posts", { updates: [{ update_id: Number(RUN.slice(-6).replace(/\D/g, "") || 1), channel_post: {
      message_id: 501, date: Math.floor(Date.now() / 1000), chat: { id: Number(chatId), username: `e2e_supplier_${RUN}` },
      text: "منظم أدراج قماش 30×20 سم رمادي\nالسعر 58 جنيه\nاقل كمية 12 قطعة\nللتواصل واتساب" } }] });
    record("4b. Telegram post ingested and parsed", tg.created === 1, JSON.stringify(tg.offers));

    // 5. Owner confirms the match and records the supplier's confirmation (human-only step)
    const offerId = (tg.offers as { offerId: number }[])[0].offerId;
    await page.goto(`${BASE}/products/${variantId}#suppliers`);
    if ((await page.locator(`#suppliers input[name="offerId"][value="${offerId}"]`).count()) === 0) {
      // Not auto-suggested strongly enough → owner links it from the matching inbox (the normal path).
      await page.goto(`${BASE}/suppliers/inbox`);
      const f = `form:has(input[name="offerId"][value="${offerId}"]):has(input[name="status"][value="probable"])`;
      await page.selectOption(`${f} select[name="variantId"]`, String(variantId));
      await submit(page, `${f} button`);
      record("4c. Offer linked from supplier inbox", true, `offer ${offerId} → variant ${variantId}`);
      await page.goto(`${BASE}/products/${variantId}#suppliers`);
    }
    await shot(page, "02-before-verification");
    await submit(page, `#suppliers form:has(input[name="offerId"][value="${offerId}"]):has(input[name="status"][value="confirmed"]) button`);
    await page.locator(`#suppliers tr:has(input[name="offerId"][value="${offerId}"]) summary`).click();
    const vf = `#suppliers form:has(input[name="offerId"][value="${offerId}"]):has(select[name="method"])`;
    await page.selectOption(`${vf} select[name="method"]`, "whatsapp");
    await page.selectOption(`${vf} select[name="result"]`, "available");
    await page.fill(`${vf} input[name="confirmedPrice"]`, "57");
    await page.fill(`${vf} input[name="confirmedQuantity"]`, "60");
    await page.fill(`${vf} input[name="confirmedMoq"]`, "12");
    await page.fill(`${vf} textarea[name="notes"]`, "E2E: تأكيد اختباري");
    await submit(page, `${vf} button`);
    await submit(page, 'form:has(input[name="verified"][value="true"]) button');
    const supText = await page.locator("#suppliers").innerText();
    record("5. Match confirmed + availability verified + variant verified", supText.includes("مطابق (مؤكد)") && supText.includes("مؤكد"), "owner actions recorded");

    // 6. Profitability + recommendation
    await page.goto(`${BASE}/products/${variantId}`);
    const econ = await page.locator("#economics").innerText();
    const score = (await page.locator("text=من 100").locator("xpath=..").innerText()).split("\n")[0];
    const band = await page.locator('section:has-text("التوصية ولماذا") span:has-text("أولوية"), section:has-text("التوصية ولماذا") span:has-text("مراجعة"), section:has-text("التوصية ولماذا") span:has-text("استبعاد")').first().innerText();
    const pick = (label: string) => econ.split(label)[1]?.split("\n").map((x) => x.trim()).filter(Boolean).find((x) => /[٠-٩\d]/.test(x)) ?? "?";
    record("6. Profitability calculated", econ.includes("مساهمة لكل قطعة مُسلّمة") && econ.includes("السيناريوهات"),
      `wholesale ${pick("سعر الجملة المستخدم")} · recommended ${pick("السعر المقترح")} · contribution/unit ${pick("مساهمة لكل قطعة مُسلّمة")} · margin ${pick("هامش المساهمة")} · break-even orders ${pick("نقطة التعادل (طلبات مشحونة)")}`);
    record("6b. Recommendation with explanation", /\d/.test(score), `score=${score} band=${band}`);
    await shot(page, "03-research-recommendation");

    // 7. Purchase request goes through safety gates (NOT approved — owner decides)
    await submit(page, '#decision button:has-text("إرسال للموافقة")');
    await page.waitForURL(/\/purchases/);
    const card = page.locator(`section:has-text("${RUN}")`).first();
    const cardText = await card.innerText();
    const gatesOk = cardText.includes("كل البوابات ناجحة");
    record("7. Purchase request created; safety gates evaluated", cardText.length > 0, gatesOk ? "all gates passed — awaiting owner approval (not approved by test)" : `gates not all passed:\n${cardText}`);
    await shot(page, "04-purchase-awaiting-approval");
    await page.goto(`${BASE}/`);
    await shot(page, "05-overview");
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ base: BASE, run: RUN, at: new Date().toISOString(), steps }, null, 2));
  }
  console.log(`\n${steps.every((s) => s.status === "PASS") ? "PASS" : "FAIL"} — ${steps.length} steps. Screenshots: ${OUT}`);
}
main().catch((e) => { console.error(`\nFAIL — ${e.message}`); process.exitCode = 1; });

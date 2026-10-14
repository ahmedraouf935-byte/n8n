"use server";
import bcrypt from "bcryptjs";
import { act, num, str } from "@/lib/ui/action";
import { recordCapital } from "@/lib/services/cash";
import { getSettings, updateSetting } from "@/lib/services/settings";
import { setIntegrationStatus } from "@/lib/services/notifications";
import { telegramConfig, telegramHealth } from "@/lib/adapters/telegram";
import { audit } from "@/lib/services/audit";
import { DomainError } from "@/lib/services/errors";
import { enqueueJob, runReadyJobs } from "@/lib/services/jobs";

const OWNER = ["owner"] as const;

export async function capitalAction(fd: FormData) {
  await act("/settings#capital", async ({ sql, user }) => {
    await recordCapital(sql, user, num(fd, "amount") ?? 0, str(fd, "note") ?? "إيداع رأس مال");
    return "تم تسجيل رأس المال في دفتر النقدية";
  }, [...OWNER]);
}

export async function allocationsAction(fd: FormData) {
  await act("/settings#capital", async ({ sql, user }) => {
    const s = await getSettings(sql);
    await updateSetting(sql, user, "capital", {
      initial_capital: num(fd, "initial_capital") ?? s.capital.initial_capital,
      allocations: { inventory: num(fd, "inventory") ?? 0, advertising: num(fd, "advertising") ?? 0, packaging_transport: num(fd, "packaging_transport") ?? 0, contingency: num(fd, "contingency") ?? 0 },
    });
  }, [...OWNER]);
}

export async function riskAction(fd: FormData) {
  await act("/settings#risk", async ({ sql, user }) => {
    const s = await getSettings(sql);
    await updateSetting(sql, user, "risk", { ...s.risk, max_concurrent_tests: num(fd, "max_concurrent_tests") ?? 2, max_test_spend_per_product: num(fd, "max_test_spend_per_product") ?? 1500, min_margin_pct: num(fd, "min_margin_pct") ?? 15 });
    await updateSetting(sql, user, "scoring", {
      weights: { demand: num(fd, "w_demand") ?? 30, profit: num(fd, "w_profit") ?? 30, supplier: num(fd, "w_supplier") ?? 20, risk: num(fd, "w_risk") ?? 10, competition: num(fd, "w_competition") ?? 10 },
      bands: { high_priority: num(fd, "b_high") ?? 80, manual_review: num(fd, "b_review") ?? 65 },
    });
    await updateSetting(sql, user, "freshness", {
      supplier_offer_stale_days: num(fd, "supplier_offer_stale_days") ?? 7, verification_valid_days: num(fd, "verification_valid_days") ?? 3,
      retail_offer_fresh_days: num(fd, "retail_offer_fresh_days") ?? 14, trend_fresh_days: num(fd, "trend_fresh_days") ?? 21,
    });
    await enqueueJob(sql, "score_opportunities", {}, `rescore:${Date.now()}`);
    await runReadyJobs(sql, 1);
    return "تم الحفظ وإعادة حساب الدرجات";
  }, [...OWNER]);
}

export async function economicsAction(fd: FormData) {
  await act("/settings#economics", async ({ sql, user }) => {
    const s = await getSettings(sql);
    const next = { ...s.unit_economics_defaults };
    for (const k of Object.keys(next) as (keyof typeof next)[]) {
      const v = num(fd, k);
      if (v !== null) next[k] = k.endsWith("_rate") ? v / 100 : v;
    }
    await updateSetting(sql, user, "unit_economics_defaults", next);
    await updateSetting(sql, user, "publishing", { require_owner_approval: fd.get("require_owner_approval") === "on", auto_publish_in_stock_only: fd.get("auto_publish_in_stock_only") === "on" });
    await updateSetting(sql, user, "ai", { ...s.ai, monthly_budget_usd: num(fd, "ai_budget") ?? s.ai.monthly_budget_usd });
    await updateSetting(sql, user, "research", { ...s.research, daily_candidate_limit: num(fd, "daily_candidate_limit") ?? 10, top_recommendations: num(fd, "top_recommendations") ?? 3 });
  }, [...OWNER]);
}

export async function sourceAction(fd: FormData) {
  await act("/settings#sources", async ({ sql, user }) => {
    const code = String(fd.get("code"));
    const status = String(fd.get("status"));
    const [src] = await sql<{ access_status: string }[]>`SELECT access_status FROM data_sources WHERE code = ${code}`;
    if (src?.access_status === "not_available" && status === "enabled") throw new DomainError("هذا المصدر لا يملك وصولًا رسميًا مصرحًا — لا يمكن تفعيله آليًا");
    await sql`UPDATE data_sources SET access_status = ${status}, daily_request_limit = ${num(fd, "limit") ?? 100} WHERE code = ${code}`;
    await audit(sql, user, "data_source.update", "data_sources", null, src, { code, status });
  }, [...OWNER]);
}

export async function testTelegramAction() {
  await act("/settings#integrations", async ({ sql }) => {
    const c = telegramConfig();
    if (!c.token) { await setIntegrationStatus(sql, "telegram", "pending_credentials", "TELEGRAM_BOT_TOKEN غير مُعد"); throw new DomainError("TELEGRAM_BOT_TOKEN غير مُعد على الخادم"); }
    try {
      const h = await telegramHealth(c);
      await setIntegrationStatus(sql, "telegram", c.ownerChatId ? "connected" : "pending_credentials", c.ownerChatId ? null : "TELEGRAM_OWNER_CHAT_ID غير مُعد", h);
      await sql`UPDATE data_sources SET access_status = 'enabled' WHERE code = 'telegram_suppliers'`;
      return `✓ البوت @${h.username} يعمل${h.canReadAllGroupMessages ? "" : " (وضع الخصوصية مفعّل: في المجموعات يرى الأوامر والردود فقط — استخدم قنوات يكون البوت مشرفًا بها)"}`;
    } catch (e) {
      await setIntegrationStatus(sql, "telegram", "error", (e as Error).message);
      throw new DomainError(`فشل الاتصال بتيليجرام: ${(e as Error).message}`);
    }
  }, [...OWNER]);
}

export async function checkEnvIntegrationsAction() {
  await act("/settings#integrations", async ({ sql }) => {
    const ai = !!process.env.ANTHROPIC_API_KEY;
    await setIntegrationStatus(sql, "ai", ai ? "connected" : "pending_credentials", ai ? null : "ANTHROPIC_API_KEY غير مُعد");
    await sql`UPDATE data_sources SET access_status = ${ai ? "enabled" : "pending_credentials"} WHERE code = 'anthropic_ai'`;
    const meta = !!(process.env.META_PAGE_ID && process.env.META_PAGE_ACCESS_TOKEN);
    await setIntegrationStatus(sql, "meta", meta ? "connected" : "pending_credentials", meta ? null : "بيانات Meta غير مُعدة");
    const n8n = !!process.env.N8N_WEBHOOK_SECRET;
    await setIntegrationStatus(sql, "n8n", n8n ? "connected" : "pending_credentials", n8n ? null : "N8N_WEBHOOK_SECRET غير مُعد");
    return "تم تحديث حالة التكاملات (وجود بيانات الاعتماد فقط؛ «متصل» لـ Meta/AI يعني أن المفاتيح موجودة وسيظهر أي خطأ فعلي عند الاستخدام)";
  }, [...OWNER]);
}

export async function runJobAction(fd: FormData) {
  await act("/settings#logs", async ({ sql }) => {
    const job = String(fd.get("job"));
    await enqueueJob(sql, job, {}, `manual:${job}:${Date.now()}`);
    const r = await runReadyJobs(sql, 3);
    return r.map((x) => `${x.jobType}: ${x.status}${x.error ? ` (${x.error})` : ""}`).join("\n") || "لا توجد مهام";
  }, [...OWNER]);
}

export async function addUserAction(fd: FormData) {
  await act("/settings#users", async ({ sql, user }) => {
    const pw = str(fd, "password") ?? "";
    if (pw.length < 10) throw new DomainError("كلمة المرور 10 أحرف على الأقل");
    const role = str(fd, "role") === "viewer" ? "viewer" : "operator";
    const [u] = await sql<{ id: number }[]>`INSERT INTO users (email, name, password_hash, role) VALUES (${str(fd, "email")}, ${str(fd, "name")}, ${await bcrypt.hash(pw, 12)}, ${role}) RETURNING id`;
    await audit(sql, user, "user.create", "users", u.id, null, { email: str(fd, "email"), role });
  }, [...OWNER]);
}

export async function toggleUserAction(fd: FormData) {
  await act("/settings#users", async ({ sql, user }) => {
    const id = Number(fd.get("id"));
    if (id === user.id) throw new DomainError("لا يمكنك تعطيل حسابك");
    await sql`UPDATE users SET is_active = NOT is_active WHERE id = ${id}`;
    await audit(sql, user, "user.toggle", "users", id, null, {});
  }, [...OWNER]);
}

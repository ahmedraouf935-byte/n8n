import { Badge, Button, Card, Field, Input, Notice, PageHeader, Select, Table } from "@/components/ui";
import { getSql } from "@/lib/db/client";
import { formatEGP } from "@/lib/domain/money";
import { formatDateTime } from "@/lib/domain/time";
import { getCashPosition } from "@/lib/services/cash";
import { getSettings } from "@/lib/services/settings";
import { aiMonthSpendUsd } from "@/lib/adapters/ai";
import { addUserAction, allocationsAction, capitalAction, checkEnvIntegrationsAction, economicsAction, riskAction, runJobAction, sourceAction, testTelegramAction, toggleUserAction } from "./actions";

const STATUS_AR: Record<string, string> = { enabled: "✓ مفعّل", disabled: "معطل", pending_credentials: "بانتظار بيانات الاعتماد", not_available: "لا يوجد وصول رسمي", error: "✕ خطأ", connected: "✓ متصل" };
const tone = (s: string) => (s === "enabled" || s === "connected" ? "good" : s === "error" ? "bad" : s === "pending_credentials" ? "warn" : "neutral") as "good";

export default async function SettingsPage() {
  const sql = getSql();
  const s = await getSettings(sql);
  const cash = await getCashPosition(sql);
  const integrations = await sql<{ code: string; name: string; status: string; last_check_at: Date | null; last_success_at: Date | null; last_error: string | null }[]>`SELECT * FROM integration_status ORDER BY name`;
  const sources = await sql<{ code: string; name: string; platform: string; kind: string; access_status: string; daily_request_limit: number; requests_today: number; notes: string | null }[]>`SELECT * FROM data_sources ORDER BY access_status, name`;
  const runs = await sql<{ id: number; job_type: string; status: string; items_received: number; items_created: number; items_duplicate: number; items_failed: number; error_message: string | null; started_at: Date; triggered_by: string }[]>`SELECT * FROM ingestion_runs ORDER BY id DESC LIMIT 15`;
  const jobs = await sql<{ id: number; job_type: string; status: string; attempts: number; last_error: string | null; created_at: Date; finished_at: Date | null }[]>`SELECT * FROM jobs ORDER BY id DESC LIMIT 15`;
  const notes = await sql<{ id: number; kind: string; title: string; status: string; error: string | null; created_at: Date }[]>`SELECT * FROM notifications ORDER BY id DESC LIMIT 15`;
  const auditRows = await sql<{ id: number; actor_label: string; action: string; entity_type: string; entity_id: number | null; created_at: Date }[]>`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 25`;
  const users = await sql<{ id: number; name: string; email: string; role: string; is_active: boolean; last_login_at: Date | null }[]>`SELECT id, name, email, role, is_active, last_login_at FROM users ORDER BY id`;
  const aiSpend = await aiMonthSpendUsd(sql);
  const d = s.unit_economics_defaults;
  const base = process.env.SAFQA_PUBLIC_URL ?? "https://<your-safqa-domain>";
  const alloc = s.capital.allocations;
  const allocSum = alloc.inventory + alloc.advertising + alloc.packaging_transport + alloc.contingency;

  return (
    <>
      <PageHeader title="الإعدادات والتكاملات" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="رأس المال والميزانيات" className="scroll-mt-4" >
          <div id="capital" className="mb-3 text-sm">النقد المسجل في الدفتر: <b className="num">{formatEGP(cash.cashBalance)}</b> · رأس المال المودَع: <b className="num">{formatEGP(cash.capitalIn)}</b></div>
          <form action={capitalAction} className="mb-4 flex flex-wrap items-end gap-2 rounded-lg bg-surface-2 p-3">
            <Field label="إيداع رأس مال فعلي"><Input name="amount" inputMode="decimal" placeholder="5000" className="w-32" required /></Field>
            <Field label="ملاحظة"><Input name="note" placeholder="رأس المال المبدئي" /></Field>
            <Button>تسجيل</Button>
          </form>
          <form action={allocationsAction} className="grid grid-cols-2 gap-2">
            <Field label="رأس المال المخطط"><Input name="initial_capital" defaultValue={s.capital.initial_capital} /></Field><div />
            <Field label="مخزون"><Input name="inventory" defaultValue={alloc.inventory} /></Field>
            <Field label="إعلانات"><Input name="advertising" defaultValue={alloc.advertising} /></Field>
            <Field label="تغليف ومواصلات"><Input name="packaging_transport" defaultValue={alloc.packaging_transport} /></Field>
            <Field label="طوارئ ومرتجعات"><Input name="contingency" defaultValue={alloc.contingency} /></Field>
            <div className="col-span-2 flex items-center justify-between">
              <span className={`text-xs ${allocSum > s.capital.initial_capital ? "text-bad" : "text-muted"}`}>المجموع {formatEGP(allocSum)} من {formatEGP(s.capital.initial_capital)}</span>
              <Button variant="secondary">حفظ التوزيع</Button>
            </div>
          </form>
        </Card>

        <Card title="المخاطر، الأوزان، والصلاحية">
          <form id="risk" action={riskAction} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Field label="منتجات تحت الاختبار معًا"><Input name="max_concurrent_tests" defaultValue={s.risk.max_concurrent_tests} /></Field>
            <Field label="حد إنفاق اختبار المنتج"><Input name="max_test_spend_per_product" defaultValue={s.risk.max_test_spend_per_product} /></Field>
            <Field label="أقل هامش مساهمة ٪"><Input name="min_margin_pct" defaultValue={s.risk.min_margin_pct} /></Field>
            <Field label="وزن الطلب"><Input name="w_demand" defaultValue={s.scoring.weights.demand} /></Field>
            <Field label="وزن الربحية"><Input name="w_profit" defaultValue={s.scoring.weights.profit} /></Field>
            <Field label="وزن المورد"><Input name="w_supplier" defaultValue={s.scoring.weights.supplier} /></Field>
            <Field label="وزن المخاطر"><Input name="w_risk" defaultValue={s.scoring.weights.risk} /></Field>
            <Field label="وزن المنافسة"><Input name="w_competition" defaultValue={s.scoring.weights.competition} /></Field>
            <div />
            <Field label="حد «أولوية عالية»"><Input name="b_high" defaultValue={s.scoring.bands.high_priority} /></Field>
            <Field label="حد «مراجعة يدوية»"><Input name="b_review" defaultValue={s.scoring.bands.manual_review} /></Field>
            <div />
            <Field label="عرض المورد يصبح قديمًا بعد (يوم)"><Input name="supplier_offer_stale_days" defaultValue={s.freshness.supplier_offer_stale_days} /></Field>
            <Field label="صلاحية تأكيد المورد (يوم)"><Input name="verification_valid_days" defaultValue={s.freshness.verification_valid_days} /></Field>
            <Field label="أسعار التجزئة حديثة لمدة (يوم)"><Input name="retail_offer_fresh_days" defaultValue={s.freshness.retail_offer_fresh_days} /></Field>
            <Field label="إشارات الترند حديثة لمدة (يوم)"><Input name="trend_fresh_days" defaultValue={s.freshness.trend_fresh_days} /></Field>
            <div className="col-span-full"><Button variant="secondary">حفظ وإعادة الحساب</Button></div>
          </form>
        </Card>

        <Card title="افتراضات اقتصاديات الوحدة الافتراضية" className="lg:col-span-2">
          <form id="economics" action={economicsAction} className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <Field label="تغليف/طلب"><Input name="packaging_per_order" defaultValue={d.packaging_per_order} /></Field>
            <Field label="تكلفة الشحن/طلب"><Input name="carrier_cost_per_order" defaultValue={d.carrier_cost_per_order} /></Field>
            <Field label="شحن على العميل"><Input name="shipping_fee_charged" defaultValue={d.shipping_fee_charged} /></Field>
            <Field label="عمولة تحصيل ٪"><Input name="cod_fee_pct" defaultValue={d.cod_fee_pct} /></Field>
            <Field label="رسوم تحصيل ثابتة"><Input name="cod_fee_fixed" defaultValue={d.cod_fee_fixed} /></Field>
            <Field label="إعلان/طلب"><Input name="ad_cost_per_order" defaultValue={d.ad_cost_per_order} /></Field>
            <Field label="فشل التسليم ٪"><Input name="failed_delivery_rate" defaultValue={d.failed_delivery_rate * 100} /></Field>
            <Field label="تكلفة فشل التسليم"><Input name="failed_delivery_cost" defaultValue={d.failed_delivery_cost} /></Field>
            <Field label="الإرجاع ٪"><Input name="return_rate" defaultValue={d.return_rate * 100} /></Field>
            <Field label="تكلفة الإرجاع"><Input name="return_cost" defaultValue={d.return_cost} /></Field>
            <Field label="مرتجع قابل للبيع ٪"><Input name="resellable_return_rate" defaultValue={d.resellable_return_rate * 100} /></Field>
            <Field label="خصم/طلب"><Input name="discount_per_order" defaultValue={d.discount_per_order} /></Field>
            <Field label="ضرائب ٪"><Input name="tax_pct" defaultValue={d.tax_pct} /></Field>
            <Field label="تكاليف أخرى/قطعة"><Input name="other_cost_per_unit" defaultValue={d.other_cost_per_unit} /></Field>
            <Field label="مواصلات استلام/دفعة"><Input name="pickup_cost_total" defaultValue={d.pickup_cost_total} /></Field>
            <Field label="ميزانية AI شهرية $"><Input name="ai_budget" defaultValue={s.ai.monthly_budget_usd} /></Field>
            <Field label="مرشحين يوميًا (حد أقصى)"><Input name="daily_candidate_limit" defaultValue={s.research.daily_candidate_limit} /></Field>
            <Field label="أفضل توصيات"><Input name="top_recommendations" defaultValue={s.research.top_recommendations} /></Field>
            <label className="col-span-2 flex items-center gap-2 text-sm"><Input type="checkbox" name="require_owner_approval" defaultChecked={s.publishing.require_owner_approval} /> النشر يتطلب موافقتي</label>
            <label className="col-span-2 flex items-center gap-2 text-sm"><Input type="checkbox" name="auto_publish_in_stock_only" defaultChecked={s.publishing.auto_publish_in_stock_only} /> لا تنشر منتجًا غير متوفر بالمخزون</label>
            <div className="col-span-full"><Button variant="secondary">حفظ</Button></div>
          </form>
        </Card>

        <Card title="التكاملات" actions={<div className="flex gap-2"><form action={checkEnvIntegrationsAction}><Button size="sm" variant="secondary">فحص بيانات الاعتماد</Button></form><form action={testTelegramAction}><Button size="sm" variant="secondary">اختبار تيليجرام</Button></form></div>}>
          <ul id="integrations" className="space-y-3 text-sm">
            {integrations.map((i) => (
              <li key={i.code} className="flex items-start justify-between gap-2">
                <div><div className="font-medium">{i.name}</div>{i.last_error && <div className="text-xs text-bad">{i.last_error}</div>}<div className="text-xs text-muted">آخر فحص: {formatDateTime(i.last_check_at)} · آخر نجاح: {formatDateTime(i.last_success_at)}</div></div>
                <Badge tone={tone(i.status)}>{STATUS_AR[i.status]}</Badge>
              </li>
            ))}
          </ul>
          <div className="mt-4 text-xs text-muted">استهلاك Claude هذا الشهر: ${aiSpend.toFixed(3)} من ${s.ai.monthly_budget_usd}</div>
        </Card>

        <Card title="ربط n8n">
          <p className="mb-2 text-sm text-text-2">كل طلبات n8n تستخدم الترويسة <code dir="ltr">Authorization: Bearer N8N_WEBHOOK_SECRET</code>. ملفات الـ workflows في مجلد <code>n8n/workflows</code>.</p>
          <ul className="space-y-1 text-xs" dir="ltr">
            {["POST /api/v1/ingest/trends", "POST /api/v1/ingest/retail-offers", "POST /api/v1/ingest/supplier-posts", "POST /api/v1/jobs/enqueue", "POST /api/v1/jobs/tick", "POST /api/v1/alerts", "GET /api/v1/reports/daily", "GET /api/v1/health"].map((e) => <li key={e}><code>{e.split(/\s+/)[0]} {base}{e.split(/\s+/)[1]}</code></li>)}
          </ul>
          <div className="mt-3"><Notice>{process.env.N8N_WEBHOOK_SECRET ? "✓ N8N_WEBHOOK_SECRET مُعد على الخادم" : "N8N_WEBHOOK_SECRET غير مُعد — كل طلبات n8n سترجع 503"}</Notice></div>
        </Card>

        <Card title="مصادر البيانات وحدود الطلبات" className="lg:col-span-2" padded={false}>
          <div id="sources" />
          <Table head={["المصدر", "النوع", "الحالة", "اليوم / الحد", "ملاحظات", ""]}>
            {sources.map((src) => (
              <tr key={src.code}>
                <td>{src.name}<div className="text-xs text-muted" dir="ltr">{src.code}</div></td>
                <td className="text-xs">{src.kind}</td>
                <td><Badge tone={tone(src.access_status)}>{STATUS_AR[src.access_status]}</Badge></td>
                <td className="num text-xs">{src.requests_today} / {src.daily_request_limit}</td>
                <td className="max-w-80 text-xs text-muted">{src.notes}</td>
                <td>
                  <form action={sourceAction} className="flex gap-1">
                    <input type="hidden" name="code" value={src.code} />
                    <Select name="status" defaultValue={src.access_status} className="h-8 text-xs" options={[["enabled", "مفعّل"], ["disabled", "معطل"], ["pending_credentials", "بانتظار الاعتماد"], ["not_available", "غير متاح"]]} />
                    <Input name="limit" defaultValue={src.daily_request_limit} className="h-8 w-16 text-xs" />
                    <Button size="sm" variant="ghost">حفظ</Button>
                  </form>
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="المهام المجدولة والسجلات" className="lg:col-span-2" actions={
          <form action={runJobAction} className="flex gap-1">
            <Select name="job" className="h-8 text-xs" options={[["daily_research", "البحث اليومي"], ["score_opportunities", "إعادة التقييم"], ["refresh_freshness", "فحص الصلاحية"], ["low_stock_alerts", "تنبيهات المخزون"], ["daily_summary", "الملخص اليومي"], ["dispatch_notifications", "إرسال الإشعارات"], ["publish_due_posts", "نشر المستحق"]]} />
            <Button size="sm" variant="secondary">تشغيل الآن</Button>
          </form>}>
          <div id="logs" className="grid gap-4 lg:grid-cols-3">
            <div>
              <h3 className="mb-2 text-sm font-semibold">عمليات الاستيراد</h3>
              <ul className="space-y-1.5 text-xs">{runs.map((r) => <li key={r.id}><Badge tone={r.status === "succeeded" ? "good" : r.status === "failed" ? "bad" : "warn"}>{r.status}</Badge> {r.job_type} — {r.items_created} جديد / {r.items_duplicate} مكرر / {r.items_failed} فشل — {r.triggered_by} — {formatDateTime(r.started_at)}{r.error_message && <div className="text-bad">{r.error_message}</div>}</li>)}</ul>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">المهام</h3>
              <ul className="space-y-1.5 text-xs">{jobs.map((j) => <li key={j.id}><Badge tone={j.status === "succeeded" ? "good" : j.status === "dead" ? "bad" : "warn"}>{j.status}</Badge> {j.job_type} (محاولات {j.attempts}) — {formatDateTime(j.created_at)}{j.last_error && <div className="text-bad">{j.last_error}</div>}</li>)}</ul>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">الإشعارات</h3>
              <ul className="space-y-1.5 text-xs">{notes.map((n) => <li key={n.id}><Badge tone={n.status === "sent" ? "good" : n.status === "failed" ? "bad" : "neutral"}>{n.status}</Badge> {n.title} — {formatDateTime(n.created_at)}{n.error && <div className="text-bad">{n.error}</div>}</li>)}</ul>
            </div>
          </div>
          <details className="mt-4 text-xs"><summary className="text-info">سجل التدقيق (آخر 25)</summary>
            <ul className="mt-2 space-y-1">{auditRows.map((a) => <li key={a.id}>{formatDateTime(a.created_at)} — {a.actor_label} — {a.action} — {a.entity_type} #{a.entity_id}</li>)}</ul>
          </details>
        </Card>

        <Card title="المستخدمون والصلاحيات" className="lg:col-span-2">
          <div id="users" />
          <Table head={["الاسم", "البريد", "الدور", "آخر دخول", ""]}>
            {users.map((u) => <tr key={u.id}><td>{u.name}</td><td dir="ltr">{u.email}</td><td>{u.role === "owner" ? "مالك" : u.role === "operator" ? "مشغّل" : "مشاهد"}</td><td className="text-xs">{formatDateTime(u.last_login_at)}</td>
              <td>{u.role !== "owner" && <form action={toggleUserAction}><input type="hidden" name="id" value={u.id} /><Button size="sm" variant="ghost">{u.is_active ? "تعطيل" : "تفعيل"}</Button></form>}</td></tr>)}
          </Table>
          <form action={addUserAction} className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="الاسم"><Input name="name" required /></Field>
            <Field label="البريد"><Input name="email" type="email" required dir="ltr" /></Field>
            <Field label="كلمة المرور"><Input name="password" type="password" required minLength={10} /></Field>
            <Field label="الدور"><Select name="role" options={[["operator", "مشغّل (بدون موافقات شراء)"], ["viewer", "مشاهد فقط"]]} /></Field>
            <Button variant="secondary">إضافة</Button>
          </form>
          <p className="mt-2 text-xs text-muted">موافقات الشراء والدفع وتعديل الميزانيات للمالك فقط.</p>
        </Card>
      </div>
    </>
  );
}

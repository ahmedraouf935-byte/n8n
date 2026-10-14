import { Badge, Button, Card, Field, Input, PageHeader, Select, Stat, Table } from "@/components/ui";
import { getSql } from "@/lib/db/client";
import { formatEGP, formatPct } from "@/lib/domain/money";
import { formatDateTime } from "@/lib/domain/time";
import { getFinancials } from "@/lib/services/reports";
import { addExpense } from "@/lib/services/expenses";
import { act, num, str, int } from "@/lib/ui/action";

const CATS: [string, string][] = [["advertising", "إعلانات"], ["packaging", "تغليف"], ["transport", "مواصلات"], ["shipping", "شحن"], ["payment_fees", "عمولات دفع"], ["returns", "مرتجعات"], ["tools", "أدوات"], ["software", "برمجيات/اشتراكات"], ["other", "أخرى"]];
const LEDGER_AR: Record<string, string> = { capital_in: "إيداع رأس مال", capital_out: "سحب", purchase_payment: "دفع لموردين", expense: "مصروفات", customer_collection: "تحصيل من العملاء", collection_fee: "عمولات تحصيل", refund: "مبالغ مستردة", carrier_cost: "شركات الشحن", adjustment: "تسويات" };

async function expenseAction(fd: FormData) {
  "use server";
  await act("/finance", async ({ sql, user }) => {
    await addExpense(sql, user, { category: str(fd, "category"), amount: num(fd, "amount"), description: str(fd, "description"), variantId: int(fd, "variantId"), incurredAt: str(fd, "incurredAt") ?? undefined });
    return "تم تسجيل المصروف وخصمه من النقدية";
  });
}

export default async function FinancePage() {
  const sql = getSql();
  const f = await getFinancials(sql);
  const recent = await sql<{ id: number; entry_type: string; amount: number; description: string; occurred_at: Date }[]>`SELECT id, entry_type, amount, description, occurred_at FROM cash_ledger ORDER BY id DESC LIMIT 30`;
  const variants = await sql<{ id: number; name_ar: string }[]>`SELECT v.id, p.name_ar FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.status IN ('testing','active') ORDER BY p.name_ar`;
  const totals = f.bySku.reduce((a, r) => ({ rev: a.rev + r.revenue, cogs: a.cogs + r.cogs, refunds: a.refunds + r.refunds, ads: a.ads + r.ads }), { rev: 0, cogs: 0, refunds: 0, ads: 0 });
  return (
    <>
      <PageHeader title="المالية" subtitle="مبنية على دفتر النقدية (لا يمكن تعديله أو حذفه) والطلبات المسجلة. «المساهمة» قبل التكاليف الثابتة — ليست صافي ربح." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="النقد المتاح" value={formatEGP(f.cash.cashBalance)} trust="verified" />
        <Stat label="إيراد المنتجات المُسلّمة" value={formatEGP(totals.rev)} />
        <Stat label="تكلفة البضاعة المباعة" value={formatEGP(totals.cogs)} />
        <Stat label="دوران المخزون (30 يوم)" value={f.turnover30 ?? "—"} sub="تكلفة المبيعات ÷ قيمة المخزون" />
      </div>
      <Card title="الربحية حسب المنتج (SKU)" className="mt-4" padded={false}>
        <Table head={["SKU", "وحدات مباعة", "الإيراد", "تكلفة البضاعة", "مستردات", "إعلانات", "مصروفات أخرى", "المساهمة*"]} empty="لا توجد مبيعات بعد.">
          {f.bySku.map((r) => {
            const c = r.revenue - r.cogs - r.refunds - r.ads - r.other;
            return <tr key={r.variant_id}><td>{r.name_ar}<div className="text-xs text-muted" dir="ltr">{r.sku}</div></td><td className="num">{r.units_sold}</td><td className="num">{formatEGP(r.revenue)}</td><td className="num">{formatEGP(r.cogs)}</td><td className="num">{formatEGP(r.refunds)}</td><td className="num">{formatEGP(r.ads)}</td><td className="num">{formatEGP(r.other)}</td><td className={`num font-semibold ${c < 0 ? "text-bad" : ""}`}>{formatEGP(c)}</td></tr>;
          })}
        </Table>
        <p className="px-4 py-2 text-xs text-muted">* لا تشمل تكاليف الشحن غير المرتبطة بالمنتج. التفاصيل الدقيقة لكل طلب في صفحة الطلب.</p>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="الفعلي مقابل المتوقع" padded={false}>
          <Table head={["المنتج", "هامش متوقع", "مساهمة/قطعة متوقعة", "تاريخ القرار"]} empty="لا توجد قرارات شراء معتمدة.">
            {f.projected.map((p) => <tr key={p.id}><td>{p.name_ar}</td><td className="num">{formatPct(p.planned_margin)}</td><td className="num">{formatEGP(p.planned_unit)} <Badge tone="info">≈</Badge></td><td className="text-xs">{formatDateTime(p.decided_at)}</td></tr>)}
          </Table>
        </Card>
        <Card title="الربحية حسب الحملة" padded={false}>
          <Table head={["الحملة", "الإنفاق", "طلبات مُسلّمة", "إيراد", "تكلفة/طلب"]} empty="لا توجد حملات.">
            {f.byCampaign.map((c) => <tr key={c.id}><td>{c.name}</td><td className="num">{formatEGP(c.spend)}</td><td className="num">{c.orders}</td><td className="num">{formatEGP(c.revenue)}</td><td className="num">{c.orders ? formatEGP(c.spend / c.orders) : "—"}</td></tr>)}
          </Table>
        </Card>
        <Card title="دفتر النقدية حسب النوع">
          <ul className="space-y-1.5 text-sm">{f.ledger.map((l) => <li key={l.entry_type} className="flex justify-between"><span>{LEDGER_AR[l.entry_type]}</span><span className={`num ${l.total < 0 ? "text-bad" : "text-good"}`}>{formatEGP(l.total)}</span></li>)}</ul>
        </Card>
        <Card title="تسجيل مصروف">
          <form action={expenseAction} className="grid gap-2 sm:grid-cols-2">
            <Field label="البند"><Select name="category" options={CATS} /></Field>
            <Field label="المبلغ"><Input name="amount" required inputMode="decimal" /></Field>
            <Field label="الوصف" className="sm:col-span-2"><Input name="description" required /></Field>
            <Field label="المنتج (اختياري)"><Select name="variantId" options={[["", "—"], ...variants.map((v) => [String(v.id), v.name_ar] as [string, string])]} /></Field>
            <Field label="التاريخ"><Input name="incurredAt" type="datetime-local" /></Field>
            <div><Button>تسجيل</Button></div>
          </form>
        </Card>
      </div>
      <Card title="آخر قيود النقدية" className="mt-4" padded={false}>
        <Table head={["#", "النوع", "الوصف", "المبلغ", "الوقت"]}>
          {recent.map((r) => <tr key={r.id}><td className="num">{r.id}</td><td>{LEDGER_AR[r.entry_type]}</td><td>{r.description}</td><td className={`num ${r.amount < 0 ? "text-bad" : "text-good"}`}>{formatEGP(r.amount)}</td><td className="text-xs">{formatDateTime(r.occurred_at)}</td></tr>)}
        </Table>
      </Card>
    </>
  );
}

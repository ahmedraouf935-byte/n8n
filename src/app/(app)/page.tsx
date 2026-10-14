import Link from "next/link";
import { Badge, Card, Notice, PageHeader, Stat, Table } from "@/components/ui";
import { CashFlowChart } from "@/components/CashFlowChart";
import { getSql } from "@/lib/db/client";
import { formatEGP, formatNumber } from "@/lib/domain/money";
import { getOverview } from "@/lib/services/reports";
import { BAND_AR, CONF_AR, OPP_STATUS_AR } from "@/lib/ui/labels";

export default async function OverviewPage() {
  const sql = getSql();
  const o = await getOverview(sql);
  const top = await sql<{ variant_id: number; name_ar: string; sku: string; total_score: number; confidence: string; band: string; status: string }[]>`
    SELECT op.variant_id, p.name_ar, v.sku, s.total_score, s.confidence, s.band, op.status FROM opportunities op
    JOIN product_scores s ON s.id = op.latest_score_id JOIN product_variants v ON v.id = op.variant_id JOIN products p ON p.id = v.product_id
    WHERE op.status NOT IN ('rejected','archived') ORDER BY s.total_score DESC LIMIT 5`;
  const integrations = await sql<{ code: string; name: string; status: string; last_error: string | null }[]>`SELECT code, name, status, last_error FROM integration_status ORDER BY name`;
  const c = o.cash;
  return (
    <>
      <PageHeader title="نظرة عامة" subtitle="كل الأرقام هنا محسوبة من الحركات المسجلة فعليًا — لا توجد أرقام مُقدّرة إلا إذا وُسمت بذلك." />
      {!c.hasCapitalRecorded && (
        <div className="mb-6"><Notice tone="warn">لم يتم تسجيل رأس المال بعد. سجّل المبلغ الفعلي المتاح من <Link className="underline" href="/settings#capital">الإعدادات ← رأس المال</Link> حتى تعمل حدود الميزانية.</Notice></div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="النقد المتاح (دفتر النقدية)" value={formatEGP(c.cashBalance)} sub={`غير ملتزم: ${formatEGP(c.freeCash)}`} trust="verified" />
        <Stat label="مستثمر في المخزون (بالتكلفة)" value={formatEGP(c.inventoryAtCost)} sub={`بانتظار الاستلام: ${formatEGP(c.pendingReceiptValue)}`} trust="verified" />
        <Stat label="المتبقي من ميزانية المخزون" value={formatEGP(c.inventoryBudgetRemaining)} sub={`من ${formatEGP(c.inventoryBudget)}`} />
        <Stat label="نقد محصّل من العملاء" value={formatEGP(o.sales.collected)} sub={`تحصيل معلّق: ${formatEGP(o.sales.pending_collection)}`} trust="verified" />
        <Stat label="إيراد المبيعات المُسلّمة" value={formatEGP(o.sales.revenue)} sub={`${formatNumber(o.sales.delivered_orders)} طلب مُسلّم`} />
        <Stat label="مصروف الإعلانات" value={formatEGP(o.costs.ads)} sub={`الميزانية: ${formatEGP(c.adBudget)}`} />
        <Stat label="تكاليف تشغيل (شحن، تغليف، مواصلات…)" value={formatEGP(o.costs.ops + o.costs.carrier)} />
        <Stat label="مساهمة محققة / مُقدّرة" value={formatEGP(o.realizedContribution)} sub={<>مقدّرة للدفعات المعتمدة: {formatEGP(o.estimatedContribution)} <Badge tone="info">≈ تقديري</Badge></>} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="الأداء النقدي اليومي (آخر 14 يومًا)" className="lg:col-span-2"><CashFlowChart data={o.daily} /></Card>
        <Card title="يحتاج انتباهك">
          <ul className="space-y-3 text-sm">
            <Row href="/purchases" label="قرارات شراء بانتظار موافقتك" n={o.counts.pending_decisions} />
            <Row href="/suppliers" label="عروض موردين بانتظار التأكيد" n={o.counts.pending_verifications} />
            <Row href="/products" label="فرص عالية الأولوية" n={o.counts.high_priority} />
            <Row href="/orders" label="طلبات مفتوحة" n={o.sales.open_orders} />
            <Row href="/trends" label="إشارات ترند اليوم" n={o.counts.new_trends_today} />
            <Row href="/inventory" label="تنبيهات مخزون منخفض" n={o.lowStock.length} />
            <Row href="/inventory" label="منتجات قيد الاختبار/نشطة" n={o.counts.active_products} />
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="أعلى الفرص" className="lg:col-span-2" padded={false}>
          <Table head={["المنتج", "الدرجة", "الثقة", "التصنيف", "الحالة"]} empty="لا توجد فرص محسوبة بعد — أضف منتجًا وعروض أسعار من صفحة أبحاث المنتجات.">
            {top.map((t) => (
              <tr key={t.variant_id}>
                <td><Link className="font-medium hover:underline" href={`/products/${t.variant_id}`}>{t.name_ar}</Link><div className="text-xs text-muted" dir="ltr">{t.sku}</div></td>
                <td className="num font-semibold">{t.total_score}</td>
                <td>{CONF_AR[t.confidence]}</td>
                <td><Badge tone={t.band === "high_priority" ? "good" : t.band === "manual_review" ? "warn" : "neutral"}>{BAND_AR[t.band]}</Badge></td>
                <td className="text-xs text-text-2">{OPP_STATUS_AR[t.status] ?? t.status}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="حالة التكاملات">
          <ul className="space-y-2 text-sm">
            {integrations.map((i) => (
              <li key={i.code} className="flex items-center justify-between gap-2">
                <span>{i.name}</span>
                <Badge tone={i.status === "connected" ? "good" : i.status === "error" ? "bad" : i.status === "pending_credentials" ? "warn" : "neutral"}>
                  {i.status === "connected" ? "✓ متصل" : i.status === "error" ? "✕ خطأ" : i.status === "pending_credentials" ? "بانتظار بيانات الاعتماد" : i.status === "not_available" ? "غير متاح" : "معطل"}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function Row({ href, label, n }: { href: string; label: string; n: number }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between rounded-lg px-2 py-1 hover:bg-surface-2">
        <span className="text-text-2">{label}</span>
        <span className={`num font-semibold ${n ? "" : "text-muted"}`}>{formatNumber(n)}</span>
      </Link>
    </li>
  );
}

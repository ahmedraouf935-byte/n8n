import Link from "next/link";
import { Fragment } from "react";
import { Badge, Button, Card, Input, Notice, PageHeader, Stat, Table } from "@/components/ui";
import { getSql } from "@/lib/db/client";
import { formatEGP, formatPct } from "@/lib/domain/money";
import { formatDateTime } from "@/lib/domain/time";
import type { GateResult } from "@/lib/domain/gates";
import { getCashPosition } from "@/lib/services/cash";
import { approveAction, cancelPoAction, payAction, receiveAction, rejectAction } from "./actions";

export default async function PurchasesPage() {
  const sql = getSql();
  const cash = await getCashPosition(sql);
  const pending = await sql<{ id: number; variant_id: number; name_ar: string; sku: string; supplier_name: string; quantity: number; unit_cost: number; pickup_cost: number;
    planned_total_cost: number; planned_sell_price: number; gate_results: GateResult[]; economics: { base?: { contributionMarginPct: number; contributionPerDeliveredUnit: number; breakEvenShippedOrders: number | null }; scenarios?: { label: string; batchResult: number }[] }; created_at: Date }[]>`
    SELECT d.*, p.name_ar, v.sku, s.name AS supplier_name FROM purchase_decisions d
    JOIN product_variants v ON v.id = d.variant_id JOIN products p ON p.id = v.product_id
    JOIN supplier_offers o ON o.id = d.supplier_offer_id JOIN suppliers s ON s.id = o.supplier_id
    WHERE d.status = 'pending' ORDER BY d.id DESC`;
  const pos = await sql<{ id: number; po_number: string; status: string; name_ar: string; variant_id: number; supplier_name: string; quantity_ordered: number; quantity_received: number;
    unit_cost: number; total_cost: number; paid_amount: number; ordered_at: Date }[]>`
    SELECT po.*, p.name_ar, s.name AS supplier_name FROM purchase_orders po JOIN product_variants v ON v.id = po.variant_id JOIN products p ON p.id = v.product_id
    JOIN suppliers s ON s.id = po.supplier_id ORDER BY po.id DESC LIMIT 100`;
  const decided = await sql<{ id: number; status: string; name_ar: string; planned_total_cost: number; decided_at: Date; reason: string | null }[]>`
    SELECT d.id, d.status, p.name_ar, d.planned_total_cost, d.decided_at, d.reason FROM purchase_decisions d JOIN product_variants v ON v.id = d.variant_id JOIN products p ON p.id = v.product_id
    WHERE d.status <> 'pending' ORDER BY d.decided_at DESC NULLS LAST LIMIT 20`;
  return (
    <>
      <PageHeader title="قرارات الشراء" subtitle="لا يتم أي شراء تلقائيًا. كل طلب يمر ببوابات الأمان ثم موافقة المالك، ويُعاد فحصه لحظة الموافقة." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="النقد المتاح" value={formatEGP(cash.cashBalance)} trust="verified" />
        <Stat label="ملتزم وغير مدفوع" value={formatEGP(cash.committedUnpaid)} />
        <Stat label="نقد غير ملتزم" value={formatEGP(cash.freeCash)} />
        <Stat label="المتبقي من ميزانية المخزون" value={formatEGP(cash.inventoryBudgetRemaining)} sub={`من ${formatEGP(cash.inventoryBudget)}`} />
      </div>

      <h2 className="mb-3 text-lg font-semibold">بانتظار الموافقة ({pending.length})</h2>
      {pending.length === 0 && <Card><p className="text-center text-sm text-muted">لا توجد طلبات معلّقة. اطلب شراء دفعة اختبار من صفحة المنتج.</p></Card>}
      <div className="grid gap-4">
        {pending.map((d) => {
          const failed = d.gate_results.filter((g) => g.severity === "block" && !g.passed);
          return (
            <Card key={d.id} title={<Link href={`/products/${d.variant_id}`} className="hover:underline">{d.name_ar} <span className="text-xs text-muted" dir="ltr">{d.sku}</span></Link>}
              actions={failed.length ? <Badge tone="bad">✕ {failed.length} بوابة غير مستوفاة</Badge> : <Badge tone="good">✓ كل البوابات ناجحة</Badge>}>
              <div className="grid gap-4 lg:grid-cols-[1fr_1fr_280px]">
                <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                  <dt className="text-muted">المورد</dt><dd>{d.supplier_name}</dd>
                  <dt className="text-muted">الكمية</dt><dd className="num">{d.quantity}</dd>
                  <dt className="text-muted">سعر الجملة</dt><dd className="num">{formatEGP(d.unit_cost)}</dd>
                  <dt className="text-muted">مواصلات</dt><dd className="num">{formatEGP(d.pickup_cost)}</dd>
                  <dt className="text-muted">إجمالي التكلفة</dt><dd className="num font-semibold">{formatEGP(d.planned_total_cost)}</dd>
                  <dt className="text-muted">النقد بعد الشراء</dt><dd className="num">{formatEGP(cash.freeCash - d.planned_total_cost)}</dd>
                  <dt className="text-muted">سعر البيع المخطط</dt><dd className="num">{formatEGP(d.planned_sell_price)}</dd>
                  <dt className="text-muted">هامش المساهمة</dt><dd className="num">{formatPct(d.economics.base?.contributionMarginPct)}</dd>
                  <dt className="text-muted">مساهمة/قطعة</dt><dd className="num">{formatEGP(d.economics.base?.contributionPerDeliveredUnit)}</dd>
                  {d.economics.scenarios?.map((s) => <Fragment key={s.label}><dt className="text-muted">نتيجة {s.label}</dt><dd className={`num ${s.batchResult < 0 ? "text-bad" : ""}`}>{formatEGP(s.batchResult)}</dd></Fragment>)}
                </dl>
                <ul className="space-y-1.5 text-sm">
                  {d.gate_results.map((g) => (
                    <li key={g.code} className="flex gap-2"><span className={g.passed ? "text-good" : g.severity === "block" ? "text-bad" : "text-warn"}>{g.passed ? "✓" : g.severity === "block" ? "✕" : "⚠"}</span><span>{g.message}</span></li>
                  ))}
                </ul>
                <div className="flex flex-col gap-2">
                  <form action={approveAction}><input type="hidden" name="id" value={d.id} /><Button className="w-full" disabled={failed.length > 0}>موافقة وإنشاء أمر شراء</Button></form>
                  {failed.length > 0 && <p className="text-xs text-muted">زر الموافقة معطّل حتى تُستوفى البوابات. سيتم إعادة الفحص عند الضغط.</p>}
                  <form action={rejectAction} className="flex gap-1"><input type="hidden" name="id" value={d.id} /><Input name="reason" placeholder="سبب الرفض" className="h-8 text-xs" /><Button size="sm" variant="secondary">رفض</Button></form>
                  <p className="text-xs text-muted">طُلب {formatDateTime(d.created_at)}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card title="أوامر الشراء" className="mt-6" padded={false}>
        <Table head={["الأمر", "المنتج / المورد", "الحالة", "مستلم/مطلوب", "التكلفة", "مدفوع", "دفع", "استلام"]} empty="لا توجد أوامر شراء.">
          {pos.map((p) => (
            <tr key={p.id}>
              <td className="text-xs" dir="ltr">{p.po_number}<div className="text-muted">{formatDateTime(p.ordered_at)}</div></td>
              <td><Link className="hover:underline" href={`/products/${p.variant_id}`}>{p.name_ar}</Link><div className="text-xs text-muted">{p.supplier_name}</div></td>
              <td><Badge tone={p.status === "received" ? "good" : p.status === "cancelled" ? "neutral" : "warn"}>{p.status}</Badge></td>
              <td className="num">{p.quantity_received}/{p.quantity_ordered}</td>
              <td className="num">{formatEGP(p.total_cost)}</td>
              <td className="num">{formatEGP(p.paid_amount)}</td>
              <td>{p.status !== "cancelled" && p.paid_amount < p.total_cost && (
                <form action={payAction} className="flex gap-1"><input type="hidden" name="poId" value={p.id} /><Input name="amount" className="h-8 w-24 text-xs" defaultValue={p.total_cost - p.paid_amount} /><Button size="sm" variant="secondary">دفع</Button></form>
              )}</td>
              <td>{(p.status === "ordered" || p.status === "partially_received") && (
                <div className="flex flex-col gap-1">
                  <form action={receiveAction} className="flex flex-wrap gap-1">
                    <input type="hidden" name="poId" value={p.id} />
                    <Input name="quantity" className="h-8 w-16 text-xs" defaultValue={p.quantity_ordered - p.quantity_received} title="الكمية المستلمة" />
                    <Input name="pickup" className="h-8 w-20 text-xs" placeholder="مواصلات" title="تكلفة المواصلات الفعلية" />
                    <Button size="sm">استلام</Button>
                  </form>
                  {p.paid_amount === 0 && p.quantity_received === 0 && <form action={cancelPoAction}><input type="hidden" name="poId" value={p.id} /><Button size="sm" variant="ghost">إلغاء الأمر</Button></form>}
                </div>
              )}</td>
            </tr>
          ))}
        </Table>
      </Card>
      {decided.length > 0 && (
        <Card title="قرارات سابقة" className="mt-4" padded={false}>
          <Table head={["#", "المنتج", "القرار", "التكلفة", "التاريخ", "السبب"]}>
            {decided.map((d) => <tr key={d.id}><td className="num">{d.id}</td><td>{d.name_ar}</td><td><Badge tone={d.status === "approved" ? "good" : "neutral"}>{d.status}</Badge></td><td className="num">{formatEGP(d.planned_total_cost)}</td><td className="text-xs">{formatDateTime(d.decided_at)}</td><td className="text-xs">{d.reason}</td></tr>)}
          </Table>
        </Card>
      )}
      <div className="mt-4"><Notice>تذكير: ابدأ بمنتج أو اثنين فقط، وحد أقصى للاختبار {formatEGP(cash.inventoryBudget)} للمخزون. الأرقام المتوقعة تقديرية وليست ضمانًا للمبيعات.</Notice></div>
    </>
  );
}

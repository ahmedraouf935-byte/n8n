import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Field, Input, Notice, PageHeader, Select, Table } from "@/components/ui";
import { getSql } from "@/lib/db/client";
import { formatEGP } from "@/lib/domain/money";
import { ORDER_STATUS_AR, nextStatuses, type OrderStatus } from "@/lib/domain/orders";
import { formatDateTime } from "@/lib/domain/time";
import { orderActuals } from "@/lib/services/orders";
import { getSettings } from "@/lib/services/settings";
import { collectAction, reconcileAction, returnAction, transitionAction } from "../actions";
import { STATUS_TONE } from "@/lib/ui/labels";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const sql = getSql();
  const [o] = await sql<{ id: number; order_number: string; status: OrderStatus; total_due: number; subtotal: number; discount_total: number; shipping_fee_charged: number;
    payment_method: string; channel: string; delivery_address: string | null; city: string | null; notes: string | null; customer: string; phone: string; created_at: Date;
    confirmed_at: Date | null; shipped_at: Date | null; delivered_at: Date | null; reconciled_at: Date | null }[]>`
    SELECT so.*, c.name AS customer, c.phone FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE so.id = ${id}`;
  if (!o) notFound();
  const items = await sql<{ id: number; variant_id: number; name_ar: string; sku: string; quantity: number; unit_price: number; unit_cost_snapshot: number | null; returned_quantity: number }[]>`
    SELECT oi.*, p.name_ar, v.sku FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id JOIN products p ON p.id = v.product_id WHERE oi.order_id = ${id}`;
  const payments = await sql<{ id: number; direction: string; amount: number; fee_amount: number; status: string; occurred_at: Date }[]>`SELECT * FROM payments WHERE order_id = ${id} ORDER BY id`;
  const [ship] = await sql<{ carrier: string; tracking_number: string | null; status: string; carrier_cost: number; return_cost: number }[]>`SELECT * FROM shipments WHERE order_id = ${id}`;
  const actuals = await orderActuals(sql, id);
  const settings = await getSettings(sql);
  const d = settings.unit_economics_defaults;
  const next = nextStatuses(o.status).filter((s) => s !== "returned");
  return (
    <>
      <PageHeader title={`طلب ${o.order_number}`} subtitle={<><Badge tone={STATUS_TONE[o.status]}>{ORDER_STATUS_AR[o.status]}</Badge> {o.reconciled_at && <Badge tone="good">✓ مُسوّى ماليًا</Badge>}</>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="التفاصيل" className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-y-1.5 text-sm sm:grid-cols-4">
            <dt className="text-muted">العميل</dt><dd>{o.customer}</dd><dt className="text-muted">الموبايل</dt><dd dir="ltr" className="text-right">{o.phone}</dd>
            <dt className="text-muted">العنوان</dt><dd>{[o.city, o.delivery_address].filter(Boolean).join(" — ") || "—"}</dd><dt className="text-muted">القناة</dt><dd>{o.channel}</dd>
            <dt className="text-muted">الإجمالي</dt><dd className="num">{formatEGP(o.subtotal)}</dd><dt className="text-muted">خصم</dt><dd className="num">{formatEGP(o.discount_total)}</dd>
            <dt className="text-muted">شحن على العميل</dt><dd className="num">{formatEGP(o.shipping_fee_charged)}</dd><dt className="text-muted">المستحق</dt><dd className="num font-semibold">{formatEGP(o.total_due)}</dd>
            <dt className="text-muted">الدفع</dt><dd>{o.payment_method}</dd><dt className="text-muted">الشحن</dt><dd>{ship ? `${ship.carrier} ${ship.tracking_number ?? ""} (${ship.status})` : "—"}</dd>
          </dl>
          <div className="mt-4">
            <Table head={["المنتج", "الكمية", "سعر القطعة", "تكلفة القطعة (COGS)", "مرتجع"]}>
              {items.map((i) => <tr key={i.id}><td><Link className="hover:underline" href={`/products/${i.variant_id}`}>{i.name_ar}</Link> <span className="text-xs text-muted" dir="ltr">{i.sku}</span></td><td className="num">{i.quantity}</td><td className="num">{formatEGP(i.unit_price)}</td><td className="num">{formatEGP(i.unit_cost_snapshot)}</td><td className="num">{i.returned_quantity}</td></tr>)}
            </Table>
          </div>
          {o.notes && <p className="mt-3 text-sm text-text-2">{o.notes}</p>}
        </Card>
        <Card title="المساهمة الفعلية (من الحركات المسجلة)">
          <dl className="space-y-1 text-sm">
            {([["محصّل", actuals.collected], ["عمولات تحصيل", -actuals.fees], ["مبالغ مستردة", -actuals.refunds], ["شحن", -actuals.carrierCost], ["تكاليف مرتجع", -actuals.returnCosts], ["مصروفات مرتبطة", -actuals.otherExpenses], ["تكلفة البضاعة", -actuals.cogs]] as const)
              .map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-text-2">{k}</dt><dd className={`num ${v < 0 ? "text-bad" : ""}`}>{formatEGP(v)}</dd></div>)}
            <div className="flex justify-between border-t border-border pt-2 font-semibold"><dt>المساهمة</dt><dd className="num">{formatEGP(actuals.contribution)}</dd></div>
          </dl>
          {actuals.pendingCollection > 0 && <div className="mt-3"><Notice tone="warn">تحصيل معلّق {formatEGP(actuals.pendingCollection)} — لم يدخل النقدية بعد.</Notice></div>}
          <ul className="mt-3 space-y-1 text-xs text-muted">{payments.map((p) => <li key={p.id}>{p.direction === "in" ? "تحصيل" : "استرداد"} {formatEGP(p.amount)} — {p.status} — {formatDateTime(p.occurred_at)}</li>)}</ul>
        </Card>
      </div>

      <Card title="الإجراء التالي" className="mt-4">
        <div className="flex flex-wrap gap-4">
          {next.map((to) => (
            <form key={to} action={transitionAction} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
              <input type="hidden" name="orderId" value={id} /><input type="hidden" name="to" value={to} />
              {to === "packed" && <Field label="تكلفة التغليف"><Input name="packagingCost" defaultValue={d.packaging_per_order} className="w-24" /></Field>}
              {to === "shipped" && <>
                <Field label="شركة الشحن"><Input name="carrier" required placeholder="Bosta / Aramex…" className="w-36" /></Field>
                <Field label="رقم التتبع"><Input name="tracking" className="w-32" dir="ltr" /></Field>
                <Field label="تكلفة الشحن الفعلية"><Input name="carrierCost" defaultValue={d.carrier_cost_per_order} className="w-24" /></Field>
              </>}
              {to === "delivered" && <>
                <Field label="تم استلام المبلغ؟"><Select name="collected" options={[["true", "نعم، استلمنا النقود"], ["false", "لا، معلّق لدى شركة الشحن"]]} /></Field>
                <Field label="عمولة التحصيل"><Input name="collectionFee" defaultValue={Math.round(o.total_due * d.cod_fee_pct) / 100} className="w-24" /></Field>
              </>}
              {to === "failed_delivery" && <>
                <Field label="رسوم المرتجع"><Input name="returnCost" defaultValue={d.failed_delivery_cost} className="w-24" /></Field>
                <Field label="السبب"><Input name="reason" placeholder="رفض الاستلام…" /></Field>
              </>}
              {to === "cancelled" && <Field label="السبب"><Input name="reason" /></Field>}
              <Button variant={to === "cancelled" || to === "failed_delivery" ? "secondary" : "primary"}>{ORDER_STATUS_AR[to]}</Button>
            </form>
          ))}
          {payments.some((p) => p.status === "pending") && <form action={collectAction}><input type="hidden" name="orderId" value={id} /><Button>تأكيد استلام المبلغ من شركة الشحن</Button></form>}
          {["delivered", "returned", "failed_delivery", "cancelled"].includes(o.status) && !o.reconciled_at && (
            <form action={reconcileAction}><input type="hidden" name="orderId" value={id} /><Button variant="secondary">تسوية مالية نهائية</Button></form>
          )}
          {next.length === 0 && o.status !== "delivered" && <p className="text-sm text-muted">الطلب في حالة نهائية.</p>}
        </div>
      </Card>

      {o.status === "delivered" && (
        <Card title="تسجيل مرتجع من العميل" className="mt-4">
          <form action={returnAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="orderId" value={id} />
            <Field label="الصنف"><Select name="orderItemId" options={items.map((i) => [String(i.id), `${i.name_ar} (${i.quantity - i.returned_quantity} قابل للإرجاع)`])} /></Field>
            <Field label="الكمية"><Input name="quantity" defaultValue="1" className="w-20" /></Field>
            <Field label="الحالة"><Select name="condition" options={[["resellable", "سليم — يرجع للمخزون"], ["defective", "تالف"]]} /></Field>
            <Field label="المبلغ المسترد"><Input name="refundAmount" defaultValue={items[0]?.unit_price ?? 0} className="w-24" /></Field>
            <Field label="تكلفة شحن المرتجع"><Input name="returnShippingCost" defaultValue={d.return_cost} className="w-24" /></Field>
            <Field label="السبب"><Input name="reason" /></Field>
            <Button variant="secondary">تسجيل المرتجع</Button>
          </form>
        </Card>
      )}
    </>
  );
}

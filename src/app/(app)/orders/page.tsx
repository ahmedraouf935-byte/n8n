import Link from "next/link";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Table, Textarea } from "@/components/ui";
import { getSql } from "@/lib/db/client";
import { formatEGP } from "@/lib/domain/money";
import { ORDER_STATUS_AR } from "@/lib/domain/orders";
import { formatDateTime } from "@/lib/domain/time";
import { getSettings } from "@/lib/services/settings";
import { createOrderAction } from "./actions";
import { STATUS_TONE } from "@/lib/ui/labels";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const sql = getSql();
  const orders = await sql<{ id: number; order_number: string; status: string; customer: string; phone: string; city: string | null; total_due: number; payment_method: string;
    channel: string; created_at: Date; reconciled_at: Date | null; items: string; collected: number; pending: number }[]>`
    SELECT so.id, so.order_number, so.status, c.name AS customer, c.phone, so.city, so.total_due, so.payment_method, so.channel, so.created_at, so.reconciled_at,
      (SELECT string_agg(p.name_ar || ' ×' || oi.quantity, '، ') FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id JOIN products p ON p.id = v.product_id WHERE oi.order_id = so.id) AS items,
      COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = so.id AND direction = 'in' AND status = 'collected'),0) AS collected,
      COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = so.id AND direction = 'in' AND status = 'pending'),0) AS pending
    FROM sales_orders so JOIN customers c ON c.id = so.customer_id
    WHERE (${sp.status ?? null}::text IS NULL OR so.status = ${sp.status ?? null})
    ORDER BY so.id DESC LIMIT 200`;
  const sellable = await sql<{ id: number; name_ar: string; label: string; available: number; price: number | null }[]>`
    SELECT v.id, p.name_ar, v.label, l.on_hand - l.reserved AS available, COALESCE(o.owner_price, o.recommended_price) AS price
    FROM inventory_levels l JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN opportunities o ON o.variant_id = v.id
    WHERE l.on_hand - l.reserved > 0 ORDER BY p.name_ar`;
  const campaigns = await sql<{ id: number; name: string }[]>`SELECT id, name FROM campaign_results ORDER BY start_date DESC LIMIT 30`;
  const settings = await getSettings(sql);
  return (
    <>
      <PageHeader title="الطلبات" subtitle="جديد ← مؤكد ← مُغلّف ← مشحون ← مُسلّم/فشل/مرتجع/ملغي ← تسوية مالية" />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/orders" className={`rounded-full px-3 py-1 ${!sp.status ? "bg-accent text-accent-ink" : "bg-surface-2"}`}>الكل</Link>
        {Object.entries(ORDER_STATUS_AR).map(([k, v]) => <Link key={k} href={`/orders?status=${k}`} className={`rounded-full px-3 py-1 ${sp.status === k ? "bg-accent text-accent-ink" : "bg-surface-2"}`}>{v}</Link>)}
      </div>
      <Card padded={false}>
        <Table head={["الطلب", "العميل", "المنتجات", "القيمة", "الدفع", "التحصيل", "الحالة", "التاريخ"]} empty="لا توجد طلبات.">
          {orders.map((o) => (
            <tr key={o.id}>
              <td><Link href={`/orders/${o.id}`} className="font-medium hover:underline" dir="ltr">{o.order_number}</Link><div className="text-xs text-muted">{o.channel}</div></td>
              <td>{o.customer}<div className="text-xs text-muted" dir="ltr">{o.phone}</div>{o.city && <div className="text-xs text-muted">{o.city}</div>}</td>
              <td className="max-w-56 text-xs">{o.items}</td>
              <td className="num">{formatEGP(o.total_due)}</td>
              <td className="text-xs">{o.payment_method}</td>
              <td className="num text-xs">{o.collected ? formatEGP(o.collected) : o.pending ? <Badge tone="warn">معلّق {formatEGP(o.pending)}</Badge> : "—"}</td>
              <td><Badge tone={STATUS_TONE[o.status]}>{ORDER_STATUS_AR[o.status as "new"]}</Badge>{o.reconciled_at && <div><Badge tone="good">✓ مُسوّى</Badge></div>}</td>
              <td className="text-xs">{formatDateTime(o.created_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="طلب جديد" className="mt-6">
        {sellable.length === 0 ? <p className="text-sm text-muted">لا يوجد مخزون متاح للبيع. استلم أمر شراء أولًا.</p> : (
          <form action={createOrderAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="اسم العميل *"><Input name="name" required /></Field>
            <Field label="الموبايل *"><Input name="phone" required dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" /></Field>
            <Field label="المدينة/المحافظة"><Input name="city" /></Field>
            <Field label="العنوان"><Input name="address" /></Field>
            <Field label="المنتج" className="lg:col-span-2"><Select name="variantId" options={sellable.map((s) => [String(s.id), `${s.name_ar} — ${s.label} (متاح ${s.available})`])} /></Field>
            <Field label="الكمية"><Input name="quantity" defaultValue="1" inputMode="numeric" /></Field>
            <Field label="سعر القطعة *"><Input name="unitPrice" required inputMode="decimal" defaultValue={sellable[0]?.price ?? ""} /></Field>
            <Field label="رسوم الشحن على العميل"><Input name="shippingFee" defaultValue={settings.unit_economics_defaults.shipping_fee_charged} inputMode="decimal" /></Field>
            <Field label="خصم"><Input name="discount" defaultValue="0" inputMode="decimal" /></Field>
            <Field label="طريقة الدفع"><Select name="paymentMethod" options={[["cod", "دفع عند الاستلام"], ["instapay", "إنستاباي"], ["vodafone_cash", "فودافون كاش"], ["bank", "تحويل بنكي"], ["cash", "نقدي"], ["other", "أخرى"]]} /></Field>
            <Field label="القناة"><Select name="channel" options={[["whatsapp", "واتساب"], ["facebook", "فيسبوك"], ["instagram", "إنستجرام"], ["tiktok", "تيك توك"], ["other", "أخرى"]]} /></Field>
            <Field label="الحملة"><Select name="campaignId" options={[["", "—"], ...campaigns.map((c) => [String(c.id), c.name] as [string, string])]} /></Field>
            <Field label="ملاحظات" className="sm:col-span-2 lg:col-span-3"><Textarea name="notes" /></Field>
            <div className="sm:col-span-2 lg:col-span-4"><Button>إنشاء الطلب</Button></div>
          </form>
        )}
      </Card>
    </>
  );
}

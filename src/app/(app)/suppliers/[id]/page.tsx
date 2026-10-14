import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, ExternalLink, Input, PageHeader, Table, TrustBadge } from "@/components/ui";
import { getSql } from "@/lib/db/client";
import { formatEGP } from "@/lib/domain/money";
import { formatDateTime } from "@/lib/domain/time";
import { MARKET_AR } from "@/lib/ui/labels";
import { updateSupplierAction } from "../actions";
import { SupplierFields } from "../SupplierForm";

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const sql = getSql();
  const [s] = await sql`SELECT * FROM suppliers WHERE id = ${id}` as never as [Record<string, never> & { name: string; market_area: string; is_active: boolean }];
  if (!s) notFound();
  const offers = await sql<{ id: number; title_raw: string; quoted_price: number | null; min_order_qty: number; status: string; match_status: string; variant_id: number | null;
    name_ar: string | null; sku: string | null; source_url: string | null; quoted_at: Date }[]>`
    SELECT o.id, o.title_raw, o.quoted_price, o.min_order_qty, o.status, o.match_status, o.variant_id, p.name_ar, v.sku, o.source_url, o.quoted_at
    FROM supplier_offers o LEFT JOIN product_variants v ON v.id = o.variant_id LEFT JOIN products p ON p.id = v.product_id
    WHERE o.supplier_id = ${id} ORDER BY o.quoted_at DESC LIMIT 200`;
  const pos = await sql<{ id: number; po_number: string; status: string; total_cost: number; paid_amount: number; quantity_ordered: number; quantity_received: number; ordered_at: Date }[]>`
    SELECT id, po_number, status, total_cost, paid_amount, quantity_ordered, quantity_received, ordered_at FROM purchase_orders WHERE supplier_id = ${id} ORDER BY id DESC`;
  return (
    <>
      <PageHeader title={s.name} subtitle={MARKET_AR[s.market_area]} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="عروض المورد" className="lg:col-span-2" padded={false}>
          <Table head={["العرض", "السعر", "أقل كمية", "الحالة", "المنتج", "التاريخ"]}>
            {offers.map((o) => (
              <tr key={o.id}>
                <td className="max-w-80 whitespace-pre-line text-xs">{o.title_raw.slice(0, 200)}<div><ExternalLink href={o.source_url}>المصدر</ExternalLink></div></td>
                <td className="num">{formatEGP(o.quoted_price)}</td><td className="num">{o.min_order_qty}</td>
                <td><TrustBadge label={o.status === "rejected" ? "unavailable" : (o.status as "verified")} /></td>
                <td>{o.variant_id ? <Link className="hover:underline" href={`/products/${o.variant_id}`}>{o.name_ar}</Link> : <Badge>غير مربوط</Badge>}<div className="text-xs text-muted">{o.match_status}</div></td>
                <td className="text-xs">{formatDateTime(o.quoted_at)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="سجل الشراء" padded={false}>
          <Table head={["أمر", "الحالة", "الكمية", "التكلفة"]} empty="لا توجد مشتريات.">
            {pos.map((p) => (
              <tr key={p.id}><td className="text-xs" dir="ltr">{p.po_number}</td><td><Badge>{p.status}</Badge></td><td className="num">{p.quantity_received}/{p.quantity_ordered}</td><td className="num">{formatEGP(p.total_cost)}<div className="text-xs text-muted">مدفوع {formatEGP(p.paid_amount)}</div></td></tr>
            ))}
          </Table>
        </Card>
      </div>
      <Card title="بيانات المورد" className="mt-4">
        <form action={updateSupplierAction}>
          <input type="hidden" name="id" value={id} />
          <SupplierFields s={s} />
          <label className="mt-3 flex items-center gap-2 text-sm"><Input type="checkbox" name="isActive" defaultChecked={s.is_active} /> مورد نشط</label>
          <div className="mt-4"><Button>حفظ</Button></div>
        </form>
      </Card>
    </>
  );
}

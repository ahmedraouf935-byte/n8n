import Link from "next/link";
import { Badge, Button, Card, Input, PageHeader, Table } from "@/components/ui";
import { getSql } from "@/lib/db/client";
import { formatEGP } from "@/lib/domain/money";
import { formatDateTime } from "@/lib/domain/time";
import { getInventory, setReorderThreshold } from "@/lib/services/inventory";
import { act, int } from "@/lib/ui/action";
import { PRODUCT_STATUS_AR } from "@/lib/ui/labels";

async function thresholdAction(fd: FormData) {
  "use server";
  await act("/inventory", async ({ sql }) => { await setReorderThreshold(sql, Number(fd.get("variantId")), int(fd, "threshold") ?? 0); });
}

export default async function InventoryPage() {
  const sql = getSql();
  const rows = await getInventory(sql);
  const moves = await sql<{ id: number; movement_type: string; sku: string; on_hand_delta: number; reserved_delta: number; in_transit_delta: number; sold_delta: number; defective_delta: number; reference_type: string | null; reference_id: number | null; created_at: Date }[]>`
    SELECT m.*, v.sku FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id ORDER BY m.id DESC LIMIT 30`;
  const ageing = await sql<{ variant_id: number; days: number }[]>`
    SELECT variant_id, EXTRACT(day FROM now() - max(received_at))::int AS days FROM inventory_batches GROUP BY variant_id`;
  const age = new Map(ageing.map((a) => [a.variant_id, a.days]));
  return (
    <>
      <PageHeader title="المخزون" subtitle="المتاح = في المخزن − المحجوز. كل حركة مسجلة؛ قاعدة البيانات تمنع البيع بأكثر من المتاح." />
      <Card padded={false}>
        <Table head={["SKU / المنتج", "مشترى", "في المخزن", "محجوز", "متاح", "في الشحن", "مباع", "مرتجع", "تالف", "تكلفة القطعة", "القيمة", "حد إعادة الطلب", "الحالة"]} empty="لا يوجد مخزون مستلم بعد.">
          {rows.map((r) => {
            const low = r.available <= r.reorder_threshold;
            const days = age.get(r.variant_id) ?? 0;
            const slow = days > 21 && r.sold < r.total_received * 0.3;
            return (
              <tr key={r.variant_id}>
                <td><Link className="font-medium hover:underline" href={`/products/${r.variant_id}`}>{r.name_ar}</Link><div className="text-xs text-muted" dir="ltr">{r.sku}</div></td>
                <td className="num">{r.total_received}</td><td className="num">{r.on_hand}</td><td className="num">{r.reserved}</td>
                <td className="num font-semibold">{r.available}</td><td className="num">{r.in_transit}</td><td className="num">{r.sold}</td><td className="num">{r.returned}</td><td className="num">{r.defective}</td>
                <td className="num">{formatEGP(r.avg_unit_cost)}</td><td className="num">{formatEGP((r.on_hand + r.in_transit) * r.avg_unit_cost)}</td>
                <td><form action={thresholdAction} className="flex gap-1"><input type="hidden" name="variantId" value={r.variant_id} /><Input name="threshold" defaultValue={r.reorder_threshold} className="h-8 w-14 text-xs" /><Button size="sm" variant="ghost">✓</Button></form></td>
                <td className="space-y-1">
                  <Badge>{PRODUCT_STATUS_AR[r.product_status]}</Badge>
                  {low && <div><Badge tone="warn">⚠ مخزون منخفض</Badge></div>}
                  {slow && <div><Badge tone="bad" title={`${days} يوم منذ آخر استلام`}>بطيء الحركة</Badge></div>}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
      <Card title="آخر حركات المخزون" className="mt-4" padded={false}>
        <Table head={["#", "SKU", "النوع", "مخزن", "محجوز", "شحن", "مباع", "تالف", "المرجع", "الوقت"]}>
          {moves.map((m) => (
            <tr key={m.id} className="text-xs">
              <td className="num">{m.id}</td><td dir="ltr">{m.sku}</td><td>{m.movement_type}</td>
              {[m.on_hand_delta, m.reserved_delta, m.in_transit_delta, m.sold_delta, m.defective_delta].map((x, i) => <td key={i} className={`num ${x > 0 ? "text-good" : x < 0 ? "text-bad" : "text-muted"}`}>{x > 0 ? `+${x}` : x || "·"}</td>)}
              <td>{m.reference_type === "sales_order" ? <Link className="text-info" href={`/orders/${m.reference_id}`}>طلب #{m.reference_id}</Link> : m.reference_type ? `${m.reference_type} #${m.reference_id}` : "—"}</td>
              <td>{formatDateTime(m.created_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

import Link from "next/link";
import { Badge, Button, Card, LinkButton, PageHeader, Table } from "@/components/ui";
import { getSql } from "@/lib/db/client";
import { formatDateTime } from "@/lib/domain/time";
import { MARKET_AR } from "@/lib/ui/labels";
import { createSupplierAction } from "./actions";
import { SupplierFields } from "./SupplierForm";

export default async function SuppliersPage() {
  const sql = getSql();
  const rows = await sql<{ id: number; name: string; shop_name: string | null; market_area: string; phone: string | null; whatsapp: string | null; telegram_handle: string | null;
    telegram_chat_id: string | null; reliability_rating: number | null; last_contact_at: Date | null; is_active: boolean; offers: number; verified: number; pos: number }[]>`
    SELECT s.*, (SELECT count(*)::int FROM supplier_offers o WHERE o.supplier_id = s.id) AS offers,
      (SELECT count(*)::int FROM supplier_offers o WHERE o.supplier_id = s.id AND o.status = 'verified') AS verified,
      (SELECT count(*)::int FROM purchase_orders p WHERE p.supplier_id = s.id AND p.status <> 'cancelled') AS pos
    FROM suppliers s ORDER BY s.is_active DESC, s.name`;
  const [inbox] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM supplier_offers WHERE match_status IN ('unmatched','probable') AND status NOT IN ('rejected')`;
  return (
    <>
      <PageHeader title="دليل الموردين" subtitle="موردو الجملة في الموسكي والعتبة وغيرها. «متوفر» يعني فقط أن المالك أكد التوفر بنفسه."
        actions={<LinkButton href="/suppliers/inbox" variant="primary">صندوق مطابقة العروض ({inbox.n})</LinkButton>} />
      <Card padded={false}>
        <Table head={["المورد", "المنطقة", "التواصل", "تيليجرام", "العروض", "أوامر شراء", "الموثوقية", "آخر تواصل"]} empty="لم تتم إضافة موردين بعد.">
          {rows.map((s) => (
            <tr key={s.id} className={s.is_active ? "" : "opacity-50"}>
              <td><Link href={`/suppliers/${s.id}`} className="font-medium hover:underline">{s.name}</Link>{s.shop_name && <div className="text-xs text-muted">{s.shop_name}</div>}</td>
              <td>{MARKET_AR[s.market_area]}</td>
              <td className="text-xs" dir="ltr">{s.phone}{s.whatsapp && <div>WA {s.whatsapp}</div>}</td>
              <td className="text-xs">{s.telegram_chat_id ? <Badge tone="good">✓ مربوط</Badge> : s.telegram_handle ? <span dir="ltr">{s.telegram_handle}</span> : "—"}</td>
              <td className="num">{s.offers} <span className="text-xs text-muted">({s.verified} مؤكد)</span></td>
              <td className="num">{s.pos}</td>
              <td className="num">{s.reliability_rating ?? "—"}</td>
              <td className="text-xs">{formatDateTime(s.last_contact_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="إضافة مورد" className="mt-6">
        <form action={createSupplierAction}><SupplierFields /><div className="mt-4"><Button>إضافة المورد</Button></div></form>
      </Card>
    </>
  );
}

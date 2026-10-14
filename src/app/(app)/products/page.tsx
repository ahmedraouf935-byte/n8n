import Link from "next/link";
import { Badge, Card, Field, Input, LinkButton, PageHeader, Select, Button, Table } from "@/components/ui";
import { getSql } from "@/lib/db/client";
import { formatEGP } from "@/lib/domain/money";
import { formatDateTime } from "@/lib/domain/time";
import { BAND_AR, CONF_AR, PRODUCT_STATUS_AR, RISK_AR } from "@/lib/ui/labels";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; band?: string; status?: string }> }) {
  const sp = await searchParams;
  const sql = getSql();
  const like = sp.q ? `%${sp.q}%` : null;
  const rows = await sql<{ variant_id: number; sku: string; label: string; verified: boolean; name_ar: string; name_en: string | null; status: string; risk_category: string;
    total_score: number | null; confidence: string | null; band: string | null; computed_at: Date | null; recommended_price: number | null; estimated_unit_profit: number | null;
    opp_status: string | null; retail_n: number; supplier_n: number; verified_n: number; signals: number }[]>`
    SELECT v.id AS variant_id, v.sku, v.label, v.verified, p.name_ar, p.name_en, p.status, p.risk_category,
      s.total_score, s.confidence, s.band, s.computed_at, o.recommended_price, o.estimated_unit_profit, o.status AS opp_status,
      (SELECT count(*)::int FROM retail_offers r WHERE r.variant_id = v.id AND r.match_status IN ('exact','probable')) AS retail_n,
      (SELECT count(*)::int FROM supplier_offers so WHERE so.variant_id = v.id AND so.match_status <> 'mismatch') AS supplier_n,
      (SELECT count(*)::int FROM supplier_offers so WHERE so.variant_id = v.id AND so.status = 'verified') AS verified_n,
      (SELECT count(*)::int FROM trend_signals t WHERE t.product_id = p.id) AS signals
    FROM product_variants v JOIN products p ON p.id = v.product_id
    LEFT JOIN opportunities o ON o.variant_id = v.id LEFT JOIN product_scores s ON s.id = o.latest_score_id
    WHERE (${like}::text IS NULL OR p.name_ar ILIKE ${like} OR p.name_en ILIKE ${like} OR v.sku ILIKE ${like})
      AND (${sp.band ?? null}::text IS NULL OR s.band = ${sp.band ?? null})
      AND (${sp.status ?? null}::text IS NULL OR p.status = ${sp.status ?? null})
    ORDER BY s.total_score DESC NULLS LAST, p.created_at DESC LIMIT 300`;
  return (
    <>
      <PageHeader title="أبحاث المنتجات والفرص" subtitle="كل صف = مقاس/موديل محدد (SKU). الدرجة معيار داخلي قابل للتعديل وليست تنبؤًا بالمبيعات."
        actions={<LinkButton href="/products/new" variant="primary">+ منتج جديد</LinkButton>} />
      <Card className="mb-4" padded={false}>
        <form className="flex flex-wrap items-end gap-3 p-4">
          <Field label="بحث" className="min-w-48 flex-1"><Input name="q" defaultValue={sp.q} /></Field>
          <Field label="التصنيف"><Select name="band" defaultValue={sp.band ?? ""} options={[["", "الكل"], ...Object.entries(BAND_AR)]} /></Field>
          <Field label="حالة المنتج"><Select name="status" defaultValue={sp.status ?? ""} options={[["", "الكل"], ...Object.entries(PRODUCT_STATUS_AR)]} /></Field>
          <Button variant="secondary">تطبيق</Button>
        </form>
      </Card>
      <Card padded={false}>
        <Table head={["المنتج", "الحالة", "الدرجة", "الثقة", "الأدلة", "سعر مقترح", "مساهمة/قطعة", "آخر حساب"]} empty="لا توجد منتجات بعد.">
          {rows.map((r) => (
            <tr key={r.variant_id}>
              <td>
                <Link href={`/products/${r.variant_id}`} className="font-medium hover:underline">{r.name_ar}</Link>
                <div className="text-xs text-muted">{r.label} · <span dir="ltr">{r.sku}</span> {r.verified ? <Badge tone="good">✓ مقاس مؤكد</Badge> : <Badge tone="warn">? مقاس غير مؤكد</Badge>}</div>
              </td>
              <td><Badge>{PRODUCT_STATUS_AR[r.status]}</Badge>{r.risk_category !== "general" && <div className="mt-1"><Badge tone="warn">{RISK_AR[r.risk_category]}</Badge></div>}</td>
              <td className="num text-lg font-semibold">{r.total_score ?? "—"}{r.band && <div><Badge tone={r.band === "high_priority" ? "good" : r.band === "manual_review" ? "warn" : "neutral"}>{BAND_AR[r.band]}</Badge></div>}</td>
              <td>{r.confidence ? CONF_AR[r.confidence] : "—"}</td>
              <td className="text-xs text-text-2">ترند: {r.signals} · تجزئة: {r.retail_n} · موردين: {r.supplier_n} ({r.verified_n} مؤكد)</td>
              <td className="num">{formatEGP(r.recommended_price)}</td>
              <td className="num">{r.estimated_unit_profit === null ? "—" : <span className={r.estimated_unit_profit <= 0 ? "text-bad" : ""}>{formatEGP(r.estimated_unit_profit)}</span>}</td>
              <td className="text-xs text-muted">{formatDateTime(r.computed_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

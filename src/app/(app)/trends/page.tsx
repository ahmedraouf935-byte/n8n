import Link from "next/link";
import { Badge, Button, Card, ExternalLink, Field, Input, PageHeader, Select, Table, Textarea } from "@/components/ui";
import { getSql } from "@/lib/db/client";
import { formatNumber, formatPct } from "@/lib/domain/money";
import { formatDateTime } from "@/lib/domain/time";
import { EVIDENCE_AR, PLATFORM_AR } from "@/lib/ui/labels";
import { addSignalAction, importCsvAction, linkSignalAction, signalStatusAction } from "./actions";

type SP = { platform?: string; region?: string; evidence?: string; status?: string; q?: string; sort?: string };

export default async function TrendsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sql = getSql();
  const like = sp.q ? `%${sp.q}%` : null;
  const rows = await sql<{
    id: number; title_raw: string; platform: string; source_url: string | null; image_url: string | null; region: string; metric_type: string | null;
    metric_value: number | null; previous_value: number | null; measured_growth_pct: number | null; evidence_type: string; confidence: number;
    collection_method: string; discovered_at: Date; last_verified_at: Date | null; status: string; product_id: number | null; product_name: string | null;
    variant_id: number | null; score: number | null; source_name: string; notes: string | null;
  }[]>`
    SELECT t.*, p.name_ar AS product_name, ds.name AS source_name,
      (SELECT v.id FROM product_variants v WHERE v.product_id = t.product_id ORDER BY v.id LIMIT 1) AS variant_id,
      (SELECT max(s.total_score) FROM product_variants v JOIN opportunities o ON o.variant_id = v.id JOIN product_scores s ON s.id = o.latest_score_id WHERE v.product_id = t.product_id) AS score
    FROM trend_signals t JOIN data_sources ds ON ds.id = t.source_id LEFT JOIN products p ON p.id = t.product_id
    WHERE (${sp.platform ?? null}::text IS NULL OR t.platform = ${sp.platform ?? null})
      AND (${sp.region ?? null}::text IS NULL OR (CASE WHEN ${sp.region ?? null} = 'EG' THEN t.region = 'EG' ELSE t.region <> 'EG' END))
      AND (${sp.evidence ?? null}::text IS NULL OR t.evidence_type = ${sp.evidence ?? null})
      AND (${sp.status ?? null}::text IS NULL OR t.status = ${sp.status ?? null})
      AND (${like}::text IS NULL OR t.title_raw ILIKE ${like})
    ORDER BY ${sp.sort === "confidence" ? sql`t.confidence DESC, t.discovered_at DESC` : sp.sort === "growth" ? sql`t.measured_growth_pct DESC NULLS LAST` : sql`t.discovered_at DESC`}
    LIMIT 200`;
  const products = await sql<{ id: number; name_ar: string }[]>`SELECT id, name_ar FROM products WHERE status NOT IN ('rejected','stopped') ORDER BY name_ar`;
  const sources = await sql<{ code: string; name: string; access_status: string; notes: string | null }[]>`
    SELECT code, name, access_status, notes FROM data_sources WHERE platform IN ('tiktok','facebook','instagram','google_trends') OR code IN ('manual_entry','csv_import','owner_screenshot','n8n_webhook') ORDER BY access_status, name`;

  return (
    <>
      <PageHeader title="رادار الترند" subtitle="إشارات طلب موثقة بالمصدر والتوقيت. الأرقام المقاسة منفصلة عن ملاحظات المالك وفرضيات الذكاء الاصطناعي." />

      <Card className="mb-4" padded={false}>
        <form className="flex flex-wrap items-end gap-3 p-4" method="get">
          <Field label="بحث" className="min-w-48 flex-1"><Input name="q" defaultValue={sp.q} placeholder="اسم المنتج…" /></Field>
          <Field label="المنصة"><Select name="platform" defaultValue={sp.platform ?? ""} options={[["", "الكل"], ...Object.entries(PLATFORM_AR)]} /></Field>
          <Field label="النطاق"><Select name="region" defaultValue={sp.region ?? ""} options={[["", "الكل"], ["EG", "مصر"], ["GLOBAL", "عالمي/خارج مصر"]]} /></Field>
          <Field label="نوع الدليل"><Select name="evidence" defaultValue={sp.evidence ?? ""} options={[["", "الكل"], ...Object.entries(EVIDENCE_AR)]} /></Field>
          <Field label="الحالة"><Select name="status" defaultValue={sp.status ?? ""} options={[["", "الكل"], ["new", "جديد"], ["saved", "محفوظ"], ["researching", "قيد البحث"], ["linked", "مرتبط بمنتج"], ["rejected", "مرفوض"]]} /></Field>
          <Field label="ترتيب"><Select name="sort" defaultValue={sp.sort ?? "date"} options={[["date", "الأحدث"], ["confidence", "الثقة"], ["growth", "النمو المقاس"]]} /></Field>
          <Button type="submit" variant="secondary">تطبيق</Button>
        </form>
      </Card>

      <Card title={`الإشارات (${rows.length})`} padded={false}>
        <Table head={["", "المنتج / العنوان", "المصدر", "المؤشرات", "الدليل", "الثقة", "الاكتشاف", "الدرجة", "إجراءات"]}
          empty="لا توجد إشارات. أضف إشارة يدويًا أو استورد ملف CSV أو فعّل استيراد n8n.">
          {rows.map((r) => (
            <tr key={r.id} className={r.status === "rejected" ? "opacity-50" : ""}>
              <td className="w-14">
                {r.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image_url} alt="" referrerPolicy="no-referrer" className="h-12 w-12 rounded-md border border-border object-cover" title="معاينة مرجعية من المصدر" />
                ) : <div className="grid h-12 w-12 place-items-center rounded-md bg-surface-2 text-xs text-muted">—</div>}
              </td>
              <td className="max-w-72">
                <div className="font-medium">{r.title_raw}</div>
                {r.product_name && <Link href={r.variant_id ? `/products/${r.variant_id}` : "/products"} className="text-xs text-accent hover:underline">↳ {r.product_name}</Link>}
                {r.notes && <div className="mt-1 text-xs text-muted">{r.notes}</div>}
              </td>
              <td>
                <div>{PLATFORM_AR[r.platform] ?? r.platform} · <Badge tone={r.region === "EG" ? "accent" : "neutral"}>{r.region === "EG" ? "مصر" : r.region}</Badge></div>
                <div className="text-xs"><ExternalLink href={r.source_url} /></div>
                <div className="text-xs text-muted">{r.source_name} · {r.collection_method}</div>
              </td>
              <td className="num text-xs">
                {r.metric_type ? <>{r.metric_type}: {formatNumber(r.metric_value)}{r.previous_value != null && <> (سابقًا {formatNumber(r.previous_value)})</>}</> : <span className="text-muted">—</span>}
                {r.measured_growth_pct != null && <div className="font-semibold text-good">نمو {formatPct(r.measured_growth_pct)}</div>}
              </td>
              <td><Badge tone={r.evidence_type === "measured" ? "good" : r.evidence_type === "owner_reported" ? "info" : "warn"}>{EVIDENCE_AR[r.evidence_type]}</Badge></td>
              <td className="num">{Math.round(r.confidence * 100)}٪</td>
              <td className="text-xs text-text-2">{formatDateTime(r.discovered_at)}{r.last_verified_at && <div className="text-muted">تحقق: {formatDateTime(r.last_verified_at)}</div>}</td>
              <td className="num">{r.score ?? <span className="text-muted">—</span>}</td>
              <td className="min-w-52">
                <div className="flex flex-wrap gap-1">
                  {r.status !== "saved" && <StatusBtn id={r.id} status="saved" label="حفظ" />}
                  {r.status !== "rejected" && <StatusBtn id={r.id} status="rejected" label="رفض" />}
                  {!r.product_id && <Link href={`/products/new?signal=${r.id}`} className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-xs font-medium text-accent-ink">بحث ← منتج</Link>}
                </div>
                {!r.product_id && products.length > 0 && (
                  <form action={linkSignalAction} className="mt-1 flex gap-1">
                    <input type="hidden" name="id" value={r.id} />
                    <Select name="productId" className="h-8 text-xs" options={products.map((p) => [String(p.id), p.name_ar])} />
                    <Button size="sm" variant="secondary">ربط</Button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="تسجيل إشارة ترند">
          <form action={addSignalAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="اسم المنتج (عربي) *" className="sm:col-span-2"><Input name="title" required maxLength={300} /></Field>
            <Field label="الاسم بالإنجليزية"><Input name="titleEn" dir="ltr" /></Field>
            <Field label="المنصة *"><Select name="platform" options={Object.entries(PLATFORM_AR).filter(([k]) => k !== "ai")} /></Field>
            <Field label="رابط المصدر" hint="مطلوب للإشارات المقاسة" className="sm:col-span-2"><Input name="sourceUrl" type="url" dir="ltr" placeholder="https://" /></Field>
            <Field label="نوع الدليل *"><Select name="evidenceType" options={[["measured", "مقاس (أرقام من المنصة)"], ["owner_reported", "ملاحظة المالك"], ["ai_hypothesis", "فرضية (بدون أرقام)"]]} /></Field>
            <Field label="طريقة الجمع"><Select name="method" options={[["manual_entry", "إدخال يدوي"], ["owner_screenshot", "من لقطة شاشة"]]} /></Field>
            <Field label="النطاق"><Select name="region" options={[["EG", "مصر"], ["GLOBAL", "عالمي"], ["SA", "السعودية"], ["AE", "الإمارات"], ["US", "أمريكا"]]} /></Field>
            <Field label="نوع المؤشر"><Input name="metricType" placeholder="views / likes / search_interest / ad_count" dir="ltr" /></Field>
            <Field label="القيمة الحالية"><Input name="metricValue" inputMode="decimal" /></Field>
            <Field label="القيمة السابقة" hint="لحساب النمو المقاس"><Input name="previousValue" inputMode="decimal" /></Field>
            <Field label="تاريخ الاكتشاف"><Input name="discoveredAt" type="datetime-local" /></Field>
            <Field label="رابط صورة/معاينة"><Input name="imageUrl" type="url" dir="ltr" /></Field>
            <Field label="ملاحظات" className="sm:col-span-2"><Textarea name="notes" /></Field>
            <div className="sm:col-span-2"><Button type="submit">تسجيل الإشارة</Button></div>
          </form>
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="استيراد CSV (Google Trends / TikTok Creative Center / ملف بحث)">
            <form action={importCsvAction} className="flex flex-col gap-3">
              <Input type="file" name="file" accept=".csv,text/csv" required className="py-1.5" />
              <p className="text-xs text-muted" dir="ltr">title, platform, evidence_type, url, region, metric_type, metric_value, previous_value, discovered_at, notes, image_url, title_en</p>
              <div><Button type="submit" variant="secondary">استيراد</Button></div>
            </form>
          </Card>
          <Card title="مصادر الترند وحالة الوصول">
            <ul className="space-y-2 text-sm">
              {sources.map((s) => (
                <li key={s.code} className="flex items-start justify-between gap-3">
                  <div><div>{s.name}</div><div className="text-xs text-muted">{s.notes}</div></div>
                  <Badge tone={s.access_status === "enabled" ? "good" : s.access_status === "not_available" ? "neutral" : "warn"}>
                    {s.access_status === "enabled" ? "✓ يعمل" : s.access_status === "not_available" ? "لا يوجد API مصرح — يدوي" : "بانتظار الاعتماد"}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function StatusBtn({ id, status, label }: { id: number; status: string; label: string }) {
  return (
    <form action={signalStatusAction}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={status} />
      <Button size="sm" variant="secondary">{label}</Button>
    </form>
  );
}

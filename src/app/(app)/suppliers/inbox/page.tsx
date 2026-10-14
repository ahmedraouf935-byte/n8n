import Link from "next/link";
import { Badge, Button, Card, ExternalLink, Notice, PageHeader, Select } from "@/components/ui";
import { getSql } from "@/lib/db/client";
import { formatEGP } from "@/lib/domain/money";
import { formatDateTime } from "@/lib/domain/time";
import { matchCandidatesForOffer } from "@/lib/services/suppliers";
import { MARKET_AR } from "@/lib/ui/labels";
import { linkOfferAction, rejectOfferAction } from "../actions";

export default async function InboxPage() {
  const sql = getSql();
  const offers = await sql<{ id: number; title_raw: string; quoted_price: number | null; price_uncertain: boolean; min_order_qty: number; evidence_note: string | null;
    source_url: string | null; quoted_at: Date; match_status: string; variant_id: number | null; supplier_name: string; market_area: string; collection: string | null }[]>`
    SELECT o.id, o.title_raw, o.quoted_price, o.price_uncertain, o.min_order_qty, o.evidence_note, o.source_url, o.quoted_at, o.match_status, o.variant_id,
      s.name AS supplier_name, s.market_area, ds.code AS collection
    FROM supplier_offers o JOIN suppliers s ON s.id = o.supplier_id LEFT JOIN data_sources ds ON ds.id = o.source_id
    WHERE o.match_status IN ('unmatched','probable') AND o.status <> 'rejected' ORDER BY o.quoted_at DESC LIMIT 50`;
  const withCandidates = await Promise.all(offers.map(async (o) => ({ o, c: await matchCandidatesForOffer(sql, o.id, 5) })));
  return (
    <>
      <PageHeader title="صندوق مطابقة عروض الموردين" subtitle="منشورات تيليجرام والعروض غير المربوطة. المطابقة الآلية «مبدئية» فقط — لا تُعتبر نفس المنتج حتى تؤكدها." />
      <div className="mb-4"><Notice>المنشورات تصل من قنوات/مجموعات مسجلة على موردين فقط (Telegram chat ID). الصور لا تُنسخ — يُحفظ رابط المنشور كدليل.</Notice></div>
      <div className="grid gap-3">
        {withCandidates.length === 0 && <Card><p className="text-center text-sm text-muted">لا توجد عروض بانتظار المطابقة.</p></Card>}
        {withCandidates.map(({ o, c }) => (
          <Card key={o.id}>
            <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
                  <b>{o.supplier_name}</b><span className="text-muted">{MARKET_AR[o.market_area]}</span>
                  <Badge tone="info">{o.collection === "telegram_suppliers" ? "تيليجرام" : "يدوي"}</Badge>
                  <span className="text-xs text-muted">{formatDateTime(o.quoted_at)}</span>
                  <ExternalLink href={o.source_url}>المنشور</ExternalLink>
                </div>
                <p className="whitespace-pre-line rounded-lg bg-surface-2 p-3 text-sm">{o.title_raw}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-sm">
                  <span>السعر المستخرج: <b className="num">{formatEGP(o.quoted_price)}</b></span>
                  {o.price_uncertain && <Badge tone="warn">سعر غير مؤكد</Badge>}
                  <span>أقل كمية: <b className="num">{o.min_order_qty}</b></span>
                </div>
                {o.evidence_note && <div className="mt-1 text-xs text-warn">⚠ {o.evidence_note}</div>}
              </div>
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-text-2">منتجات مرشحة للمطابقة</div>
                {c.length === 0 && <p className="text-xs text-muted">لا يوجد منتج مشابه. <Link className="text-info underline" href={`/products/new?name=${encodeURIComponent(o.title_raw.split("\n")[0].slice(0, 80))}`}>أنشئ منتجًا جديدًا</Link></p>}
                {c.map(({ variant, match }) => (
                  <div key={variant.id} className="rounded-lg border border-border p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/products/${variant.id}`} className="font-medium hover:underline">{variant.name_ar} — {variant.label}</Link>
                      <Badge tone={match.decision === "conflict" ? "bad" : match.decision === "probable" ? "good" : "warn"}>{Math.round(match.similarity * 100)}٪</Badge>
                    </div>
                    {match.conflicts.length > 0 ? <div className="mt-1 text-bad">{match.conflicts.join("، ")}</div> : <div className="mt-1 text-muted">{match.reasons[0]}</div>}
                  </div>
                ))}
                {c.filter((x) => x.match.decision !== "conflict").length > 0 && (
                  <form action={linkOfferAction} className="flex gap-1">
                    <input type="hidden" name="offerId" value={o.id} /><input type="hidden" name="status" value="probable" />
                    <Select name="variantId" defaultValue={String(o.variant_id ?? "")} className="h-8 text-xs" options={c.filter((x) => x.match.decision !== "conflict").map((x) => [String(x.variant.id), `${x.variant.name_ar} — ${x.variant.label}`])} />
                    <Button size="sm">ربط</Button>
                  </form>
                )}
                <div className="flex gap-1">
                  <form action={linkOfferAction}><input type="hidden" name="offerId" value={o.id} /><input type="hidden" name="status" value="mismatch" /><Button size="sm" variant="ghost">لا يطابق شيئًا</Button></form>
                  <form action={rejectOfferAction}><input type="hidden" name="offerId" value={o.id} /><Button size="sm" variant="ghost">تجاهل</Button></form>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

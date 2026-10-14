import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, ExternalLink, Field, Input, LinkButton, Notice, PageHeader, Select, Table, Textarea, TrustBadge } from "@/components/ui";
import { getSql } from "@/lib/db/client";
import { formatEGP, formatNumber, formatPct } from "@/lib/domain/money";
import { formatDate, formatDateTime } from "@/lib/domain/time";
import { analyzeVariant } from "@/lib/services/analysis";
import { getVariantFull } from "@/lib/services/catalog";
import { getSettings } from "@/lib/services/settings";
import { BAND_AR, CONF_AR, EVIDENCE_AR, MARKET_AR, PLATFORM_AR, PRODUCT_STATUS_AR, RISK_AR } from "@/lib/ui/labels";
import {
  addRetailOfferAction, addSupplierOfferAction, addVariantAction, offerMatchAction, oppInputsAction, productStatusAction, refreshAction,
  requestPurchaseAction, retailMatchAction, verifyOfferAction, verifyVariantAction,
} from "../actions";

const RETAILERS: [string, string][] = [["amazon_eg", "أمازون مصر"], ["noon", "نون"], ["jumia", "جوميا"], ["facebook_page", "صفحة فيسبوك"], ["instagram_shop", "متجر إنستجرام"], ["website", "موقع إلكتروني"], ["other", "أخرى"]];
const MATCH_AR: Record<string, string> = { exact: "مطابق تمامًا", probable: "مطابق غالبًا", mismatch: "مختلف", unreviewed: "لم يراجع", confirmed: "مطابق (مؤكد)", unmatched: "غير مربوط" };

export default async function ResearchPage({ params }: { params: Promise<{ variantId: string }> }) {
  const variantId = Number((await params).variantId);
  if (!Number.isInteger(variantId)) notFound();
  const sql = getSql();
  const v = await getVariantFull(sql, variantId);
  if (!v) notFound();
  const [a, settings] = await Promise.all([analyzeVariant(sql, variantId), getSettings(sql)]);
  if (!a) notFound();
  const siblings = await sql<{ id: number; label: string; sku: string }[]>`SELECT id, label, sku FROM product_variants WHERE product_id = ${v.product_id} ORDER BY id`;
  const suppliers = await sql<{ id: number; name: string; market_area: string }[]>`SELECT id, name, market_area FROM suppliers WHERE is_active ORDER BY name`;
  const [opp] = await sql<{ owner_price: number | null; test_quantity: number | null; economics_overrides: Record<string, number>; status: string }[]>`
    SELECT owner_price, test_quantity, economics_overrides, status FROM opportunities WHERE variant_id = ${variantId}`;
  const decisions = await sql<{ id: number; status: string; quantity: number; planned_total_cost: number; planned_sell_price: number; reason: string | null; created_at: Date; decided_at: Date | null; gate_results: { passed: boolean; severity: string }[] }[]>`
    SELECT id, status, quantity, planned_total_cost, planned_sell_price, reason, created_at, decided_at, gate_results FROM purchase_decisions WHERE variant_id = ${variantId} ORDER BY id DESC`;
  const history = await sql<{ action: string; actor_label: string; created_at: Date }[]>`
    SELECT action, actor_label, created_at FROM audit_logs WHERE (entity_type = 'product_variants' AND entity_id = ${variantId}) OR (entity_type = 'products' AND entity_id = ${v.product_id})
    ORDER BY id DESC LIMIT 15`;
  const snapshots = await sql<{ kind: string; value: number; computed_at: Date }[]>`
    SELECT kind, value, computed_at FROM price_snapshots WHERE variant_id = ${variantId} ORDER BY computed_at DESC LIMIT 15`;
  const { retail, economics: e, score, pricing } = a;
  const ov = opp?.economics_overrides ?? {};
  const d = settings.unit_economics_defaults;
  const usableIds = new Set(retail.usable.map((u) => u.id));
  const excluded = new Map(retail.excluded.map((x) => [x.id, x.excludedReason]));
  const [retailRows] = [await sql<{ id: number; retailer: string; seller_name: string | null; url: string; title_raw: string | null; listed_price: number; original_price: number | null;
    shipping_cost: number | null; price_type: string; availability: string; match_status: string; observed_at: Date; collection_method: string }[]>`
    SELECT id, retailer, seller_name, url, title_raw, listed_price, original_price, shipping_cost, price_type, availability, match_status, observed_at, collection_method
    FROM retail_offers WHERE variant_id = ${variantId} ORDER BY observed_at DESC`];
  const sensitive = settings.risk.require_compliance_ack_for.includes(v.risk_category);

  return (
    <>
      <PageHeader
        title={v.name_ar}
        subtitle={<>{v.name_en && <><span dir="ltr">{v.name_en}</span> · </>}<span dir="ltr">{v.sku}</span> · {v.label} · <Badge>{PRODUCT_STATUS_AR[v.product_status]}</Badge> {v.risk_category !== "general" && <Badge tone="warn">⚠ {RISK_AR[v.risk_category]}</Badge>}</>}
        actions={
          <>
            <form action={refreshAction}><input type="hidden" name="variantId" value={variantId} /><Button variant="secondary">↻ إعادة الحساب</Button></form>
            <LinkButton href={`/marketing?variant=${variantId}`}>المحتوى</LinkButton>
          </>
        }
      />

      {/* --- AI recommendation & score --- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="التوصية ولماذا" className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-4">
            <div className="text-center">
              <div className="num text-4xl font-bold">{score.total}</div>
              <div className="text-xs text-muted">من 100</div>
            </div>
            <div className="flex flex-col gap-1">
              <Badge tone={score.band === "high_priority" ? "good" : score.band === "manual_review" ? "warn" : "bad"}>{BAND_AR[score.band]}</Badge>
              <span className="text-sm">ثقة البيانات: <b>{CONF_AR[score.confidence]}</b></span>
            </div>
            <p className="max-w-md text-xs text-muted">الدرجة معيار داخلي مرجّح بأوزان قابلة للتعديل (الإعدادات)، وليست تنبؤًا مؤكدًا بالطلب أو المبيعات. القرار النهائي للمالك وتحكمه بوابات الأمان.</p>
          </div>
          {(score.bandReasons.length > 0 || score.confidenceReasons.length > 0) && (
            <ul className="mt-3 list-disc space-y-1 pr-5 text-sm text-text-2">
              {score.bandReasons.map((r) => <li key={r}>{r}</li>)}
              {score.confidenceReasons.map((r) => <li key={r}>ثقة: {r}</li>)}
            </ul>
          )}
          <div className="mt-4 space-y-3">
            {score.lines.map((l) => (
              <div key={l.key}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{l.label} <span className="text-xs text-muted">(وزن {l.weight})</span></span>
                  <span className="num font-semibold">{l.score}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${l.score}%` }} /></div>
                <ul className="mt-1 text-xs text-text-2">{l.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>
              </div>
            ))}
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="المخاطر المحددة">
            {a.risks.length ? <ul className="space-y-1.5 text-sm">{a.risks.map((r) => <li key={r} className="flex gap-2"><span className="text-warn">⚠</span>{r}</li>)}</ul> : <p className="text-sm text-muted">لا توجد مخاطر ظاهرة.</p>}
          </Card>
          <Card title="المواصفات">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              {([["السعة", v.capacity], ["الأبعاد", v.dimensions], ["الخامة", v.material], ["اللون", v.color], ["الماركة", v.brand], ["الموديل", v.model_number], ["المقاس", v.size_label], ["الجودة", v.quality_grade], ["الوزن", v.weight_grams ? `${v.weight_grams} جم` : null]] as const)
                .filter(([, val]) => val).map(([k, val]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd>{val}</dd></div>)}
            </dl>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
              {v.verified ? <TrustBadge label="verified" title="المالك أكد المقاس/الموديل" /> : <TrustBadge label="unverified" title="لم يتم تأكيد المقاس/الموديل" />}
              <form action={verifyVariantAction}>
                <input type="hidden" name="variantId" value={variantId} /><input type="hidden" name="verified" value={String(!v.verified)} />
                <Button size="sm" variant="secondary">{v.verified ? "إلغاء التأكيد" : "تأكيد المقاس والمواصفات"}</Button>
              </form>
            </div>
            {siblings.length > 1 && (
              <div className="mt-3 border-t border-border pt-3 text-xs">متغيرات أخرى: {siblings.filter((s) => s.id !== variantId).map((s) => <Link key={s.id} href={`/products/${s.id}`} className="ms-2 text-info hover:underline">{s.label}</Link>)}</div>
            )}
            <details className="mt-3 border-t border-border pt-3 text-sm">
              <summary className="text-info">+ إضافة مقاس/موديل آخر لنفس المنتج</summary>
              <form action={addVariantAction} className="mt-2 grid gap-2">
                <input type="hidden" name="productId" value={v.product_id} /><input type="hidden" name="variantId" value={variantId} />
                <Input name="label" required placeholder="وصف المتغير" />
                <div className="grid grid-cols-2 gap-2"><Input name="capacity" placeholder="السعة" /><Input name="dimensions" placeholder="الأبعاد" /><Input name="color" placeholder="اللون" /><Input name="material" placeholder="الخامة" /><Input name="modelNumber" placeholder="الموديل" dir="ltr" /><Input name="weightGrams" placeholder="الوزن جم" /></div>
                <Button size="sm">إضافة</Button>
              </form>
            </details>
          </Card>
          <Card title="الحالة">
            <form action={productStatusAction} className="flex gap-2">
              <input type="hidden" name="variantId" value={variantId} /><input type="hidden" name="productId" value={v.product_id} />
              <Select name="status" defaultValue={v.product_status} options={Object.entries(PRODUCT_STATUS_AR)} />
              <Button size="sm" variant="secondary">حفظ</Button>
            </form>
          </Card>
        </div>
      </div>

      {/* --- Trend evidence --- */}
      <Card title={`دليل الطلب (${a.trends.length})`} className="mt-4" padded={false}>
        <Table head={["الإشارة", "المنصة", "النطاق", "النمو المقاس", "نوع الدليل", "التاريخ", "المصدر"]} empty={<>لا توجد إشارات مرتبطة. اربط إشارة من <Link href="/trends" className="underline">رادار الترند</Link>.</>}>
          {a.trends.map((t) => (
            <tr key={t.id}>
              <td>{t.title}</td><td>{PLATFORM_AR[t.platform] ?? t.platform}</td><td>{t.region}</td>
              <td className="num">{t.measuredGrowthPct != null ? formatPct(t.measuredGrowthPct) : "—"}</td>
              <td><Badge tone={t.evidenceType === "measured" ? "good" : t.evidenceType === "owner_reported" ? "info" : "warn"}>{EVIDENCE_AR[t.evidenceType]}</Badge></td>
              <td className="text-xs">{formatDateTime(t.discoveredAt)}</td><td><ExternalLink href={t.sourceUrl} /></td>
            </tr>
          ))}
        </Table>
      </Card>

      {/* --- Retail prices --- */}
      <div id="retail" className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="أسعار التجزئة في مصر لنفس المقاس" className="lg:col-span-2" padded={false}>
          <div className="grid grid-cols-2 gap-3 border-b border-border p-4 sm:grid-cols-5">
            <Mini label="عروض صالحة" value={formatNumber(retail.sampleSize)} />
            <Mini label="أقل سعر" value={formatEGP(retail.min)} />
            <Mini label="الوسيط" value={formatEGP(retail.median)} />
            <Mini label="أعلى سعر" value={formatEGP(retail.max)} />
            <Mini label="بائعون مختلفون" value={formatNumber(retail.distinctSellers)} />
          </div>
          <p className="px-4 pt-3 text-xs text-muted">السعر المعروض ≠ سعر بيع فعلي. الأسعار تشمل الشحن عند توفره. العروض غير المراجعة أو المختلفة أو القديمة أو الشاذة مستبعدة من الحساب.</p>
          <Table head={["المتجر/البائع", "السعر", "الشحن", "النوع", "التطابق", "التوقيت", "في الحساب؟", ""]} empty="لم تُسجل أسعار تجزئة بعد.">
            {retailRows.map((r) => (
              <tr key={r.id}>
                <td><div>{RETAILERS.find(([k]) => k === r.retailer)?.[1] ?? r.retailer}{r.seller_name && ` — ${r.seller_name}`}</div><div className="text-xs"><ExternalLink href={r.url} /></div>{r.title_raw && <div className="max-w-64 truncate text-xs text-muted" title={r.title_raw}>{r.title_raw}</div>}</td>
                <td className="num">{formatEGP(r.listed_price)}{r.original_price && <div className="text-xs text-muted line-through">{formatEGP(r.original_price)}</div>}</td>
                <td className="num">{r.shipping_cost == null ? "؟" : formatEGP(r.shipping_cost)}</td>
                <td className="text-xs">{r.price_type === "listed" ? "معروض" : r.price_type === "promotional" ? "عرض ترويجي" : r.price_type === "historical" ? "تاريخي" : "سعر بيع فعلي"}</td>
                <td><Badge tone={r.match_status === "exact" ? "good" : r.match_status === "mismatch" ? "bad" : "warn"}>{MATCH_AR[r.match_status]}</Badge></td>
                <td className="text-xs">{formatDateTime(r.observed_at)}<div className="text-muted">{r.collection_method}</div></td>
                <td className="text-xs">{usableIds.has(r.id) ? <TrustBadge label="verified" title="داخل في الحساب" /> : <span className="text-muted">{excluded.get(r.id) ?? "—"}</span>}</td>
                <td>
                  <div className="flex gap-1">
                    {r.match_status !== "exact" && <MatchBtn action={retailMatchAction} variantId={variantId} id={r.id} status="exact" label="مطابق" />}
                    {r.match_status !== "mismatch" && <MatchBtn action={retailMatchAction} variantId={variantId} id={r.id} status="mismatch" label="مختلف" />}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="إضافة سعر تجزئة">
          <form action={addRetailOfferAction} className="grid gap-2.5">
            <input type="hidden" name="variantId" value={variantId} />
            <Field label="المتجر"><Select name="retailer" options={RETAILERS} /></Field>
            <Field label="رابط المنتج *"><Input name="url" type="url" required dir="ltr" /></Field>
            <Field label="عنوان المنتج كما هو في المتجر" hint="يُستخدم لاكتشاف اختلاف المقاس/السعة تلقائيًا"><Input name="titleRaw" /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="السعر ج.م *"><Input name="listedPrice" required inputMode="decimal" /></Field>
              <Field label="قبل الخصم"><Input name="originalPrice" inputMode="decimal" /></Field>
              <Field label="الشحن"><Input name="shippingCost" inputMode="decimal" /></Field>
              <Field label="نوع السعر"><Select name="priceType" options={[["listed", "معروض"], ["promotional", "ترويجي"], ["historical", "تاريخي"], ["observed_transaction", "سعر بيع فعلي معروف"]]} /></Field>
            </div>
            <Field label="البائع"><Input name="sellerName" /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="التوفر"><Select name="availability" options={[["unknown", "غير معروف"], ["in_stock", "متوفر"], ["out_of_stock", "غير متوفر"]]} /></Field>
              <Field label="وقت الرصد"><Input name="observedAt" type="datetime-local" /></Field>
            </div>
            <Button type="submit">حفظ العرض</Button>
          </form>
          {snapshots.length > 0 && (
            <details className="mt-4 border-t border-border pt-3 text-xs"><summary className="text-info">سجل لقطات الأسعار</summary>
              <ul className="mt-2 space-y-1">{snapshots.map((s, i) => <li key={i} className="flex justify-between"><span>{s.kind}</span><span className="num">{formatEGP(s.value)} · {formatDate(s.computed_at)}</span></li>)}</ul>
            </details>
          )}
        </Card>
      </div>

      {/* --- Suppliers --- */}
      <div id="suppliers" className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="عروض الجملة (الموسكي / العتبة / غيرها)" className="lg:col-span-2" padded={false}>
          <Table head={["المورد", "السعر", "أقل كمية", "الحالة", "التطابق", "التأكيد", "إجراءات"]} empty={<>لا توجد عروض جملة مرتبطة. أضف عرضًا أو اربط منشورات تيليجرام من <Link href="/suppliers/inbox" className="underline">صندوق الموردين</Link>.</>}>
            {a.supplierOffers.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/suppliers/${o.supplierId}`} className="font-medium hover:underline">{o.supplierName}</Link>
                  <div className="text-xs text-muted">{MARKET_AR[o.marketArea]}{o.reliability != null && ` · موثوقية ${o.reliability}/5`}</div>
                  <div className="max-w-64 whitespace-pre-line text-xs text-text-2">{o.title.slice(0, 140)}</div>
                  {o.evidenceNote && <div className="text-xs text-warn">{o.evidenceNote}</div>}
                  <div className="text-xs"><ExternalLink href={o.sourceUrl}>المصدر</ExternalLink> · {formatDateTime(o.quotedAt)}</div>
                </td>
                <td className="num">{formatEGP(o.effectivePrice)}{o.priceUncertain && <div><Badge tone="warn">سعر غير مؤكد</Badge></div>}</td>
                <td className="num">{o.minOrderQty}</td>
                <td><TrustBadge label={o.status} /></td>
                <td><Badge tone={o.matchStatus === "confirmed" ? "good" : o.matchStatus === "mismatch" ? "bad" : "warn"}>{MATCH_AR[o.matchStatus]}</Badge></td>
                <td className="text-xs">{o.verification ? <>{o.verification.result} عبر {o.verification.method}<div className="text-muted">{formatDateTime(o.verification.verified_at)}<br />صالح حتى {formatDateTime(o.verification.valid_until)}</div>{o.verification.confirmed_quantity != null && <div>كمية: {o.verification.confirmed_quantity}</div>}</> : <span className="text-muted">لا يوجد</span>}</td>
                <td className="min-w-56">
                  <div className="flex flex-wrap gap-1">
                    {o.matchStatus !== "confirmed" && <MatchBtn action={offerMatchAction} variantId={variantId} id={o.id} status="confirmed" label="تأكيد التطابق" />}
                    {o.matchStatus !== "mismatch" && <MatchBtn action={offerMatchAction} variantId={variantId} id={o.id} status="mismatch" label="ليس نفس المنتج" />}
                  </div>
                  <details className="mt-1">
                    <summary className="text-xs text-info">📞 سجّل تأكيد المورد</summary>
                    <form action={verifyOfferAction} className="mt-2 grid gap-1.5">
                      <input type="hidden" name="variantId" value={variantId} /><input type="hidden" name="offerId" value={o.id} />
                      {(o.phone || o.whatsapp) && <div className="text-xs" dir="ltr">{o.phone ?? o.whatsapp}</div>}
                      <Select name="method" className="h-8 text-xs" options={[["whatsapp", "واتساب"], ["phone", "مكالمة"], ["in_person", "زيارة"], ["telegram", "تيليجرام"], ["other", "أخرى"]]} />
                      <Select name="result" className="h-8 text-xs" options={[["available", "متوفر"], ["partial", "متوفر جزئيًا"], ["price_changed", "متوفر بسعر مختلف"], ["unavailable", "غير متوفر"]]} />
                      <Input name="confirmedPrice" className="h-8 text-xs" placeholder="السعر المؤكد للقطعة" inputMode="decimal" />
                      <Input name="confirmedQuantity" className="h-8 text-xs" placeholder="الكمية المتاحة" inputMode="numeric" />
                      <Input name="confirmedMoq" className="h-8 text-xs" placeholder="أقل كمية للطلب" inputMode="numeric" />
                      <Input name="validDays" className="h-8 text-xs" placeholder={`صلاحية التأكيد بالأيام (${settings.freshness.verification_valid_days})`} inputMode="numeric" />
                      <Textarea name="notes" className="text-xs" placeholder="ملاحظات (جودة، استرجاع، استلام)" />
                      <Button size="sm">حفظ التأكيد</Button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="إضافة عرض جملة">
          {suppliers.length === 0 ? <p className="text-sm text-muted">أضف موردًا أولًا من <Link className="underline" href="/suppliers">دليل الموردين</Link>.</p> : (
            <form action={addSupplierOfferAction} className="grid gap-2.5">
              <input type="hidden" name="variantId" value={variantId} />
              <Field label="المورد"><Select name="supplierId" options={suppliers.map((s) => [String(s.id), `${s.name} — ${MARKET_AR[s.market_area]}`])} /></Field>
              <Field label="وصف المنتج كما قاله المورد *"><Textarea name="titleRaw" required /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="السعر للقطعة"><Input name="quotedPrice" inputMode="decimal" /></Field>
                <Field label="أقل كمية"><Input name="minOrderQty" inputMode="numeric" defaultValue="1" /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><Input type="checkbox" name="priceUncertain" /> السعر غير مؤكد (دستة/كرتونة/تفاوض)</label>
              <Field label="رابط المصدر"><Input name="sourceUrl" type="url" dir="ltr" /></Field>
              <Field label="الدليل/ملاحظة"><Input name="evidenceNote" placeholder="من رسالة واتساب بتاريخ…" /></Field>
              <Button type="submit">حفظ العرض</Button>
            </form>
          )}
        </Card>
      </div>

      {/* --- Pricing & economics --- */}
      <div id="economics" className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="التسعير وحساب الربحية" className="lg:col-span-2">
          {!a.bestOffer ? <Notice tone="warn">لا يمكن حساب الربحية بدون عرض جملة بسعر معروف.</Notice> : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Mini label="سعر الجملة المستخدم" value={formatEGP(a.bestOffer.effectivePrice)} trust={a.bestOffer.status} />
                <Mini label="السعر المقترح" value={formatEGP(pricing?.recommendedPrice)} trust="estimated" />
                <Mini label="الحد الأدنى لهامش آمن" value={formatEGP(pricing?.floorPrice)} />
                <Mini label={`سعر البيع المستخدم (${a.sellingPriceSource === "owner" ? "من المالك" : a.sellingPriceSource === "recommendation" ? "مقترح" : "—"})`} value={formatEGP(a.sellingPrice)} />
              </div>
              {pricing && <ul className="mt-3 space-y-1 text-xs text-text-2">{pricing.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>}
              {e ? (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Mini label="مساهمة لكل قطعة مُسلّمة" value={<span className={e.contributionPerDeliveredUnit <= 0 ? "text-bad" : ""}>{formatEGP(e.contributionPerDeliveredUnit)}</span>} trust="estimated" />
                    <Mini label="هامش المساهمة" value={formatPct(e.contributionMarginPct)} trust="estimated" />
                    <Mini label="أقصى تكلفة إعلان/طلب" value={formatEGP(e.maxAffordableCac)} />
                    <Mini label="نقد مطلوب للمخزون" value={formatEGP(e.inventoryCashRequired)} />
                    <Mini label="كمية الشراء" value={formatNumber(e.purchaseQty)} />
                    <Mini label="تكلفة القطعة الواصلة" value={formatEGP(e.landedUnitCost)} />
                    <Mini label="نقطة التعادل (طلبات مشحونة)" value={e.breakEvenShippedOrders === null ? "غير ممكن" : formatNumber(e.breakEvenShippedOrders)} />
                    <Mini label="أقصى طلبات تكفيها الدفعة" value={formatNumber(e.maxShippableOrders)} />
                  </div>
                  {e.warnings.length > 0 && <div className="mt-3"><Notice tone="warn">{e.warnings.map((w) => <div key={w}>⚠ {w}</div>)}</Notice></div>}
                  <h3 className="mt-5 mb-2 text-sm font-semibold">تفصيل متوسط الطلب المشحون الواحد</h3>
                  <div className="grid gap-x-8 text-sm sm:grid-cols-2">
                    {([
                      ["إيراد المنتج (عند التسليم)", e.perShippedOrder.productRevenue, 1], ["رسوم شحن محصلة من العميل", e.perShippedOrder.shippingFeeIncome, 1],
                      ["مبالغ مستردة (مرتجعات)", e.perShippedOrder.refunds, -1], ["عمولة التحصيل", e.perShippedOrder.collectionFees, -1],
                      ["تكلفة شركة الشحن", e.perShippedOrder.carrierCost, -1], ["تكلفة فشل التسليم", e.perShippedOrder.failedDeliveryCost, -1],
                      ["تكلفة المرتجعات", e.perShippedOrder.returnCost, -1], ["التغليف", e.perShippedOrder.packaging, -1],
                      ["الإعلانات", e.perShippedOrder.advertising, -1], ["تكلفة البضاعة المستهلكة", e.perShippedOrder.productCost, -1],
                      ["تكاليف أخرى", e.perShippedOrder.otherCost, -1], ["ضرائب", e.perShippedOrder.tax, -1],
                    ] as const).map(([k, val, sign]) => (
                      <div key={k} className="flex justify-between border-b border-border/60 py-1"><span className="text-text-2">{k}</span><span className={`num ${sign < 0 ? "text-bad" : ""}`}>{sign < 0 && val ? "−" : ""}{formatEGP(val)}</span></div>
                    ))}
                    <div className="flex justify-between py-1.5 font-semibold sm:col-span-2"><span>المساهمة لكل طلب مشحون</span><span className="num">{formatEGP(e.perShippedOrder.contribution)}</span></div>
                  </div>
                  <p className="mt-1 text-xs text-muted">احتمالات: تسليم {formatPct(e.probabilities.deliver * 100)} · إرجاع بعد التسليم {formatPct(e.probabilities.customerReturn * 100)} · احتفاظ العميل {formatPct(e.probabilities.keep * 100)}. هذه «مساهمة» قبل التكاليف الثابتة وليست صافي ربح.</p>

                  <h3 className="mt-5 mb-2 text-sm font-semibold">السيناريوهات (الدفعة كاملة)</h3>
                  <Table head={["السيناريو", "نسبة تصريف الدفعة", "طلبات مشحونة", "قطع مُسلّمة", "نقد مسترد صافي", "النتيجة بعد تكلفة المخزون", "مخزون متبقٍ (بالتكلفة)"]}>
                    {a.scenarios.map((s) => (
                      <tr key={s.name}>
                        <td className="font-medium">{s.label}</td><td className="num">{formatPct(s.sellThrough * 100)}</td><td className="num">{s.shippedOrders}</td><td className="num">{s.deliveredUnits}</td>
                        <td className="num">{formatEGP(s.cashCollectedNet)}</td>
                        <td className={`num font-semibold ${s.batchResult < 0 ? "text-bad" : "text-good"}`}>{formatEGP(s.batchResult)}</td>
                        <td className="num">{s.unsoldUnits} ({formatEGP(s.unsoldValueAtCost)})</td>
                      </tr>
                    ))}
                  </Table>
                  <details className="mt-3 text-xs"><summary className="text-info">كل الافتراضات المستخدمة</summary>
                    <ul className="mt-2 grid gap-1 sm:grid-cols-2">{e.assumptions.map((x) => <li key={x.key} className="flex justify-between gap-2 border-b border-border/50 py-0.5"><span className="text-text-2">{x.label}</span><span className="num">{String(x.value)}</span></li>)}</ul>
                  </details>
                </>
              ) : <div className="mt-3"><Notice tone="warn">حدد سعر بيع (من المالك) أو أضف أسعار تجزئة مطابقة لحساب الربحية.</Notice></div>}
            </>
          )}
        </Card>
        <Card title="تعديل الافتراضات لهذا المنتج">
          <form action={oppInputsAction} className="grid gap-2.5">
            <input type="hidden" name="variantId" value={variantId} />
            <Field label="سعر البيع (يدوي)" hint="اتركه فارغًا لاستخدام السعر المقترح"><Input name="ownerPrice" defaultValue={opp?.owner_price ?? ""} inputMode="decimal" /></Field>
            <Field label="كمية الاختبار"><Input name="testQuantity" defaultValue={opp?.test_quantity ?? ""} inputMode="numeric" placeholder={String(a.testQuantity ?? "")} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="إعلان/طلب"><Input name="adCostPerOrder" defaultValue={ov.adCostPerOrder ?? ""} placeholder={String(d.ad_cost_per_order)} /></Field>
              <Field label="تكلفة الشحن"><Input name="carrierCostPerOrder" defaultValue={ov.carrierCostPerOrder ?? ""} placeholder={String(d.carrier_cost_per_order)} /></Field>
              <Field label="شحن على العميل"><Input name="shippingFeeCharged" defaultValue={ov.shippingFeeCharged ?? ""} placeholder={String(d.shipping_fee_charged)} /></Field>
              <Field label="تغليف/طلب"><Input name="packagingPerOrder" defaultValue={ov.packagingPerOrder ?? ""} placeholder={String(d.packaging_per_order)} /></Field>
              <Field label="فشل التسليم ٪"><Input name="failedDeliveryRate" defaultValue={ov.failedDeliveryRate != null ? ov.failedDeliveryRate * 100 : ""} placeholder={String(d.failed_delivery_rate * 100)} /></Field>
              <Field label="الإرجاع ٪"><Input name="returnRate" defaultValue={ov.returnRate != null ? ov.returnRate * 100 : ""} placeholder={String(d.return_rate * 100)} /></Field>
              <Field label="مواصلات الاستلام"><Input name="pickupCostTotal" defaultValue={ov.pickupCostTotal ?? ""} placeholder={String(d.pickup_cost_total)} /></Field>
              <Field label="خصم/طلب"><Input name="discountPerOrder" defaultValue={ov.discountPerOrder ?? ""} placeholder={String(d.discount_per_order)} /></Field>
            </div>
            <Button type="submit" variant="secondary">تحديث الحساب</Button>
          </form>
        </Card>
      </div>

      {/* --- Purchase decision --- */}
      <div id="decision" className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="طلب شراء دفعة اختبار" className="lg:col-span-1">
          {!a.bestOffer ? <p className="text-sm text-muted">يتطلب عرض مورد.</p> : (
            <form action={requestPurchaseAction} className="grid gap-2.5">
              <input type="hidden" name="variantId" value={variantId} />
              <Field label="عرض المورد"><Select name="supplierOfferId" defaultValue={String(a.bestOffer.id)} options={a.supplierOffers.filter((o) => o.effectivePrice).map((o) => [String(o.id), `${o.supplierName} — ${o.effectivePrice} ج.م (${o.status})`])} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="الكمية"><Input name="quantity" required inputMode="numeric" defaultValue={a.testQuantity ?? ""} /></Field>
                <Field label="سعر البيع"><Input name="sellingPrice" required inputMode="decimal" defaultValue={a.sellingPrice ?? ""} /></Field>
              </div>
              <Field label="مواصلات الاستلام المتوقعة"><Input name="pickupCost" inputMode="decimal" placeholder={String(d.pickup_cost_total)} /></Field>
              {sensitive && <label className="flex items-start gap-2 rounded-lg bg-warn-soft p-2 text-xs text-warn"><Input type="checkbox" name="complianceAck" className="mt-0.5" /> أؤكد أنني تحققت من التراخيص/تاريخ الصلاحية/الضمان/الأصالة لهذه الفئة الحساسة.</label>}
              <Button type="submit">إرسال للموافقة</Button>
              <p className="text-xs text-muted">لن يتم أي شراء تلقائيًا. سيتم فحص بوابات الأمان (تأكيد المورد، تطابق المقاس، النقد، الميزانية، الربحية، جودة البيانات) ثم يحتاج الطلب موافقة المالك.</p>
            </form>
          )}
        </Card>
        <Card title="سجل القرارات" className="lg:col-span-2" padded={false}>
          <Table head={["#", "الحالة", "الكمية", "التكلفة", "سعر البيع", "البوابات", "التاريخ"]} empty="لا توجد قرارات بعد.">
            {decisions.map((x) => (
              <tr key={x.id}>
                <td className="num">{x.id}</td>
                <td><Badge tone={x.status === "approved" ? "good" : x.status === "rejected" ? "bad" : "warn"}>{x.status}</Badge>{x.reason && <div className="text-xs text-muted">{x.reason}</div>}</td>
                <td className="num">{x.quantity}</td><td className="num">{formatEGP(x.planned_total_cost)}</td><td className="num">{formatEGP(x.planned_sell_price)}</td>
                <td className="text-xs">{x.gate_results.filter((g) => g.severity === "block" && !g.passed).length === 0 ? "✓ ناجحة" : `✕ ${x.gate_results.filter((g) => g.severity === "block" && !g.passed).length} غير مستوفاة`}</td>
                <td className="text-xs">{formatDateTime(x.created_at)}</td>
              </tr>
            ))}
          </Table>
          {history.length > 0 && (
            <details className="border-t border-border p-4 text-xs"><summary className="text-info">سجل التغييرات</summary>
              <ul className="mt-2 space-y-1">{history.map((h, i) => <li key={i}>{formatDateTime(h.created_at)} — {h.action} — {h.actor_label}</li>)}</ul>
            </details>
          )}
        </Card>
      </div>
    </>
  );
}

function Mini({ label, value, trust }: { label: string; value: React.ReactNode; trust?: "verified" | "unverified" | "stale" | "unavailable" | "estimated" }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-1 text-xs text-text-2">{label}{trust && <TrustBadge label={trust} />}</div>
      <div className="num mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}

function MatchBtn({ action, variantId, id, status, label }: { action: (fd: FormData) => Promise<void>; variantId: number; id: number; status: string; label: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="variantId" value={variantId} /><input type="hidden" name="offerId" value={id} /><input type="hidden" name="status" value={status} />
      <Button size="sm" variant={status === "mismatch" ? "ghost" : "secondary"}>{label}</Button>
    </form>
  );
}

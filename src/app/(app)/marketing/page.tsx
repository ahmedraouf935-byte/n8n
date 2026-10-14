import Link from "next/link";
import { Badge, Button, Card, Field, Input, Notice, PageHeader, Select, Table, Textarea } from "@/components/ui";
import { getSql } from "@/lib/db/client";
import { formatEGP, formatNumber } from "@/lib/domain/money";
import { formatDateTime } from "@/lib/domain/time";
import { aiEnabled } from "@/lib/adapters/ai";
import { metaEnabled } from "@/lib/adapters/meta";
import { approvePostAction, assetStatusAction, campaignAction, cancelPostAction, generateAction, imageAction, scheduleAction } from "./actions";

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ variant?: string }> }) {
  const sp = await searchParams;
  const sql = getSql();
  const variants = await sql<{ id: number; name_ar: string; label: string; status: string; price: number | null; available: number | null }[]>`
    SELECT v.id, p.name_ar, v.label, p.status, COALESCE(o.owner_price, o.recommended_price) AS price, l.on_hand - l.reserved AS available
    FROM product_variants v JOIN products p ON p.id = v.product_id LEFT JOIN opportunities o ON o.variant_id = v.id LEFT JOIN inventory_levels l ON l.variant_id = v.id
    WHERE p.status IN ('testing','active','researching') ORDER BY p.name_ar`;
  const vid = sp.variant ? Number(sp.variant) : variants[0]?.id;
  const current = variants.find((v) => v.id === vid);
  const assets = vid ? await sql<{ id: number; asset_type: string; content: string | null; image_url: string | null; image_rights: string | null; status: string; generated_by: string; created_at: Date }[]>`
    SELECT * FROM marketing_assets WHERE variant_id = ${vid} AND status <> 'archived' ORDER BY id DESC` : [];
  const posts = await sql<{ id: number; platform: string; caption: string; scheduled_for: Date; status: string; error_message: string | null; external_post_id: string | null; name_ar: string; published_at: Date | null }[]>`
    SELECT sp.*, p.name_ar FROM scheduled_posts sp JOIN product_variants v ON v.id = sp.variant_id JOIN products p ON p.id = v.product_id ORDER BY sp.scheduled_for DESC LIMIT 50`;
  const campaigns = await sql<{ id: number; name: string; platform: string; campaign_type: string; spend: number; impressions: number | null; clicks: number | null; messages: number | null; orders: number; start_date: string }[]>`
    SELECT c.*, c.start_date::text, (SELECT count(*)::int FROM sales_orders so WHERE so.campaign_id = c.id AND so.status = 'delivered') AS orders FROM campaign_results c ORDER BY c.start_date DESC LIMIT 30`;
  const images = assets.filter((a) => a.asset_type === "image" && a.status === "approved");
  return (
    <>
      <PageHeader title="التسويق والمحتوى" subtitle="مسودات من المواصفات المؤكدة فقط. النشر يتطلب موافقة المالك، ولا يُعلن عن منتج غير متوفر كـ«متاح للتوصيل»." />
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <Notice tone={aiEnabled() ? "good" : "warn"}>{aiEnabled() ? "✓ Claude مُعد لتوليد النصوص" : "Claude غير مُعد (ANTHROPIC_API_KEY) — تُستخدم قوالب ثابتة"}</Notice>
        <Notice tone={metaEnabled("facebook") ? "good" : "warn"}>{metaEnabled("facebook") ? "✓ النشر على فيسبوك مُعد" : "النشر على فيسبوك/إنستجرام بانتظار بيانات الاعتماد — المنشورات المستحقة ستُسجل كـ«فشل» بوضوح"}</Notice>
      </div>
      <Card className="mb-4" padded={false}>
        <form className="flex flex-wrap items-end gap-3 p-4">
          <Field label="المنتج" className="min-w-72"><Select name="variant" defaultValue={String(vid ?? "")} options={variants.map((v) => [String(v.id), `${v.name_ar} — ${v.label} (متاح ${v.available ?? 0})`])} /></Field>
          <Button variant="secondary">عرض</Button>
        </form>
      </Card>
      {current && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title={`مسودات ${current.name_ar}`} className="lg:col-span-2">
            <form action={generateAction} className="mb-4 flex flex-wrap items-end gap-2">
              <input type="hidden" name="variantId" value={current.id} />
              <Field label="سعر البيع في المنشور"><Input name="price" defaultValue={current.price ?? ""} className="w-32" /></Field>
              <Button>توليد مسودات</Button>
            </form>
            <div className="space-y-3">
              {assets.filter((a) => a.asset_type !== "image").map((a) => (
                <div key={a.id} className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <Badge>{a.asset_type}</Badge><Badge tone={a.status === "approved" ? "good" : a.status === "rejected" ? "bad" : "warn"}>{a.status}</Badge>
                    <span className="text-muted">{a.generated_by === "ai" ? "ذكاء اصطناعي" : a.generated_by === "template" ? "قالب" : "المالك"} · {formatDateTime(a.created_at)}</span>
                  </div>
                  <form action={assetStatusAction} className="flex flex-col gap-2">
                    <input type="hidden" name="assetId" value={a.id} /><input type="hidden" name="variantId" value={current.id} />
                    <Textarea name="content" defaultValue={a.content ?? ""} rows={4} />
                    <div className="flex gap-2">
                      {a.status !== "approved" && <Button size="sm" name="status" value="approved">اعتماد (مع التعديلات)</Button>}
                      {a.status !== "rejected" && <Button size="sm" variant="ghost" name="status" value="rejected">رفض</Button>}
                    </div>
                  </form>
                  {a.status === "approved" && a.asset_type === "caption" && (
                    <form action={scheduleAction} className="mt-2 flex flex-wrap items-end gap-2 border-t border-border pt-2">
                      <input type="hidden" name="assetId" value={a.id} /><input type="hidden" name="variantId" value={current.id} />
                      <Field label="المنصة"><Select name="platform" options={[["facebook", "فيسبوك"], ["instagram", "إنستجرام"]]} /></Field>
                      <Field label="الموعد"><Input name="scheduledFor" type="datetime-local" required /></Field>
                      <Field label="الصورة"><Select name="imageUrl" options={[["", "بدون صورة"], ...images.map((i) => [i.image_url!, i.image_url!.slice(-30)] as [string, string])]} /></Field>
                      <Button size="sm" variant="secondary">جدولة</Button>
                    </form>
                  )}
                </div>
              ))}
              {assets.filter((a) => a.asset_type !== "image").length === 0 && <p className="text-sm text-muted">لا توجد مسودات.</p>}
            </div>
          </Card>
          <Card title="الصور المصرح بها">
            <p className="mb-2 text-xs text-muted">استخدم فقط صورًا التقطتها بنفسك أو مصرحًا بها كتابيًا. صور الموردين لا تُنشر بدون إذن.</p>
            <ul className="mb-3 space-y-1 text-xs">{images.map((i) => <li key={i.id} className="truncate" dir="ltr">{i.image_url} <Badge tone="good">{i.image_rights}</Badge></li>)}</ul>
            <form action={imageAction} className="grid gap-2">
              <input type="hidden" name="variantId" value={current.id} />
              <Input name="imageUrl" type="url" placeholder="https://… (رابط عام للصورة)" dir="ltr" required />
              <Select name="rights" options={[["owned", "صورتها بنفسي"], ["authorized", "مصرح بها من صاحبها"]]} />
              <Button size="sm" variant="secondary">إضافة صورة</Button>
            </form>
          </Card>
        </div>
      )}
      <Card title="المنشورات المجدولة" className="mt-4" padded={false}>
        <Table head={["المنتج", "المنصة", "النص", "الموعد", "الحالة", ""]} empty="لا توجد منشورات.">
          {posts.map((p) => (
            <tr key={p.id}>
              <td>{p.name_ar}</td><td>{p.platform}</td><td className="max-w-80 truncate text-xs" title={p.caption}>{p.caption}</td>
              <td className="text-xs">{formatDateTime(p.scheduled_for)}</td>
              <td><Badge tone={p.status === "published" ? "good" : p.status === "failed" ? "bad" : "warn"}>{p.status}</Badge>{p.error_message && <div className="max-w-56 text-xs text-bad">{p.error_message}</div>}{p.external_post_id && <div className="text-xs text-muted" dir="ltr">{p.external_post_id}</div>}</td>
              <td className="flex gap-1">
                {(p.status === "awaiting_approval" || p.status === "failed") && <form action={approvePostAction}><input type="hidden" name="postId" value={p.id} /><Button size="sm">اعتماد للنشر</Button></form>}
                {p.status !== "published" && p.status !== "cancelled" && <form action={cancelPostAction}><input type="hidden" name="postId" value={p.id} /><Button size="sm" variant="ghost">إلغاء</Button></form>}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="الحملات ونتائجها (إدخال من مدير الإعلانات)" className="mt-4">
        <Table head={["الحملة", "النوع", "الإنفاق", "مشاهدات", "نقرات", "رسائل", "طلبات مُسلّمة", "تكلفة/طلب"]} empty="لا توجد حملات مسجلة.">
          {campaigns.map((c) => (
            <tr key={c.id}><td>{c.name}<div className="text-xs text-muted">{c.platform} · {c.start_date}</div></td><td>{c.campaign_type === "paid" ? "مدفوعة" : "عضوية"}</td>
              <td className="num">{formatEGP(c.spend)}</td><td className="num">{formatNumber(c.impressions)}</td><td className="num">{formatNumber(c.clicks)}</td><td className="num">{formatNumber(c.messages)}</td>
              <td className="num">{c.orders}</td><td className="num">{c.orders ? formatEGP(c.spend / c.orders) : "—"}</td></tr>
          ))}
        </Table>
        <form action={campaignAction} className="mt-4 grid gap-2 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <Input name="name" placeholder="اسم الحملة" required />
          <Select name="variantId" options={[["", "— المنتج —"], ...variants.map((v) => [String(v.id), v.name_ar] as [string, string])]} />
          <Select name="platform" options={[["facebook", "فيسبوك"], ["instagram", "إنستجرام"], ["tiktok", "تيك توك"], ["whatsapp", "واتساب"], ["other", "أخرى"]]} />
          <Select name="type" options={[["paid", "مدفوعة"], ["organic", "عضوية"]]} />
          <Input name="startDate" type="date" required />
          <Input name="spend" placeholder="الإنفاق ج.م" inputMode="decimal" />
          <Input name="impressions" placeholder="مشاهدات" inputMode="numeric" />
          <Input name="clicks" placeholder="نقرات" inputMode="numeric" />
          <Input name="messages" placeholder="رسائل" inputMode="numeric" />
          <Input name="notes" placeholder="ملاحظات" className="lg:col-span-2" />
          <Button variant="secondary">تسجيل</Button>
        </form>
      </Card>
      <p className="mt-3 text-xs text-muted"><Link href="/finance" className="underline">الإنفاق الإعلاني ينعكس في المالية ودفتر النقدية.</Link></p>
    </>
  );
}

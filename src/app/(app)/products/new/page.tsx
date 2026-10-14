import Link from "next/link";
import { Button, Card, Field, Input, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { getSql } from "@/lib/db/client";
import { findSimilarProducts } from "@/lib/services/catalog";
import { RISK_AR } from "@/lib/ui/labels";
import { createProductAction } from "../actions";

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ signal?: string; name?: string }> }) {
  const sp = await searchParams;
  const sql = getSql();
  let prefill = sp.name ?? "";
  let signalId: number | null = null;
  if (sp.signal) {
    const [s] = await sql<{ id: number; title_raw: string }[]>`SELECT id, title_raw FROM trend_signals WHERE id = ${Number(sp.signal)}`;
    if (s) { signalId = s.id; prefill = s.title_raw.split(" | ")[0]; }
  }
  const similar = prefill ? await findSimilarProducts(sql, prefill) : [];
  return (
    <>
      <PageHeader title="منتج جديد" subtitle="سجّل منتجًا ومقاسًا/موديلًا محددًا. المقاسات أو السعات أو الخامات المختلفة تُسجل كمنتجات مستقلة (SKU)." />
      {similar.length > 0 && (
        <div className="mb-4"><Notice tone="warn">
          منتجات مشابهة موجودة بالفعل — تأكد أنه ليس تكرارًا:
          <ul className="mt-2 list-disc pr-5">{similar.map((s) => <li key={s.id}><Link className="underline" href={`/products?q=${encodeURIComponent(s.name_ar)}`}>{s.name_ar}</Link> — تشابه {Math.round(s.sim * 100)}٪{s.match.conflicts.length ? ` (${s.match.conflicts.join("، ")})` : ""}</li>)}</ul>
        </Notice></div>
      )}
      <form action={createProductAction}>
        {signalId && <input type="hidden" name="signalId" value={signalId} />}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="المنتج">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="الاسم بالعربي *" className="sm:col-span-2"><Input name="nameAr" required defaultValue={prefill} /></Field>
              <Field label="الاسم بالإنجليزية"><Input name="nameEn" dir="ltr" /></Field>
              <Field label="الفئة"><Input name="category" placeholder="مطبخ، إكسسوارات موبايل…" /></Field>
              <Field label="فئة المخاطر" hint="الفئات الحساسة تتطلب فحصًا إضافيًا قبل الشراء"><Select name="riskCategory" options={Object.entries(RISK_AR)} /></Field>
              <Field label="قابل للكسر؟"><label className="flex h-10 items-center gap-2"><Input type="checkbox" name="fragile" /> نعم</label></Field>
              <Field label="رابط صورة" className="sm:col-span-2"><Input name="imageUrl" type="url" dir="ltr" /></Field>
              <Field label="حقوق الصورة"><Select name="imageRights" options={[["none", "لا توجد صورة"], ["reference_only", "مرجعية فقط (لا تُنشر)"], ["owned", "ملكي (صورتها بنفسي)"], ["authorized", "مصرح بها من المورد/المالك"]]} /></Field>
              <Field label="وصف" className="sm:col-span-2"><Textarea name="description" /></Field>
            </div>
          </Card>
          <Card title="المقاس / الموديل (SKU)">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="وصف مختصر للمتغير *" className="sm:col-span-2"><Input name="label" required placeholder="مثال: 500 مل أسود" /></Field>
              <Field label="السعة"><Input name="capacity" placeholder="500 مل" /></Field>
              <Field label="الأبعاد"><Input name="dimensions" placeholder="30×20 سم" /></Field>
              <Field label="الخامة"><Input name="material" /></Field>
              <Field label="اللون"><Input name="color" /></Field>
              <Field label="الماركة"><Input name="brand" /></Field>
              <Field label="رقم الموديل"><Input name="modelNumber" dir="ltr" /></Field>
              <Field label="المقاس"><Input name="sizeLabel" /></Field>
              <Field label="درجة الجودة"><Input name="qualityGrade" placeholder="درجة أولى / تجاري" /></Field>
              <Field label="الوزن (جرام)"><Input name="weightGrams" inputMode="numeric" /></Field>
            </div>
          </Card>
        </div>
        <div className="mt-4"><Button type="submit">إنشاء المنتج</Button></div>
      </form>
    </>
  );
}

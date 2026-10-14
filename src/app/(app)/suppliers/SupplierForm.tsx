import { Field, Input, Select, Textarea } from "@/components/ui";
import { MARKET_AR } from "@/lib/ui/labels";

type S = Partial<Record<"name" | "shop_name" | "market_area" | "address" | "phone" | "whatsapp" | "telegram_handle" | "telegram_chat_id" | "return_policy" | "pickup_options" | "delivery_options" | "reliability_notes", string | null>> & { reliability_rating?: number | null };

export function SupplierFields({ s = {} }: { s?: S }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="اسم المورد *"><Input name="name" required defaultValue={s.name ?? ""} /></Field>
      <Field label="اسم المحل"><Input name="shopName" defaultValue={s.shop_name ?? ""} /></Field>
      <Field label="المنطقة"><Select name="marketArea" defaultValue={s.market_area ?? "mosky"} options={Object.entries(MARKET_AR)} /></Field>
      <Field label="العنوان"><Input name="address" defaultValue={s.address ?? ""} /></Field>
      <Field label="الهاتف"><Input name="phone" dir="ltr" defaultValue={s.phone ?? ""} /></Field>
      <Field label="واتساب"><Input name="whatsapp" dir="ltr" defaultValue={s.whatsapp ?? ""} /></Field>
      <Field label="حساب/قناة تيليجرام"><Input name="telegramHandle" dir="ltr" defaultValue={s.telegram_handle ?? ""} placeholder="@channel" /></Field>
      <Field label="Telegram chat ID" hint="لاستقبال منشورات القناة — البوت يجب أن يكون مشرفًا بها"><Input name="telegramChatId" dir="ltr" defaultValue={s.telegram_chat_id ?? ""} placeholder="-100…" /></Field>
      <Field label="سياسة الاسترجاع/الاستبدال"><Input name="returnPolicy" defaultValue={s.return_policy ?? ""} /></Field>
      <Field label="الاستلام"><Input name="pickupOptions" defaultValue={s.pickup_options ?? ""} /></Field>
      <Field label="التوصيل"><Input name="deliveryOptions" defaultValue={s.delivery_options ?? ""} /></Field>
      <Field label="تقييم الموثوقية (0–5)" hint="بناءً على تعامل موثّق فقط"><Input name="reliabilityRating" inputMode="decimal" defaultValue={s.reliability_rating ?? ""} /></Field>
      <Field label="ملاحظات الموثوقية والجودة" className="sm:col-span-2"><Textarea name="reliabilityNotes" defaultValue={s.reliability_notes ?? ""} /></Field>
    </div>
  );
}

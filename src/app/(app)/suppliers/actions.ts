"use server";
import { act, int, num, str } from "@/lib/ui/action";
import { createSupplier, setOfferMatch, SupplierSchema } from "@/lib/services/suppliers";
import { refreshOpportunity } from "@/lib/services/analysis";
import { audit } from "@/lib/services/audit";

const supplierFrom = (fd: FormData) => ({
  name: str(fd, "name"), shopName: str(fd, "shopName"), marketArea: str(fd, "marketArea") ?? "other_cairo", address: str(fd, "address"),
  phone: str(fd, "phone"), whatsapp: str(fd, "whatsapp"), telegramHandle: str(fd, "telegramHandle"), telegramChatId: str(fd, "telegramChatId"),
  returnPolicy: str(fd, "returnPolicy"), pickupOptions: str(fd, "pickupOptions"), deliveryOptions: str(fd, "deliveryOptions"),
  reliabilityRating: num(fd, "reliabilityRating"), reliabilityNotes: str(fd, "reliabilityNotes"),
});

export async function createSupplierAction(fd: FormData) {
  await act("/suppliers", async ({ sql, user }) => {
    const id = await createSupplier(sql, user, supplierFrom(fd));
    return { redirect: `/suppliers/${id}`, message: "تمت إضافة المورد" };
  });
}

export async function updateSupplierAction(fd: FormData) {
  const id = Number(fd.get("id"));
  await act(`/suppliers/${id}`, async ({ sql, user }) => {
    const s = SupplierSchema.parse(supplierFrom(fd));
    await sql`UPDATE suppliers SET name = ${s.name}, shop_name = ${s.shopName ?? null}, market_area = ${s.marketArea}, address = ${s.address ?? null},
      phone = ${s.phone ?? null}, whatsapp = ${s.whatsapp ?? null}, telegram_handle = ${s.telegramHandle ?? null}, telegram_chat_id = ${s.telegramChatId ?? null},
      return_policy = ${s.returnPolicy ?? null}, pickup_options = ${s.pickupOptions ?? null}, delivery_options = ${s.deliveryOptions ?? null},
      reliability_rating = ${s.reliabilityRating ?? null}, reliability_notes = ${s.reliabilityNotes ?? null}, is_active = ${fd.get("isActive") === "on"} WHERE id = ${id}`;
    await audit(sql, user, "supplier.update", "suppliers", id, null, s);
  });
}

export async function linkOfferAction(fd: FormData) {
  await act("/suppliers/inbox", async ({ sql, user }) => {
    const variantId = int(fd, "variantId");
    const status = String(fd.get("status")) as "probable" | "mismatch";
    await setOfferMatch(sql, user, Number(fd.get("offerId")), status === "mismatch" ? null : variantId, status === "mismatch" ? "mismatch" : "probable");
    if (variantId) await refreshOpportunity(sql, variantId);
    return status === "mismatch" ? "تم وضع علامة «ليس منتجًا متابعًا»" : "تم الربط كتطابق مبدئي — أكّد التطابق من صفحة المنتج بعد مراجعة المواصفات";
  });
}

export async function rejectOfferAction(fd: FormData) {
  await act("/suppliers/inbox", async ({ sql, user }) => {
    await sql`UPDATE supplier_offers SET status = 'rejected' WHERE id = ${Number(fd.get("offerId"))}`;
    await audit(sql, user, "supplier_offer.reject", "supplier_offers", Number(fd.get("offerId")), null, {});
  });
}

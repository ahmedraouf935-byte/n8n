"use server";
import { act, bool, int, num, str } from "@/lib/ui/action";
import { confirmCollection, createOrder, reconcileOrder, recordReturn, transitionOrder } from "@/lib/services/orders";
import type { OrderStatus } from "@/lib/domain/orders";

export async function createOrderAction(fd: FormData) {
  await act("/orders", async ({ sql, user }) => {
    const r = await createOrder(sql, user, {
      customer: { name: str(fd, "name"), phone: (str(fd, "phone") ?? "").replace(/[\s-]/g, ""), city: str(fd, "city"), address: str(fd, "address") },
      channel: str(fd, "channel") ?? "whatsapp", paymentMethod: str(fd, "paymentMethod") ?? "cod",
      items: [{ variantId: int(fd, "variantId"), quantity: int(fd, "quantity") ?? 1, unitPrice: num(fd, "unitPrice") }],
      shippingFeeCharged: num(fd, "shippingFee") ?? 0, discountTotal: num(fd, "discount") ?? 0, campaignId: int(fd, "campaignId"), notes: str(fd, "notes"),
    });
    return { redirect: `/orders/${r.orderId}`, message: `تم إنشاء الطلب ${r.orderNumber} — أكده لحجز المخزون` };
  });
}

export async function transitionAction(fd: FormData) {
  const id = Number(fd.get("orderId"));
  await act(`/orders/${id}`, async ({ sql, user }) => {
    await transitionOrder(sql, user, id, String(fd.get("to")) as OrderStatus, {
      carrier: str(fd, "carrier") ?? undefined, trackingNumber: str(fd, "tracking") ?? undefined, carrierCost: num(fd, "carrierCost") ?? undefined,
      packagingCost: num(fd, "packagingCost") ?? undefined, collected: fd.has("collected") ? bool(fd, "collected") : undefined,
      collectionFee: num(fd, "collectionFee") ?? undefined, returnCost: num(fd, "returnCost") ?? undefined, reason: str(fd, "reason") ?? undefined,
    });
  });
}

export async function collectAction(fd: FormData) {
  const id = Number(fd.get("orderId"));
  await act(`/orders/${id}`, async ({ sql, user }) => { await confirmCollection(sql, user, id); return "تم تأكيد استلام المبلغ"; });
}

export async function returnAction(fd: FormData) {
  const id = Number(fd.get("orderId"));
  await act(`/orders/${id}`, async ({ sql, user }) => {
    await recordReturn(sql, user, id, { orderItemId: int(fd, "orderItemId"), quantity: int(fd, "quantity"), condition: str(fd, "condition"),
      refundAmount: num(fd, "refundAmount") ?? 0, returnShippingCost: num(fd, "returnShippingCost") ?? 0, reason: str(fd, "reason") });
    return "تم تسجيل المرتجع وعكس قيود المخزون والنقدية";
  });
}

export async function reconcileAction(fd: FormData) {
  const id = Number(fd.get("orderId"));
  await act(`/orders/${id}`, async ({ sql, user }) => {
    const a = await reconcileOrder(sql, user, id);
    return `تمت التسوية. المساهمة الفعلية: ${a.contribution} ج.م`;
  });
}

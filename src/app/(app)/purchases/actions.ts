"use server";
import { act, int, num, str } from "@/lib/ui/action";
import { approvePurchase, cancelPurchaseOrder, receivePurchaseOrder, recordPoPayment, rejectPurchase } from "@/lib/services/purchasing";
import { DomainError } from "@/lib/services/errors";

export async function approveAction(fd: FormData) {
  await act("/purchases", async ({ sql, user }) => {
    const r = await approvePurchase(sql, user, Number(fd.get("id")));
    if (!r.approved) throw new DomainError("لم تتم الموافقة — بوابات الأمان غير مستوفاة الآن", "gates_failed", { failed: r.failed });
    return `تمت الموافقة وأُنشئ أمر الشراء ${r.poNumber}. لم يُدفع أي مبلغ بعد — سجّل الدفع عند الدفع الفعلي.`;
  }, ["owner"]);
}
export async function rejectAction(fd: FormData) {
  await act("/purchases", async ({ sql, user }) => { await rejectPurchase(sql, user, Number(fd.get("id")), str(fd, "reason") ?? "رفض المالك"); }, ["owner"]);
}
export async function payAction(fd: FormData) {
  await act("/purchases", async ({ sql, user }) => {
    const amount = num(fd, "amount");
    if (!amount) throw new DomainError("أدخل المبلغ");
    await recordPoPayment(sql, user, Number(fd.get("poId")), amount);
    return "تم تسجيل الدفع في دفتر النقدية";
  }, ["owner"]);
}
export async function receiveAction(fd: FormData) {
  await act("/purchases", async ({ sql, user }) => {
    const r = await receivePurchaseOrder(sql, user, Number(fd.get("poId")), { quantity: int(fd, "quantity") ?? 0, actualPickupCost: num(fd, "pickup") ?? 0, note: str(fd, "note") ?? undefined });
    return `تم الاستلام وتحديث المخزون. متوسط تكلفة القطعة الآن ${r.avgUnitCost} ج.م`;
  });
}
export async function cancelPoAction(fd: FormData) {
  await act("/purchases", async ({ sql, user }) => { await cancelPurchaseOrder(sql, user, Number(fd.get("poId")), str(fd, "reason") ?? "إلغاء"); }, ["owner"]);
}

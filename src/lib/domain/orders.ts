/** Sales-order lifecycle: New → Confirmed → Packed → Shipped → Delivered/Failed/Returned/Cancelled → reconciled. */
export type OrderStatus =
  | "new" | "confirmed" | "packed" | "shipped" | "delivered" | "failed_delivery" | "returned" | "cancelled";

export const ORDER_STATUS_AR: Record<OrderStatus, string> = {
  new: "جديد",
  confirmed: "مؤكد",
  packed: "مُغلَّف",
  shipped: "تم الشحن",
  delivered: "تم التسليم",
  failed_delivery: "فشل التسليم",
  returned: "مرتجع",
  cancelled: "ملغي",
};

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["delivered", "failed_delivery"],
  delivered: ["returned"],
  failed_delivery: [],
  returned: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[from];
}
export function isTerminal(s: OrderStatus): boolean {
  return TRANSITIONS[s].length === 0 || s === "delivered";
}

/** Stock effects per transition (applied to inventory_levels for each order line of quantity q). */
export function stockEffect(to: OrderStatus, from: OrderStatus) {
  switch (to) {
    case "confirmed": return { type: "reserve" as const, reserved: +1 };
    case "cancelled":
      return from === "new" ? null : { type: "unreserve" as const, reserved: -1 };
    case "shipped": return { type: "ship" as const, onHand: -1, reserved: -1, inTransit: +1 };
    case "delivered": return { type: "deliver" as const, inTransit: -1, sold: +1 };
    default: return null;
  }
}

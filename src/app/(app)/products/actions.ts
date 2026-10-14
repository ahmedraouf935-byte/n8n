"use server";
import { act, bool, int, num, str } from "@/lib/ui/action";
import { addVariant, createProductWithVariant, setProductStatus, setVariantVerified } from "@/lib/services/catalog";
import { linkSignalToProduct } from "@/lib/services/trends";
import { addRetailOffer, setRetailMatch } from "@/lib/services/retail";
import { addSupplierOffer, recordVerification, setOfferMatch } from "@/lib/services/suppliers";
import { refreshOpportunity } from "@/lib/services/analysis";
import { requestPurchase } from "@/lib/services/purchasing";
import { audit } from "@/lib/services/audit";
import { DomainError } from "@/lib/services/errors";

const variantFrom = (fd: FormData) => ({
  label: str(fd, "label") ?? "أساسي", brand: str(fd, "brand"), modelNumber: str(fd, "modelNumber"), color: str(fd, "color"),
  sizeLabel: str(fd, "sizeLabel"), dimensions: str(fd, "dimensions"), capacity: str(fd, "capacity"), material: str(fd, "material"),
  qualityGrade: str(fd, "qualityGrade"), weightGrams: int(fd, "weightGrams"),
});

export async function createProductAction(fd: FormData) {
  await act("/products/new", async ({ sql, user }) => {
    return sql.begin(async (tx) => {
      const r = await createProductWithVariant(tx, user, {
        nameAr: str(fd, "nameAr") ?? "", nameEn: str(fd, "nameEn"), category: str(fd, "category") ?? "general", description: str(fd, "description"),
        imageUrl: str(fd, "imageUrl"), imageRights: (str(fd, "imageRights") as "none") ?? "none", riskCategory: str(fd, "riskCategory") ?? "general",
      }, variantFrom(fd));
      if (bool(fd, "fragile")) await tx`UPDATE products SET fragile = true WHERE id = ${r.productId}`;
      const signal = int(fd, "signalId");
      if (signal) await linkSignalToProduct(tx, user, signal, r.productId);
      await refreshOpportunity(tx, r.variantId);
      return { redirect: `/products/${r.variantId}`, message: "تم إنشاء المنتج — أضف الآن أسعار التجزئة وعروض الموردين" };
    });
  });
}

export async function addVariantAction(fd: FormData) {
  const productId = Number(fd.get("productId"));
  await act(`/products/${fd.get("variantId")}`, async ({ sql, user }) => {
    const id = await addVariant(sql, user, productId, variantFrom(fd));
    await refreshOpportunity(sql, id);
    return { redirect: `/products/${id}`, message: "تمت إضافة المقاس/الموديل كمنتج مستقل" };
  });
}

export async function addRetailOfferAction(fd: FormData) {
  const v = Number(fd.get("variantId"));
  await act(`/products/${v}#retail`, async ({ sql, user }) => {
    const r = await addRetailOffer(sql, user, {
      variantId: v, retailer: str(fd, "retailer"), sellerName: str(fd, "sellerName"), url: str(fd, "url"), titleRaw: str(fd, "titleRaw"),
      listedPrice: num(fd, "listedPrice"), originalPrice: num(fd, "originalPrice"), shippingCost: num(fd, "shippingCost"),
      priceType: str(fd, "priceType") ?? "listed", availability: str(fd, "availability") ?? "unknown", observedAt: str(fd, "observedAt") ?? undefined,
    });
    await refreshOpportunity(sql, v);
    return r.matchStatus === "mismatch" ? "تم الحفظ — لكن العنوان يحتوي على مواصفات مختلفة فاستُبعد من المقارنة" : "تم حفظ العرض. أكّد التطابق ليدخل في المقارنة.";
  });
}

export async function retailMatchAction(fd: FormData) {
  const v = Number(fd.get("variantId"));
  await act(`/products/${v}#retail`, async ({ sql, user }) => {
    await setRetailMatch(sql, user, Number(fd.get("offerId")), String(fd.get("status")) as "exact");
    await refreshOpportunity(sql, v);
  });
}

export async function addSupplierOfferAction(fd: FormData) {
  const v = Number(fd.get("variantId"));
  await act(`/products/${v}#suppliers`, async ({ sql, user }) => {
    await addSupplierOffer(sql, user, {
      supplierId: int(fd, "supplierId"), variantId: v, titleRaw: str(fd, "titleRaw"), quotedPrice: num(fd, "quotedPrice"),
      priceUncertain: bool(fd, "priceUncertain"), minOrderQty: int(fd, "minOrderQty") ?? 1, sourceUrl: str(fd, "sourceUrl"), evidenceNote: str(fd, "evidenceNote"),
    });
    await refreshOpportunity(sql, v);
    return "تم حفظ عرض المورد كـ«غير مؤكد». تواصل مع المورد وسجّل التأكيد.";
  });
}

export async function offerMatchAction(fd: FormData) {
  const v = Number(fd.get("variantId"));
  await act(`/products/${v}#suppliers`, async ({ sql, user }) => {
    const status = String(fd.get("status")) as "confirmed" | "mismatch";
    await setOfferMatch(sql, user, Number(fd.get("offerId")), status === "mismatch" ? null : v, status);
    await refreshOpportunity(sql, v);
  });
}

export async function verifyOfferAction(fd: FormData) {
  const v = Number(fd.get("variantId"));
  await act(`/products/${v}#suppliers`, async ({ sql, user }) => {
    await recordVerification(sql, user, {
      supplierOfferId: int(fd, "offerId"), method: str(fd, "method"), result: str(fd, "result"), confirmedPrice: num(fd, "confirmedPrice"),
      confirmedQuantity: int(fd, "confirmedQuantity"), confirmedMoq: int(fd, "confirmedMoq"), notes: str(fd, "notes"), validDays: int(fd, "validDays") ?? undefined,
    });
    await refreshOpportunity(sql, v);
    return "تم تسجيل تأكيد المورد";
  });
}

export async function verifyVariantAction(fd: FormData) {
  const v = Number(fd.get("variantId"));
  await act(`/products/${v}`, async ({ sql, user }) => {
    await setVariantVerified(sql, user, v, fd.get("verified") === "true");
    await refreshOpportunity(sql, v);
  });
}

export async function oppInputsAction(fd: FormData) {
  const v = Number(fd.get("variantId"));
  await act(`/products/${v}#economics`, async ({ sql, user }) => {
    const overrides: Record<string, number> = {};
    for (const k of ["adCostPerOrder", "carrierCostPerOrder", "shippingFeeCharged", "packagingPerOrder", "failedDeliveryRate", "returnRate", "pickupCostTotal", "discountPerOrder"]) {
      const n = num(fd, k);
      if (n !== null) overrides[k] = k.endsWith("Rate") ? n / 100 : n;
    }
    const ownerPrice = num(fd, "ownerPrice");
    const testQty = int(fd, "testQuantity");
    await sql`INSERT INTO opportunities (variant_id, owner_price, test_quantity, economics_overrides) VALUES (${v}, ${ownerPrice}, ${testQty}, ${sql.json(overrides)})
      ON CONFLICT (variant_id) DO UPDATE SET owner_price = EXCLUDED.owner_price, test_quantity = EXCLUDED.test_quantity, economics_overrides = EXCLUDED.economics_overrides`;
    await audit(sql, user, "opportunity.inputs", "product_variants", v, null, { ownerPrice, testQty, overrides });
    await refreshOpportunity(sql, v);
    return "تم تحديث افتراضات الحساب";
  });
}

export async function refreshAction(fd: FormData) {
  const v = Number(fd.get("variantId"));
  await act(`/products/${v}`, async ({ sql }) => {
    await refreshOpportunity(sql, v);
    return "تم إعادة الحساب";
  });
}

export async function productStatusAction(fd: FormData) {
  const v = Number(fd.get("variantId"));
  await act(`/products/${v}`, async ({ sql, user }) => {
    await setProductStatus(sql, user, Number(fd.get("productId")), String(fd.get("status")));
    if (fd.get("status") === "rejected") await sql`UPDATE opportunities SET status = 'rejected' WHERE variant_id = ${v}`;
    if (fd.get("status") === "researching") await sql`UPDATE opportunities SET status = 'researching' WHERE variant_id = ${v}`;
  });
}

export async function requestPurchaseAction(fd: FormData) {
  const v = Number(fd.get("variantId"));
  await act(`/products/${v}#decision`, async ({ sql, user }) => {
    const sellingPrice = num(fd, "sellingPrice");
    if (!sellingPrice) throw new DomainError("حدد سعر البيع");
    const r = await requestPurchase(sql, user, {
      variantId: v, supplierOfferId: int(fd, "supplierOfferId"), quantity: int(fd, "quantity"), sellingPrice,
      pickupCost: num(fd, "pickupCost") ?? undefined, complianceAck: bool(fd, "complianceAck"),
    });
    return { redirect: "/purchases", message: r.gatesPassed ? "تم إرسال طلب الشراء — كل بوابات الأمان ناجحة. بانتظار موافقتك." :
      `تم تسجيل الطلب لكن بوابات الأمان غير مستوفاة:\n• ${r.gates.filter((g) => !g.passed && g.severity === "block").map((g) => g.message).join("\n• ")}` };
  }, ["owner", "operator"]);
}

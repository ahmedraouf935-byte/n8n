/**
 * Mandatory purchase safety gates. They apply regardless of score.
 * A purchase can be approved only if every "block" gate passes.
 */
import type { RiskCategory } from "./scoring";

export interface GateInput {
  now?: Date;
  quantity: number;
  plannedTotalCost: number;
  variantVerified: boolean;
  offerMatchStatus: "unmatched" | "probable" | "confirmed" | "mismatch";
  verification: {
    result: "available" | "unavailable" | "partial" | "price_changed";
    validUntil: Date | string;
    confirmedQuantity: number | null;
  } | null;
  availableCash: number;          // cash ledger balance
  committedCash: number;          // approved but unpaid purchases
  inventoryBudgetRemaining: number;
  maxTestSpendPerProduct: number;
  activeTests: number;            // variants currently being tested (excluding this one)
  maxConcurrentTests: number;
  economicsBase: { contributionPerDeliveredUnit: number; marginPct: number };
  economicsPessimistic?: { batchResult: number } | null;
  minMarginPct: number;
  scoreConfidence: "low" | "medium" | "high" | null;
  riskCategory: RiskCategory;
  complianceAck: boolean;
  requireComplianceFor: string[];
  blockedCategories: string[];
  isDemoData?: boolean;
  productionEnvironment?: boolean;
}

export interface GateResult {
  code: string;
  passed: boolean;
  severity: "block" | "warn";
  message: string;
}

export function checkPurchaseGates(g: GateInput): { approved: boolean; gates: GateResult[] } {
  const now = g.now ?? new Date();
  const gates: GateResult[] = [];
  const add = (code: string, passed: boolean, message: string, severity: "block" | "warn" = "block") =>
    gates.push({ code, passed, severity, message });

  // 1. Verified supplier availability (an AI guess is never stock confirmation)
  const v = g.verification;
  const verifiedFresh = !!v && v.result !== "unavailable" && new Date(v.validUntil) > now;
  add(
    "supplier_verified",
    verifiedFresh,
    verifiedFresh ? "توفر المورد مؤكد من المالك وصالح." : !v ? "لا يوجد تأكيد توفر من المورد (مكالمة/واتساب/زيارة)." :
      v.result === "unavailable" ? "المورد أكد عدم التوفر." : "تأكيد التوفر منتهي الصلاحية — أعد التواصل مع المورد.",
  );
  if (verifiedFresh && v!.confirmedQuantity !== null) {
    const enough = v!.confirmedQuantity >= g.quantity;
    add("quantity_available", enough, enough ? "الكمية المؤكدة تكفي." : `الكمية المؤكدة (${v!.confirmedQuantity}) أقل من المطلوبة (${g.quantity}).`);
  }

  // 2. Exact product/variant match
  const matched = g.variantVerified && g.offerMatchStatus === "confirmed";
  add("variant_match", matched, matched ? "المنتج والمقاس مطابقان ومؤكدان." :
    !g.variantVerified ? "المنتج/المقاس لم يتم تأكيده من المالك." : "عرض المورد غير مؤكد التطابق مع نفس المقاس/الموديل.");

  // 3. Cash & budget limits
  const free = g.availableCash - g.committedCash;
  add("cash_available", g.plannedTotalCost <= free,
    g.plannedTotalCost <= free ? `النقد المتاح يكفي (${free.toFixed(2)} ج.م متاح).` :
      `التكلفة (${g.plannedTotalCost} ج.م) تتجاوز النقد المتاح غير الملتزم (${free.toFixed(2)} ج.م).`);
  add("inventory_budget", g.plannedTotalCost <= g.inventoryBudgetRemaining,
    g.plannedTotalCost <= g.inventoryBudgetRemaining ? "داخل ميزانية المخزون." :
      `تتجاوز المتبقي من ميزانية المخزون (${g.inventoryBudgetRemaining.toFixed(2)} ج.م).`);
  add("per_product_cap", g.plannedTotalCost <= g.maxTestSpendPerProduct,
    g.plannedTotalCost <= g.maxTestSpendPerProduct ? "داخل حد الاختبار للمنتج الواحد." :
      `تتجاوز حد الاختبار للمنتج الواحد (${g.maxTestSpendPerProduct} ج.م).`);
  add("concurrent_tests", g.activeTests < g.maxConcurrentTests,
    g.activeTests < g.maxConcurrentTests ? `عدد المنتجات تحت الاختبار ${g.activeTests} من ${g.maxConcurrentTests}.` :
      `يوجد بالفعل ${g.activeTests} منتجات تحت الاختبار (الحد ${g.maxConcurrentTests}).`);

  // 4. Plausible positive unit economics
  const positive = g.economicsBase.contributionPerDeliveredUnit > 0 && g.economicsBase.marginPct >= g.minMarginPct;
  add("unit_economics", positive, positive ? `هامش المساهمة ${g.economicsBase.marginPct}٪ ≥ ${g.minMarginPct}٪.` :
    `هامش المساهمة ${g.economicsBase.marginPct}٪ أقل من الحد الأدنى ${g.minMarginPct}٪ أو سالب.`);
  if (g.economicsPessimistic) {
    add("downside", g.economicsPessimistic.batchResult > -g.plannedTotalCost * 0.6,
      `في السيناريو المتشائم: النتيجة ${g.economicsPessimistic.batchResult} ج.م.`, "warn");
  }

  // 5. No high-confidence spending on weak data
  add("data_confidence", g.scoreConfidence !== null && g.scoreConfidence !== "low",
    g.scoreConfidence === null ? "لا يوجد تقييم محسوب للمنتج." :
      g.scoreConfidence === "low" ? "الثقة في البيانات منخفضة (بيانات قديمة أو ناقصة)." : `الثقة في البيانات: ${g.scoreConfidence === "high" ? "عالية" : "متوسطة"}.`);

  // 6. Category compliance
  if (g.blockedCategories.includes(g.riskCategory)) add("category_blocked", false, "فئة محظورة — لا يمكن شراؤها.");
  if (g.requireComplianceFor.includes(g.riskCategory)) {
    add("compliance_ack", g.complianceAck, g.complianceAck ? "تم تأكيد فحوصات الفئة الحساسة." :
      "فئة حساسة (تجميل/طبي/إلكترونيات/أطفال/أغذية) — يجب تأكيد الفحص (تسجيل، صلاحية، ضمان، أصالة).");
  }

  // 7. Demo data can never back a real purchase
  if (g.productionEnvironment && g.isDemoData) add("not_demo", false, "البيانات تجريبية — لا يمكن استخدامها لقرار شراء حقيقي.");

  const approved = gates.every((x) => x.severity !== "block" || x.passed);
  return { approved, gates };
}

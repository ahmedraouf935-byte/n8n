/**
 * Opportunity score (0–100). A configurable INTERNAL HEURISTIC, not a validated prediction.
 * Each sub-score is explained in Arabic so the owner can see exactly why.
 */

export interface ScoreWeights {
  demand: number;
  profit: number;
  supplier: number;
  risk: number;
  competition: number;
}
export const DEFAULT_WEIGHTS: ScoreWeights = { demand: 30, profit: 30, supplier: 20, risk: 10, competition: 10 };
export const DEFAULT_BANDS = { high_priority: 80, manual_review: 65 };
export const SCORING_MODEL_VERSION = "heuristic-v1";

export type RiskCategory =
  | "general" | "cosmetics" | "medical" | "electronics" | "food" | "children" | "regulated" | "prohibited";

export interface TrendEvidence {
  evidenceType: "measured" | "owner_reported" | "ai_hypothesis";
  region: string;
  platform: string;
  measuredGrowthPct?: number | null;
  discoveredAt: Date | string;
}

export type SupplierState = "verified_fresh" | "verified_stale" | "unverified" | "unavailable" | "none";

export interface ScoreInput {
  trends: TrendEvidence[];
  economics: { marginPct: number; contributionPerDeliveredUnit: number } | null;
  supplier: { state: SupplierState; reliability: number | null; moqFitsBudget: boolean };
  risk: { category: RiskCategory; weightGrams?: number | null; fragile?: boolean };
  competition: { freshOfferCount: number; ourPriceVsMedianPct: number | null };
  now?: Date;
  trendFreshDays?: number;
}

export interface ScoreLine {
  key: keyof ScoreWeights;
  label: string;
  score: number;
  weight: number;
  reasons: string[];
}

export interface ScoreResult {
  total: number;
  lines: ScoreLine[];
  confidence: "low" | "medium" | "high";
  confidenceReasons: string[];
  band: "high_priority" | "manual_review" | "reject";
  bandReasons: string[];
  weights: ScoreWeights;
  modelVersion: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));

function demandScore(input: ScoreInput): ScoreLine {
  const now = input.now ?? new Date();
  const freshDays = input.trendFreshDays ?? 21;
  const reasons: string[] = [];
  const t = input.trends;
  if (!t.length) return { key: "demand", label: "الطلب/الترند", score: 0, weight: 0, reasons: ["لا توجد أي إشارة طلب مسجلة."] };

  const real = t.filter((x) => x.evidenceType !== "ai_hypothesis");
  if (!real.length) {
    reasons.push("كل الإشارات فرضيات من الذكاء الاصطناعي بدون قياس — الحد الأقصى 25.");
    return { key: "demand", label: "الطلب/الترند", score: clamp(Math.min(25, 10 + 5 * t.length)), weight: 0, reasons };
  }
  const measured = real.filter((x) => x.evidenceType === "measured");
  let s = measured.length ? 40 : 30;
  reasons.push(measured.length ? `${measured.length} إشارة مقاسة من المصدر.` : "إشارات مسجلة من المالك (غير مقاسة آليًا).");

  const growth = Math.max(0, ...measured.map((x) => x.measuredGrowthPct ?? 0));
  if (growth > 0) {
    const g = Math.min(25, growth / 10);
    s += g;
    reasons.push(`نمو مقاس ${Math.round(growth)}٪ (+${Math.round(g)}).`);
  }
  if (real.some((x) => x.region === "EG")) {
    s += 15;
    reasons.push("يوجد دليل طلب داخل مصر (+15).");
  } else reasons.push("الإشارات عالمية فقط — الطلب في مصر غير مثبت.");
  const platforms = new Set(real.map((x) => x.platform)).size;
  if (platforms > 1) {
    const p = Math.min(20, 10 * (platforms - 1));
    s += p;
    reasons.push(`ظهر على ${platforms} منصات مستقلة (+${p}).`);
  }
  const freshest = Math.min(...real.map((x) => (now.getTime() - new Date(x.discoveredAt).getTime()) / 86_400_000));
  if (freshest > freshDays) {
    s *= 0.5;
    reasons.push(`أحدث إشارة عمرها ${Math.floor(freshest)} يوم — تم خفض الدرجة للنصف.`);
  }
  return { key: "demand", label: "الطلب/الترند", score: clamp(s), weight: 0, reasons };
}

function profitScore(input: ScoreInput): ScoreLine {
  const e = input.economics;
  if (!e) return { key: "profit", label: "الربحية", score: 0, weight: 0, reasons: ["لا يمكن حساب الربحية (سعر جملة أو سعر بيع غير معروف)."] };
  const reasons = [`هامش المساهمة المتوقع ${e.marginPct}٪، ${e.contributionPerDeliveredUnit} ج.م لكل قطعة مُسلَّمة.`];
  let s = e.marginPct <= 5 ? 0 : e.marginPct >= 40 ? 100 : ((e.marginPct - 5) / 35) * 100;
  if (e.contributionPerDeliveredUnit < 20 && s > 50) {
    s = 50;
    reasons.push("الربح المطلق للقطعة صغير (<20 ج.م) — الحد الأقصى 50.");
  }
  return { key: "profit", label: "الربحية", score: clamp(s), weight: 0, reasons };
}

function supplierScore(input: ScoreInput): ScoreLine {
  const { state, reliability, moqFitsBudget } = input.supplier;
  const reasons: string[] = [];
  let s = 0;
  switch (state) {
    case "none": reasons.push("لا يوجد عرض مورد مرتبط."); break;
    case "unavailable": reasons.push("المورد أكد عدم التوفر."); break;
    case "unverified": s = 25; reasons.push("عرض مورد غير مؤكد — لم يتم التواصل مع المورد."); break;
    case "verified_stale": s = 35; reasons.push("تم التأكد سابقًا لكن التأكيد انتهت صلاحيته."); break;
    case "verified_fresh": s = 60; reasons.push("التوفر والسعر مؤكدان حديثًا من المالك."); break;
  }
  if (s > 0) {
    if (reliability !== null) {
      s += state === "verified_fresh" ? reliability * 8 : reliability * 2;
      reasons.push(`تقييم موثوقية المورد ${reliability}/5.`);
    } else if (state === "verified_fresh") {
      s += 15;
      reasons.push("لا يوجد سجل تعامل سابق مع المورد.");
    }
  }
  if (!moqFitsBudget) {
    s *= 0.5;
    reasons.push("الحد الأدنى للطلب يتجاوز ميزانية الاختبار.");
  }
  return { key: "supplier", label: "المورد", score: clamp(s), weight: 0, reasons };
}

const RISK_BASE: Record<RiskCategory, number> = {
  general: 100, children: 70, electronics: 50, food: 40, cosmetics: 40, regulated: 30, medical: 20, prohibited: 0,
};

function riskScore(input: ScoreInput): ScoreLine {
  const { category, weightGrams, fragile } = input.risk;
  let s = RISK_BASE[category];
  const reasons = [`فئة المخاطر: ${category}.`];
  if (category !== "general") reasons.push("فئة حساسة تتطلب فحوصات إضافية قبل الشراء.");
  if (weightGrams && weightGrams > 2000) { s -= 35; reasons.push("وزن ثقيل (>2كجم) يرفع تكلفة الشحن."); }
  else if (weightGrams && weightGrams > 1000) { s -= 20; reasons.push("وزن متوسط (>1كجم)."); }
  if (fragile) { s -= 15; reasons.push("قابل للكسر — مخاطر مرتجعات أعلى."); }
  return { key: "risk", label: "مخاطر الشحن والجودة", score: clamp(s), weight: 0, reasons };
}

function competitionScore(input: ScoreInput): ScoreLine {
  const { freshOfferCount, ourPriceVsMedianPct } = input.competition;
  const reasons: string[] = [];
  let s: number;
  if (freshOfferCount === 0) { s = 40; reasons.push("لا توجد بيانات منافسين حديثة — المنافسة غير معروفة."); }
  else if (freshOfferCount <= 3) { s = 80; reasons.push(`${freshOfferCount} عروض منافسة فقط.`); }
  else if (freshOfferCount <= 8) { s = 65; reasons.push(`${freshOfferCount} عروض منافسة.`); }
  else { s = 45; reasons.push(`سوق مزدحم (${freshOfferCount} عرض).`); }
  if (ourPriceVsMedianPct !== null) {
    if (ourPriceVsMedianPct <= -5) { s += 15; reasons.push("سعرنا المقترح أقل من متوسط السوق."); }
    else if (ourPriceVsMedianPct > 5) { s -= 25; reasons.push("سعرنا اللازم أعلى من متوسط السوق."); }
  }
  return { key: "competition", label: "المنافسة", score: clamp(s), weight: 0, reasons };
}

export function scoreOpportunity(
  input: ScoreInput,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  bands = DEFAULT_BANDS,
): ScoreResult {
  const lines = [demandScore(input), profitScore(input), supplierScore(input), riskScore(input), competitionScore(input)];
  const wsum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  let total = 0;
  for (const l of lines) {
    l.weight = weights[l.key];
    total += (l.score * l.weight) / wsum;
  }
  total = clamp(total);

  // Confidence reflects data quality, not the score.
  const now = input.now ?? new Date();
  const confidenceReasons: string[] = [];
  let points = 0;
  const realTrend = input.trends.some((t) => t.evidenceType !== "ai_hypothesis" &&
    (now.getTime() - new Date(t.discoveredAt).getTime()) / 86_400_000 <= (input.trendFreshDays ?? 21));
  if (realTrend) points++; else confidenceReasons.push("لا يوجد دليل طلب حقيقي وحديث.");
  if (input.competition.freshOfferCount >= 2) points++; else confidenceReasons.push("أقل من عرضي تجزئة حديثين للمقارنة.");
  if (input.supplier.state === "verified_fresh") points++; else confidenceReasons.push("توفر المورد غير مؤكد حديثًا.");
  if (input.economics) points++; else confidenceReasons.push("الربحية غير محسوبة.");
  const confidence: ScoreResult["confidence"] = points >= 4 ? "high" : points === 3 ? "medium" : "low";

  const bandReasons: string[] = [];
  let band: ScoreResult["band"] = total >= bands.high_priority ? "high_priority" : total >= bands.manual_review ? "manual_review" : "reject";
  if (band === "high_priority" && confidence === "low") {
    band = "manual_review";
    bandReasons.push("الدرجة مرتفعة لكن البيانات ضعيفة أو قديمة — تم تخفيضها إلى مراجعة يدوية.");
  }
  if (input.risk.category === "prohibited") {
    band = "reject";
    bandReasons.push("فئة محظورة.");
  }
  if (input.economics && input.economics.contributionPerDeliveredUnit <= 0) {
    band = "reject";
    bandReasons.push("الربحية المتوقعة سالبة.");
  }
  return { total, lines, confidence, confidenceReasons, band, bandReasons, weights, modelVersion: SCORING_MODEL_VERSION };
}

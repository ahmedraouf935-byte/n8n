export const BAND_AR: Record<string, string> = { high_priority: "أولوية عالية", manual_review: "مراجعة يدوية", reject: "استبعاد غالبًا" };
export const CONF_AR: Record<string, string> = { high: "عالية", medium: "متوسطة", low: "منخفضة" };
export const EVIDENCE_AR: Record<string, string> = { measured: "مقاس من المصدر", owner_reported: "ملاحظة المالك", ai_hypothesis: "فرضية ذكاء اصطناعي" };
export const PLATFORM_AR: Record<string, string> = {
  tiktok: "تيك توك", facebook: "فيسبوك", instagram: "إنستجرام", google_trends: "Google Trends", amazon_eg: "أمازون مصر", noon: "نون",
  jumia: "جوميا", youtube: "يوتيوب", other: "أخرى", ai: "ذكاء اصطناعي", telegram: "تيليجرام",
};
export const MARKET_AR: Record<string, string> = { mosky: "الموسكي", ataba: "العتبة", other_cairo: "القاهرة (أخرى)", other_egypt: "محافظات أخرى", online: "أونلاين" };
export const RISK_AR: Record<string, string> = {
  general: "عام", cosmetics: "تجميل", medical: "طبي", electronics: "إلكترونيات", food: "أغذية", children: "أطفال", regulated: "منظَّم", prohibited: "محظور",
};
export const PRODUCT_STATUS_AR: Record<string, string> = {
  candidate: "مرشح", researching: "قيد البحث", testing: "قيد الاختبار", active: "نشط", paused: "متوقف مؤقتًا", stopped: "متوقف", rejected: "مرفوض",
};
export const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral" | "info"> = {
  new: "info", confirmed: "warn", packed: "warn", shipped: "warn", delivered: "good", failed_delivery: "bad", returned: "bad", cancelled: "neutral",
};
export const OPP_STATUS_AR: Record<string, string> = {
  new: "جديد", saved: "محفوظ", researching: "قيد البحث", awaiting_approval: "بانتظار الموافقة", approved: "تمت الموافقة", rejected: "مرفوض", archived: "مؤرشف",
};

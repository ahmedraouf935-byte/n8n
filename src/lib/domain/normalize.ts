/**
 * Arabic/English product-title normalization, attribute extraction and variant matching.
 *
 * Design rule: never merge two listings just because the titles look alike. Any conflicting
 * distinguishing attribute (capacity, dimensions, model number, material, wattage, battery,
 * pack size, color) makes them DIFFERENT variants. A high similarity without conflicts only
 * yields "probable" — a human confirms before an offer is treated as the same variant.
 */

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function toAsciiDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (c) => String(ARABIC_INDIC_DIGITS.indexOf(c)))
    .replace(/[۰-۹]/g, (c) => String(PERSIAN_DIGITS.indexOf(c)))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

/** Canonical text form used for comparison (not for display). */
export function normalizeText(input: string): string {
  return toAsciiDigits(input)
    .normalize("NFKC")
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[×xX*]\s*(?=\d)/g, " x ")
    .replace(/[^\p{L}\p{N}.\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  // Arabic marketing filler
  "جديد", "اصلي", "عرض", "خصم", "افضل", "جودة", "عاليه", "عالية", "ممتاز", "من", "في", "علي", "على", "مع", "و",
  "ال", "الى", "الي", "لل", "حصري", "متوفر", "توصيل", "مجاني", "قطعه", "قطعة", "سعر", "جمله", "جملة", "الجمله",
  // English filler
  "new", "original", "best", "high", "quality", "premium", "hot", "sale", "for", "with", "and", "the", "of", "a", "free",
  "shipping", "pcs", "piece", "pack", "set",
]);

export function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(" ")
    .map((t) => t.replace(/^ال(?=\p{L}{3,})/u, "")) // strip Arabic definite article on longer words
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface ExtractedAttributes {
  capacityMl?: number;
  dimensionsCm?: number[]; // sorted, so 20x30 == 30x20
  wattage?: number;
  batteryMah?: number;
  packCount?: number;
  weightG?: number;
  modelNumber?: string;
  colors?: string[];
  materials?: string[];
}

const COLOR_MAP: Record<string, string> = {
  اسود: "black", black: "black", ابيض: "white", white: "white", احمر: "red", red: "red", ازرق: "blue", blue: "blue",
  اخضر: "green", green: "green", اصفر: "yellow", yellow: "yellow", وردي: "pink", بينك: "pink", pink: "pink",
  رمادي: "gray", رصاصي: "gray", gray: "gray", grey: "gray", بني: "brown", brown: "brown", بيج: "beige", beige: "beige",
  فضي: "silver", silver: "silver", ذهبي: "gold", gold: "gold", بنفسجي: "purple", موف: "purple", purple: "purple",
  برتقالي: "orange", orange: "orange", شفاف: "transparent", transparent: "transparent", clear: "transparent",
};
const MATERIAL_MAP: Record<string, string> = {
  ستانلس: "stainless", stainless: "stainless", استانلس: "stainless", بلاستيك: "plastic", plastic: "plastic",
  زجاج: "glass", glass: "glass", خشب: "wood", wood: "wood", wooden: "wood", سيليكون: "silicone", silicone: "silicone",
  قطن: "cotton", cotton: "cotton", جلد: "leather", leather: "leather", المنيوم: "aluminum", aluminum: "aluminum",
  aluminium: "aluminum", سيراميك: "ceramic", ceramic: "ceramic", صاج: "steel", steel: "steel", حديد: "iron", iron: "iron",
};

function num(s: string): number {
  return Number(s.replace(",", "."));
}

export function extractAttributes(input: string): ExtractedAttributes {
  const t = normalizeText(input);
  const out: ExtractedAttributes = {};

  const ml = t.match(/(\d+(?:\.\d+)?)\s*(ml|مل|ملي|مللي)(?![\p{L}\p{N}])/u);
  const liters = t.match(/(\d+(?:\.\d+)?)\s*(l|liter|litre|لتر|ليتر)(?![\p{L}\p{N}])/u);
  if (ml) out.capacityMl = num(ml[1]);
  else if (liters) out.capacityMl = Math.round(num(liters[1]) * 1000);

  const dims = t.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))?\s*(cm|سم|mm|مم|m|متر)?/);
  if (dims) {
    const factor = dims[4] === "mm" || dims[4] === "مم" ? 0.1 : dims[4] === "m" || dims[4] === "متر" ? 100 : 1;
    out.dimensionsCm = [dims[1], dims[2], dims[3]]
      .filter(Boolean)
      .map((v) => Math.round(num(v!) * factor * 10) / 10)
      .sort((a, b) => a - b);
  } else {
    const single = t.match(/(\d+(?:\.\d+)?)\s*(cm|سم|سنتي|سنتيمتر)(?![\p{L}\p{N}])/u);
    if (single) out.dimensionsCm = [num(single[1])];
  }

  const watt = t.match(/(\d+(?:\.\d+)?)\s*(w|watt|وات)(?![\p{L}\p{N}])/u);
  if (watt) out.wattage = num(watt[1]);
  const mah = t.match(/(\d+)\s*(mah|مللي امبير|ملي امبير)(?![\p{L}\p{N}])/u);
  if (mah) out.batteryMah = num(mah[1]);
  const pack = t.match(/(?:(\d+)\s*(?:pcs|pieces|قطع|قطعه|حبه|حبات)(?![\p{L}\p{N}]))|(?:(?<![\p{L}\p{N}])(?:pack|set|طقم)\s*(?:of\s*)?(\d+)(?![\p{L}\p{N}]))/u);
  if (pack) out.packCount = num(pack[1] ?? pack[2]);
  const kg = t.match(/(\d+(?:\.\d+)?)\s*(kg|كيلو|كجم)(?![\p{L}\p{N}])/u);
  const g = t.match(/(\d+(?:\.\d+)?)\s*(g|gm|جرام|جم)(?![\p{L}\p{N}])/u);
  if (kg) out.weightG = Math.round(num(kg[1]) * 1000);
  else if (g) out.weightG = num(g[1]);

  // Model numbers: tokens mixing letters and digits, e.g. "a12", "xr-500", "k15 pro"
  const model = t.match(/(?<![\p{L}\p{N}])([a-z]{1,4}-?\d{2,5}[a-z]{0,3})(?![\p{L}\p{N}])/u);
  if (model && !/^(\d+)(ml|cm|mm|w|mah|kg|g|gm|l)$/.test(model[1])) out.modelNumber = model[1].replace("-", "");

  const words = t.split(" ");
  const colors = [...new Set(words.map((w) => COLOR_MAP[w.replace(/^ال/, "")]).filter(Boolean))];
  if (colors.length) out.colors = colors.sort();
  const materials = [...new Set(words.map((w) => MATERIAL_MAP[w.replace(/^ال/, "")]).filter(Boolean))];
  if (materials.length) out.materials = materials.sort();

  return out;
}

/** Deterministic key from distinguishing attributes; same physical variant -> same key. */
export function variantKey(attrs: ExtractedAttributes): string {
  const parts: string[] = [];
  if (attrs.capacityMl !== undefined) parts.push(`cap:${attrs.capacityMl}ml`);
  if (attrs.dimensionsCm) parts.push(`dim:${attrs.dimensionsCm.join("x")}cm`);
  if (attrs.wattage !== undefined) parts.push(`w:${attrs.wattage}`);
  if (attrs.batteryMah !== undefined) parts.push(`mah:${attrs.batteryMah}`);
  if (attrs.packCount !== undefined) parts.push(`pack:${attrs.packCount}`);
  if (attrs.weightG !== undefined) parts.push(`wt:${attrs.weightG}g`);
  if (attrs.modelNumber) parts.push(`model:${attrs.modelNumber}`);
  if (attrs.materials?.length) parts.push(`mat:${attrs.materials.join("+")}`);
  if (attrs.colors?.length) parts.push(`color:${attrs.colors.join("+")}`);
  return parts.length ? parts.join("|") : "base";
}

function close(a: number, b: number, tolerance: number) {
  return Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b));
}

/** Returns human-readable conflicts between two attribute sets (empty = compatible). */
export function attributeConflicts(a: ExtractedAttributes, b: ExtractedAttributes): string[] {
  const c: string[] = [];
  if (a.capacityMl !== undefined && b.capacityMl !== undefined && !close(a.capacityMl, b.capacityMl, 0.02))
    c.push(`السعة مختلفة (${a.capacityMl} مل مقابل ${b.capacityMl} مل)`);
  if (a.dimensionsCm && b.dimensionsCm) {
    const same =
      a.dimensionsCm.length === b.dimensionsCm.length &&
      a.dimensionsCm.every((v, i) => close(v, b.dimensionsCm![i], 0.03));
    if (!same) c.push(`المقاس مختلف (${a.dimensionsCm.join("×")} مقابل ${b.dimensionsCm.join("×")} سم)`);
  }
  if (a.wattage !== undefined && b.wattage !== undefined && a.wattage !== b.wattage)
    c.push(`القدرة مختلفة (${a.wattage}W مقابل ${b.wattage}W)`);
  if (a.batteryMah !== undefined && b.batteryMah !== undefined && a.batteryMah !== b.batteryMah)
    c.push(`البطارية مختلفة (${a.batteryMah} مقابل ${b.batteryMah} mAh)`);
  if (a.packCount !== undefined && b.packCount !== undefined && a.packCount !== b.packCount)
    c.push(`عدد القطع مختلف (${a.packCount} مقابل ${b.packCount})`);
  if (a.weightG !== undefined && b.weightG !== undefined && !close(a.weightG, b.weightG, 0.05))
    c.push(`الوزن مختلف (${a.weightG} مقابل ${b.weightG} جم)`);
  if (a.modelNumber && b.modelNumber && a.modelNumber !== b.modelNumber)
    c.push(`الموديل مختلف (${a.modelNumber} مقابل ${b.modelNumber})`);
  if (a.materials?.length && b.materials?.length && !a.materials.some((m) => b.materials!.includes(m)))
    c.push(`الخامة مختلفة (${a.materials.join("/")} مقابل ${b.materials.join("/")})`);
  if (a.colors?.length && b.colors?.length && !a.colors.some((m) => b.colors!.includes(m)))
    c.push(`اللون مختلف (${a.colors.join("/")} مقابل ${b.colors.join("/")})`);
  return c;
}

/** Character-trigram Dice coefficient on normalized, de-stopworded text (robust to spelling variants). */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = ` ${tokenize(s).sort().join(" ")} `;
    const set = new Map<string, number>();
    for (let i = 0; i < t.length - 2; i++) {
      const g = t.slice(i, i + 3);
      set.set(g, (set.get(g) ?? 0) + 1);
    }
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) {
    inter += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total === 0 ? 0 : (2 * inter) / total;
}

export function tokenJaccard(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export type MatchDecision = "probable" | "possible" | "different" | "conflict";

export interface MatchResult {
  decision: MatchDecision;
  similarity: number;
  conflicts: string[];
  reasons: string[];
}

/**
 * Compare a candidate listing title against a known variant description.
 * `extraAliases` lets the owner register alternative names (e.g. Arabic + English titles).
 */
export function matchListing(candidate: string, reference: string, extraAliases: string[] = []): MatchResult {
  const conflicts = attributeConflicts(extractAttributes(candidate), extractAttributes(reference));
  const similarity = Math.max(
    ...[reference, ...extraAliases].map((r) => Math.max(trigramSimilarity(candidate, r), tokenJaccard(candidate, r))),
  );
  const rounded = Math.round(similarity * 100) / 100;
  if (conflicts.length) {
    return { decision: "conflict", similarity: rounded, conflicts, reasons: ["سمات مميِّزة متعارضة — لا يمكن الدمج"] };
  }
  if (similarity >= 0.6) {
    return { decision: "probable", similarity: rounded, conflicts, reasons: ["تشابه عالٍ في الاسم بدون تعارض في السمات — يحتاج تأكيد المالك"] };
  }
  if (similarity >= 0.35) {
    return { decision: "possible", similarity: rounded, conflicts, reasons: ["تشابه جزئي — راجع المواصفات"] };
  }
  return { decision: "different", similarity: rounded, conflicts, reasons: ["تشابه ضعيف"] };
}

/** Stable key for a product name, used for duplicate detection of discoveries. */
export function productKey(nameAr: string, nameEn?: string | null): string {
  return [...new Set(tokenize(`${nameAr} ${nameEn ?? ""}`))].sort().join(" ");
}

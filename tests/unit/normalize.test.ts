import { describe, it, expect } from "vitest";
import { normalizeText, extractAttributes, variantKey, matchListing, productKey } from "@/lib/domain/normalize";

describe("normalizeText", () => {
  it("unifies Arabic letter forms, removes diacritics/tatweel and converts digits", () => {
    expect(normalizeText("زُجاجـــة مِيــاه ٥٠٠ مل")).toBe("زجاجه مياه 500 مل");
    expect(normalizeText("إبريق أصلي")).toBe("ابريق اصلي");
  });
});

describe("extractAttributes", () => {
  it("extracts capacity in ml and liters", () => {
    expect(extractAttributes("زجاجة مياه ٥٠٠ مل").capacityMl).toBe(500);
    expect(extractAttributes("Water bottle 1.5L stainless").capacityMl).toBe(1500);
  });
  it("extracts dimensions regardless of order and units", () => {
    expect(extractAttributes("منظم ٣٠×٢٠ سم").dimensionsCm).toEqual([20, 30]);
    expect(extractAttributes("organizer 200x300mm").dimensionsCm).toEqual([20, 30]);
  });
  it("extracts colors and materials in both languages", () => {
    const a = extractAttributes("كوب ستانلس اسود");
    expect(a.colors).toEqual(["black"]);
    expect(a.materials).toEqual(["stainless"]);
  });
  it("extracts model numbers and battery", () => {
    const a = extractAttributes("Mini fan K15 4000mAh");
    expect(a.modelNumber).toBe("k15");
    expect(a.batteryMah).toBe(4000);
  });
});

describe("matchListing", () => {
  it("matches the same product written in Arabic variants", () => {
    const r = matchListing("زجاجة مياه ستانلس ٥٠٠ مل", "زجاجه مياه استانلس 500ml");
    expect(r.conflicts).toEqual([]);
    expect(["probable", "possible"]).toContain(r.decision);
  });
  it("never merges different capacities even with identical names", () => {
    const r = matchListing("زجاجة مياه ستانلس 500 مل", "زجاجة مياه ستانلس 750 مل");
    expect(r.decision).toBe("conflict");
    expect(r.conflicts[0]).toContain("السعة");
  });
  it("never merges different model numbers or dimensions", () => {
    expect(matchListing("Mini fan K15", "Mini fan K20").decision).toBe("conflict");
    expect(matchListing("منظم أدراج 30x20 سم", "منظم أدراج 40x20 سم").decision).toBe("conflict");
  });
  it("rejects unrelated products", () => {
    expect(matchListing("سماعة بلوتوث", "حامل موبايل للعربية").decision).toBe("different");
  });
});

describe("variantKey / productKey", () => {
  it("is deterministic and order-independent", () => {
    expect(variantKey(extractAttributes("30x20 سم اسود"))).toBe(variantKey(extractAttributes("black 20×30cm")));
    expect(productKey("زجاجة مياه", "Water Bottle")).toBe(productKey("زجاجه المياه", "water bottle"));
  });
});

import "./_env";
import bcrypt from "bcryptjs";
import { createSql } from "../src/lib/db/client";
import { assertDemoDatabase } from "./seed-guard";
import type { Actor } from "../src/lib/services/audit";
import { recordCapital } from "../src/lib/services/cash";
import { createProductWithVariant, setVariantVerified } from "../src/lib/services/catalog";
import { ingestTrendSignals, linkSignalToProduct } from "../src/lib/services/trends";
import { addRetailOffer, setRetailMatch } from "../src/lib/services/retail";
import { addSupplierOffer, createSupplier, ingestTelegramPosts, recordVerification, setOfferMatch } from "../src/lib/services/suppliers";
import { refreshAllOpportunities } from "../src/lib/services/analysis";
import { approvePurchase, receivePurchaseOrder, recordPoPayment, requestPurchase } from "../src/lib/services/purchasing";
import { createOrder, transitionOrder } from "../src/lib/services/orders";
import { addExpense } from "../src/lib/services/expenses";

/**
 * DEMO DATA ONLY. Refuses to run unless the database is stamped 'demo'.
 * Every URL points to example.invalid and every name is illustrative — nothing here is market research.
 */
async function main() {
  const sql = createSql();
  try {
    await assertDemoDatabase(sql);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM products`;
    if (n > 0) { console.log("Demo data already present."); return; }

    const email = process.env.DEMO_ADMIN_EMAIL ?? "demo@safqa.local";
    const password = process.env.DEMO_ADMIN_PASSWORD ?? "demo-password-123";
    const [u] = await sql<{ id: number }[]>`INSERT INTO users (email, name, password_hash, role) VALUES (${email}, 'مالك تجريبي', ${bcrypt.hashSync(password, 10)}, 'owner')
      ON CONFLICT (lower(email)) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    const owner: Actor = { id: u.id, label: `owner:${email}` };
    const day = (d: number) => new Date(Date.now() - d * 86_400_000);

    await recordCapital(sql, owner, 5000, "رأس مال تجريبي");

    const p1 = await createProductWithVariant(sql, owner, { nameAr: "منظم أدراج قابل للطي (مثال)", nameEn: "Foldable drawer organizer (example)", category: "منزل" },
      { label: "30×20 سم رمادي", dimensions: "30×20 سم", color: "رمادي", material: "قماش", weightGrams: 180 });
    const p2 = await createProductWithVariant(sql, owner, { nameAr: "زجاجة مياه حرارية (مثال)", nameEn: "Insulated bottle (example)", category: "مطبخ" },
      { label: "500 مل أسود", capacity: "500 مل", color: "أسود", material: "ستانلس", weightGrams: 320 });
    const p3 = await createProductWithVariant(sql, owner, { nameAr: "سيروم فيتامين سي (مثال)", category: "تجميل", riskCategory: "cosmetics" },
      { label: "30 مل", capacity: "30 مل" });

    const t = await ingestTrendSignals(sql, owner, { sourceCode: "manual_entry", method: "manual_entry", items: [
      { title: "منظم أدراج قابل للطي (مثال)", platform: "tiktok", sourceUrl: "https://example.invalid/tiktok/1", region: "EG", metricType: "views", metricValue: 380000, previousValue: 95000, evidenceType: "measured", discoveredAt: day(1) },
      { title: "منظم أدراج قابل للطي (مثال)", platform: "facebook", sourceUrl: "https://example.invalid/fb-ads/1", region: "EG", metricType: "ad_count", metricValue: 14, previousValue: 6, evidenceType: "measured", discoveredAt: day(2) },
      { title: "زجاجة مياه حرارية (مثال)", platform: "instagram", sourceUrl: "https://example.invalid/ig/2", region: "EG", evidenceType: "owner_reported", discoveredAt: day(3), notes: "ملاحظة: إعلانات متكررة من متاجر محلية" },
      { title: "سيروم فيتامين سي (مثال)", platform: "ai", region: "GLOBAL", evidenceType: "ai_hypothesis", discoveredAt: day(0), notes: "فرضية بدون أرقام — تحتاج تحقق" },
      { title: "حامل موبايل مغناطيسي للعربية (مثال)", platform: "google_trends", sourceUrl: "https://example.invalid/trends/3", region: "EG", metricType: "search_interest", metricValue: 72, previousValue: 40, evidenceType: "measured", discoveredAt: day(0) },
    ] });
    await linkSignalToProduct(sql, owner, t.signalIds[0], p1.productId);
    await linkSignalToProduct(sql, owner, t.signalIds[1], p1.productId);
    await linkSignalToProduct(sql, owner, t.signalIds[2], p2.productId);
    await linkSignalToProduct(sql, owner, t.signalIds[3], p3.productId);

    const retail: [number, string, number, number | null, string][] = [
      [p1.variantId, "amazon_eg", 239, 0, "منظم أدراج قابل للطي 30×20 سم"], [p1.variantId, "noon", 255, 25, "منظم أدراج 30x20cm"], [p1.variantId, "jumia", 229, 30, "منظم ادراج قماش 30 × 20"],
      [p1.variantId, "facebook_page", 210, 45, "منظم أدراج"], [p1.variantId, "noon", 189, 25, "منظم أدراج 40×30 سم"],
      [p2.variantId, "amazon_eg", 349, 0, "زجاجة مياه ستانلس 500 مل"], [p2.variantId, "jumia", 299, 35, "زجاجه حراريه 500ml"],
    ];
    for (const [i, [v, retailer, price, ship, title]] of retail.entries()) {
      const r = await addRetailOffer(sql, owner, { variantId: v, retailer, url: `https://example.invalid/retail/${i}`, titleRaw: title, listedPrice: price, shippingCost: ship, observedAt: day(i % 3) });
      if (r.matchStatus !== "mismatch") await setRetailMatch(sql, owner, r.id, "exact");
    }

    const s1 = await createSupplier(sql, owner, { name: "مورد الموسكي (مثال)", marketArea: "mosky", phone: "01000000000", reliabilityRating: 4, telegramChatId: "-1000000000001", returnPolicy: "استبدال خلال 3 أيام للعيوب" });
    const s2 = await createSupplier(sql, owner, { name: "مورد العتبة (مثال)", marketArea: "ataba", whatsapp: "01100000000" });
    const o1 = (await addSupplierOffer(sql, owner, { supplierId: s1, variantId: p1.variantId, titleRaw: "منظم أدراج 30×20 رمادي — السعر 62 ج — أقل كمية 12", quotedPrice: 62, minOrderQty: 12 }))!;
    await addSupplierOffer(sql, owner, { supplierId: s2, variantId: p2.variantId, titleRaw: "زجاجة ستانلس 500 مل", quotedPrice: 140, minOrderQty: 6 });
    await recordVerification(sql, owner, { supplierOfferId: o1, method: "whatsapp", result: "available", confirmedPrice: 60, confirmedQuantity: 80, confirmedMoq: 12, notes: "تأكيد تجريبي" });
    await setOfferMatch(sql, owner, o1, p1.variantId, "confirmed");
    await setVariantVerified(sql, owner, p1.variantId, true);
    await ingestTelegramPosts(sql, { id: null, label: "n8n" }, [
      { chatId: "-1000000000001", chatUsername: "example_supplier", messageId: 501, date: Math.floor(Date.now() / 1000) - 3600, text: "زجاجة مياه حرارية ستانلس 500 مل اسود\nالسعر 135 جنيه\nاقل كمية 6" },
      { chatId: "-1000000000001", chatUsername: "example_supplier", messageId: 502, date: Math.floor(Date.now() / 1000) - 1800, text: "وصل جديد حامل موبايل مغناطيسي\nالدستة 420 ج" },
    ]);
    await refreshAllOpportunities(sql);

    const req = await requestPurchase(sql, owner, { variantId: p1.variantId, supplierOfferId: o1, quantity: 20, sellingPrice: 215 });
    if (req.gatesPassed) {
      const ap = await approvePurchase(sql, owner as Actor & { role: string }, req.decisionId);
      if (ap.approved) {
        await recordPoPayment(sql, owner, ap.purchaseOrderId, 1200);
        await receivePurchaseOrder(sql, owner, ap.purchaseOrderId, { quantity: 20, actualPickupCost: 40 });
        await addExpense(sql, owner, { category: "advertising", amount: 150, description: "حملة فيسبوك تجريبية", variantId: p1.variantId });
        const names = ["عميل تجريبي 1", "عميل تجريبي 2", "عميل تجريبي 3"];
        for (const [i, name] of names.entries()) {
          const o = await createOrder(sql, owner, { customer: { name, phone: `0120000000${i}`, city: "القاهرة" }, items: [{ variantId: p1.variantId, quantity: 1, unitPrice: 215 }], shippingFeeCharged: 50 });
          await transitionOrder(sql, owner, o.orderId, "confirmed");
          if (i < 2) {
            await transitionOrder(sql, owner, o.orderId, "packed", { packagingCost: 8 });
            await transitionOrder(sql, owner, o.orderId, "shipped", { carrier: "شركة شحن (مثال)", carrierCost: 60 });
            await transitionOrder(sql, owner, o.orderId, i === 0 ? "delivered" : "failed_delivery", i === 0 ? { collected: true, collectionFee: 2.65 } : { returnCost: 30 });
          }
        }
      }
    } else {
      console.log("Demo purchase gates:", req.gates.filter((g) => !g.passed));
    }
    await refreshAllOpportunities(sql);
    console.log(`Demo data seeded. Login: ${email} / ${password}`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });

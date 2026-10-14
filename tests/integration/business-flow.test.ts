import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "@/lib/db/client";
import { freshDb } from "./helpers";
import type { Actor } from "@/lib/services/audit";
import { recordCapital, getCashPosition } from "@/lib/services/cash";
import { createProductWithVariant, setVariantVerified, findSimilarProducts } from "@/lib/services/catalog";
import { ingestTrendSignals, linkSignalToProduct, parseTrendCsv } from "@/lib/services/trends";
import { addRetailOffer, setRetailMatch, retailStatsForVariant } from "@/lib/services/retail";
import { createSupplier, addSupplierOffer, recordVerification, setOfferMatch, ingestTelegramPosts, refreshOfferFreshness } from "@/lib/services/suppliers";
import { refreshOpportunity, analyzeVariant } from "@/lib/services/analysis";
import { requestPurchase, approvePurchase, recordPoPayment, receivePurchaseOrder } from "@/lib/services/purchasing";
import { createOrder, transitionOrder, recordReturn, orderActuals, reconcileOrder } from "@/lib/services/orders";
import { addExpense } from "@/lib/services/expenses";
import { updateSetting, getSettings } from "@/lib/services/settings";
import { DomainError } from "@/lib/services/errors";

let sql: Sql;
let owner: Actor & { role: string };
let variantId: number;
let productId: number;
let supplierId: number;
let offerId: number;
let poId: number;

beforeAll(async () => {
  ({ sql, owner } = await freshDb());
});
afterAll(async () => {
  await sql.end();
});

describe("SAFQA end-to-end business flow", () => {
  it("records real capital in the cash ledger", async () => {
    const before = await getCashPosition(sql);
    expect(before.hasCapitalRecorded).toBe(false);
    await recordCapital(sql, owner, 5000, "رأس المال المبدئي");
    const after = await getCashPosition(sql);
    expect(after.cashBalance).toBe(5000);
    expect(after.inventoryBudgetRemaining).toBe(2500);
  });

  it("[AC1] enters a real product through the form service and detects duplicates", async () => {
    const r = await createProductWithVariant(sql, owner,
      { nameAr: "زجاجة مياه ستانلس", nameEn: "Stainless water bottle", category: "kitchen" },
      { label: "500 مل أسود", capacity: "500 مل", color: "أسود", material: "ستانلس", weightGrams: 300 });
    variantId = r.variantId;
    productId = r.productId;
    const similar = await findSimilarProducts(sql, "زجاجه مياه استانلس");
    expect(similar[0]?.id).toBe(productId);
  });

  it("[AC2] preserves source URL, timestamp and method; re-ingestion is idempotent", async () => {
    const item = {
      title: "زجاجة مياه ستانلس", platform: "tiktok", sourceUrl: "https://www.tiktok.com/@shop/video/123", region: "EG",
      metricType: "views", metricValue: 400000, previousValue: 100000, evidenceType: "measured", discoveredAt: new Date().toISOString(),
    };
    const first = await ingestTrendSignals(sql, owner, { sourceCode: "manual_entry", method: "manual_entry", items: [item] });
    expect(first.created).toBe(1);
    const again = await ingestTrendSignals(sql, owner, { sourceCode: "manual_entry", method: "manual_entry", items: [item] });
    expect(again.created).toBe(0);
    expect(again.duplicate).toBe(1);
    const [sig] = await sql<{ source_url: string; collection_method: string; discovered_at: Date; measured_growth_pct: number }[]>`
      SELECT source_url, collection_method, discovered_at, measured_growth_pct FROM trend_signals WHERE id = ${first.signalIds[0]}`;
    expect(sig.source_url).toBe(item.sourceUrl);
    expect(sig.collection_method).toBe("manual_entry");
    expect(sig.discovered_at).toBeInstanceOf(Date);
    expect(sig.measured_growth_pct).toBe(300);
    await linkSignalToProduct(sql, owner, first.signalIds[0], productId);
  });

  it("rejects measured signals without a URL and AI hypotheses can't carry measured numbers", async () => {
    const r = await ingestTrendSignals(sql, owner, { sourceCode: "manual_entry", method: "manual_entry", items: [
      { title: "منتج بدون رابط", platform: "facebook", evidenceType: "measured", metricValue: 10 },
    ] });
    expect(r.failed).toBe(1);
    const h = await ingestTrendSignals(sql, owner, { sourceCode: "manual_entry", method: "manual_entry", items: [
      { title: "فرضية", platform: "ai", evidenceType: "ai_hypothesis", metricValue: 999, previousValue: 1, sourceUrl: "https://example.com/x" },
    ] });
    const [s] = await sql<{ measured_growth_pct: number | null; metric_value: number | null }[]>`SELECT measured_growth_pct, metric_value FROM trend_signals WHERE id = ${h.signalIds[0]}`;
    expect(s).toEqual({ measured_growth_pct: null, metric_value: null });
  });

  it("parses trend CSV exports", () => {
    const { items, errors } = parseTrendCsv('title,platform,evidence_type,url,metric_value\n"منظم, أدراج",google_trends,measured,https://trends.google.com/x,"1,200"\n');
    expect(errors).toEqual([]);
    expect(items[0]).toMatchObject({ title: "منظم, أدراج", platform: "google_trends", metricValue: 1200 });
  });

  it("refuses ingestion from sources without authorized access", async () => {
    await expect(ingestTrendSignals(sql, owner, { sourceCode: "tiktok_research_api", method: "api", items: [] })).rejects.toThrow(DomainError);
  });

  it("[AC3] compares multiple retail offers for the exact same variant only", async () => {
    const now = Date.now();
    for (const [i, p] of [[1, 280], [2, 300], [3, 320]] as const) {
      const r = await addRetailOffer(sql, owner, { variantId, retailer: i === 1 ? "amazon_eg" : i === 2 ? "noon" : "jumia", url: `https://shop${i}.eg/p`,
        titleRaw: "زجاجة مياه ستانلس 500 مل", listedPrice: p, shippingCost: 0, observedAt: new Date(now - i * 3600_000) });
      await setRetailMatch(sql, owner, r.id, "exact");
    }
    const wrong = await addRetailOffer(sql, owner, { variantId, retailer: "noon", url: "https://shop9.eg/p", titleRaw: "زجاجة مياه ستانلس 750 مل", listedPrice: 150 });
    expect(wrong.matchStatus).toBe("mismatch");
    const { stats } = await retailStatsForVariant(sql, variantId, 14);
    expect(stats.sampleSize).toBe(3);
    expect(stats.median).toBe(300);
  });

  it("[AC4] links a supplier offer to the product", async () => {
    supplierId = await createSupplier(sql, owner, { name: "محل الأمل", marketArea: "mosky", phone: "01000000000", reliabilityRating: 4, telegramChatId: "-100123" });
    offerId = (await addSupplierOffer(sql, owner, { supplierId, variantId, titleRaw: "زجاجة ستانلس 500 مل", quotedPrice: 60, minOrderQty: 6 }))!;
    const a = await analyzeVariant(sql, variantId);
    expect(a!.bestOffer!.id).toBe(offerId);
    expect(a!.bestOffer!.status).toBe("unverified");
  });

  it("[AC5] unverified stock prevents purchase approval", async () => {
    await refreshOpportunity(sql, variantId);
    const req = await requestPurchase(sql, owner, { variantId, supplierOfferId: offerId, quantity: 20, sellingPrice: 260 });
    expect(req.gatesPassed).toBe(false);
    const failed = req.gates.filter((g) => !g.passed && g.severity === "block").map((g) => g.code);
    expect(failed).toEqual(expect.arrayContaining(["supplier_verified", "variant_match"]));
    const res = await approvePurchase(sql, owner, req.decisionId);
    expect(res.approved).toBe(false);
    const [d] = await sql<{ status: string }[]>`SELECT status FROM purchase_decisions WHERE id = ${req.decisionId}`;
    expect(d.status).toBe("pending");
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM purchase_orders`;
    expect(n).toBe(0);
  });

  it("only humans can record verifications", async () => {
    await expect(recordVerification(sql, { id: null, label: "n8n" }, { supplierOfferId: offerId, method: "phone", result: "available", confirmedPrice: 60 }))
      .rejects.toThrow(/المالك/);
  });

  it("[AC6/AC7] profit calculations flag a negative-margin price", async () => {
    await recordVerification(sql, owner, { supplierOfferId: offerId, method: "whatsapp", result: "available", confirmedPrice: 60, confirmedQuantity: 100 });
    await setOfferMatch(sql, owner, offerId, variantId, "confirmed");
    await setVariantVerified(sql, owner, variantId, true);
    await refreshOpportunity(sql, variantId);
    const req = await requestPurchase(sql, owner, { variantId, supplierOfferId: offerId, quantity: 20, sellingPrice: 100 });
    expect(req.gatesPassed).toBe(false);
    expect(req.gates.find((g) => g.code === "unit_economics")!.passed).toBe(false);
  });

  it("[AC8] budget limits prevent overspending", async () => {
    // 30 units * 60 + pickup 50 = 1850 > per-product cap 1500
    const req = await requestPurchase(sql, owner, { variantId, supplierOfferId: offerId, quantity: 30, sellingPrice: 260 });
    expect(req.gates.find((g) => g.code === "per_product_cap")!.passed).toBe(false);
    const s = await getSettings(sql);
    await updateSetting(sql, owner, "capital", { ...s.capital, allocations: { ...s.capital.allocations, inventory: 500 } });
    const req2 = await requestPurchase(sql, owner, { variantId, supplierOfferId: offerId, quantity: 20, sellingPrice: 260 });
    expect(req2.gates.find((g) => g.code === "inventory_budget")!.passed).toBe(false);
    await updateSetting(sql, owner, "capital", s.capital);
  });

  it("[AC9] owner approval generates an actionable purchase order", async () => {
    const a = await refreshOpportunity(sql, variantId);
    expect(a!.score.confidence).not.toBe("low");
    const req = await requestPurchase(sql, owner, { variantId, supplierOfferId: offerId, quantity: 20, sellingPrice: 260 });
    expect(req.gates.filter((g) => !g.passed)).toEqual([]);
    expect(req.gatesPassed).toBe(true);
    await expect(approvePurchase(sql, { id: null, label: "n8n" }, req.decisionId)).rejects.toThrow(DomainError);
    const res = await approvePurchase(sql, owner, req.decisionId);
    expect(res.approved).toBe(true);
    poId = (res as { purchaseOrderId: number }).purchaseOrderId;
    const [po] = await sql<{ total_cost: number; quantity_ordered: number; status: string }[]>`SELECT total_cost, quantity_ordered, status FROM purchase_orders WHERE id = ${poId}`;
    expect(po).toEqual({ total_cost: 1200, quantity_ordered: 20, status: "ordered" });
    const cash = await getCashPosition(sql);
    expect(cash.committedUnpaid).toBe(1200);
    expect(cash.freeCash).toBe(3800);
    // A second approval of the same decision is impossible
    await expect(approvePurchase(sql, owner, req.decisionId)).rejects.toThrow(/قرار/);
    const [audit] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'purchase_decision.approve'`;
    expect(audit.n).toBe(1);
  });

  it("[AC10] received goods update inventory with landed cost", async () => {
    await recordPoPayment(sql, owner, poId, 1200);
    await expect(recordPoPayment(sql, owner, poId, 1)).rejects.toThrow(/يتجاوز/);
    await receivePurchaseOrder(sql, owner, poId, { quantity: 20, actualPickupCost: 50 });
    const [lvl] = await sql<{ on_hand: number; avg_unit_cost: number; total_received: number }[]>`SELECT on_hand, avg_unit_cost, total_received FROM inventory_levels WHERE variant_id = ${variantId}`;
    expect(lvl).toEqual({ on_hand: 20, avg_unit_cost: 62.5, total_received: 20 });
    const cash = await getCashPosition(sql);
    expect(cash.cashBalance).toBe(5000 - 1200 - 50);
    expect(cash.committedUnpaid).toBe(0);
    expect(cash.inventoryAtCost).toBe(1250);
  });

  let orderId: number;
  it("[AC11] sales update stock and cash records correctly", async () => {
    const o = await createOrder(sql, owner, { customer: { name: "منى", phone: "01111111111", city: "الجيزة", address: "شارع 1" },
      items: [{ variantId, quantity: 2, unitPrice: 260 }], shippingFeeCharged: 50 });
    orderId = o.orderId;
    expect(o.totalDue).toBe(570);
    await transitionOrder(sql, owner, orderId, "confirmed");
    let [l] = await sql<{ on_hand: number; reserved: number; in_transit: number; sold: number }[]>`SELECT on_hand, reserved, in_transit, sold FROM inventory_levels WHERE variant_id = ${variantId}`;
    expect(l).toEqual({ on_hand: 20, reserved: 2, in_transit: 0, sold: 0 });
    await expect(transitionOrder(sql, owner, orderId, "delivered")).rejects.toThrow(/لا يمكن الانتقال/);
    await transitionOrder(sql, owner, orderId, "packed", { packagingCost: 8 });
    await transitionOrder(sql, owner, orderId, "shipped", { carrier: "Bosta", carrierCost: 60 });
    [l] = await sql<{ on_hand: number; reserved: number; in_transit: number; sold: number }[]>`SELECT on_hand, reserved, in_transit, sold FROM inventory_levels WHERE variant_id = ${variantId}`;
    expect(l).toEqual({ on_hand: 18, reserved: 0, in_transit: 2, sold: 0 });
    await transitionOrder(sql, owner, orderId, "delivered", { collected: true, collectionFee: 5.7 });
    [l] = await sql<{ on_hand: number; reserved: number; in_transit: number; sold: number }[]>`SELECT on_hand, reserved, in_transit, sold FROM inventory_levels WHERE variant_id = ${variantId}`;
    expect(l).toEqual({ on_hand: 18, reserved: 0, in_transit: 0, sold: 2 });
    const cash = await getCashPosition(sql);
    expect(cash.cashBalance).toBe(5000 - 1200 - 50 - 8 - 60 + 570 - 5.7);
    const a = await orderActuals(sql, orderId);
    // 570 - 5.7 - 60 - 8 - 2*62.5
    expect(a.contribution).toBe(371.3);
  });

  it("prevents overselling at the database level", async () => {
    const o = await createOrder(sql, owner, { customer: { name: "علي", phone: "01222222222" }, items: [{ variantId, quantity: 50, unitPrice: 260 }] });
    await expect(transitionOrder(sql, owner, o.orderId, "confirmed")).rejects.toThrow(/المخزون غير كافٍ/);
    const [l] = await sql<{ reserved: number }[]>`SELECT reserved FROM inventory_levels WHERE variant_id = ${variantId}`;
    expect(l.reserved).toBe(0);
    await transitionOrder(sql, owner, o.orderId, "cancelled");
  });

  it("[AC12] returns reverse the inventory and financial entries", async () => {
    const before = await getCashPosition(sql);
    await recordReturn(sql, owner, orderId, { orderItemId: (await sql<{ id: number }[]>`SELECT id FROM order_items WHERE order_id = ${orderId}`)[0].id,
      quantity: 1, condition: "resellable", refundAmount: 260, returnShippingCost: 30 });
    const [l] = await sql<{ on_hand: number; sold: number; returned: number }[]>`SELECT on_hand, sold, returned FROM inventory_levels WHERE variant_id = ${variantId}`;
    expect(l).toEqual({ on_hand: 19, sold: 1, returned: 1 });
    const after = await getCashPosition(sql);
    expect(after.cashBalance).toBe(Math.round((before.cashBalance - 260 - 30) * 100) / 100);
    const a = await orderActuals(sql, orderId);
    // 570 - 5.7 - 260 refund - 60 - 30 - 8 - 1*62.5 (one unit came back resellable)
    expect(a.contribution).toBe(143.8);
    const rec = await reconcileOrder(sql, owner, orderId);
    expect(rec.contribution).toBe(143.8);
  });

  it("failed delivery restocks goods and records the return fee, with no revenue", async () => {
    const o = await createOrder(sql, owner, { customer: { name: "سارة", phone: "01033333333" }, items: [{ variantId, quantity: 1, unitPrice: 260 }], shippingFeeCharged: 50 });
    await transitionOrder(sql, owner, o.orderId, "confirmed");
    await transitionOrder(sql, owner, o.orderId, "packed");
    await transitionOrder(sql, owner, o.orderId, "shipped", { carrier: "Bosta", carrierCost: 60 });
    await transitionOrder(sql, owner, o.orderId, "failed_delivery", { returnCost: 30, reason: "رفض الاستلام" });
    const [l] = await sql<{ on_hand: number; in_transit: number }[]>`SELECT on_hand, in_transit FROM inventory_levels WHERE variant_id = ${variantId}`;
    expect(l).toEqual({ on_hand: 19, in_transit: 0 });
    const a = await orderActuals(sql, o.orderId);
    expect(a.collected).toBe(0);
    expect(a.contribution).toBe(-90);
  });

  it("expenses always hit the cash ledger; ledger is append-only", async () => {
    const before = await getCashPosition(sql);
    await addExpense(sql, owner, { category: "advertising", amount: 100, description: "إعلان فيسبوك تجريبي", variantId });
    const after = await getCashPosition(sql);
    expect(after.cashBalance).toBe(Math.round((before.cashBalance - 100) * 100) / 100);
    expect(after.adSpent).toBe(100);
    await expect(sql`UPDATE cash_ledger SET amount = 1`).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM audit_logs`).rejects.toThrow(/append-only/);
  });

  it("Telegram supplier posts: authorized chats only, parsed, deduplicated, matched as 'probable' (never confirmed)", async () => {
    const post = { chatId: "-100123", chatUsername: "amal_wholesale", messageId: 77, date: Math.floor(Date.now() / 1000),
      text: "زجاجة مياه ستانلس 500 مل اسود\nالسعر 58 جنيه\nاقل كمية 12" };
    const r = await ingestTelegramPosts(sql, { id: null, label: "n8n" }, [post, { ...post, chatId: "-999", messageId: 1 }]);
    expect(r.created).toBe(1);
    expect(r.ignored).toBe(1);
    const [o] = await sql<{ quoted_price: number; min_order_qty: number; match_status: string; variant_id: number; source_url: string; status: string }[]>`
      SELECT quoted_price, min_order_qty, match_status, variant_id, source_url, status FROM supplier_offers WHERE source_post_id = '-100123:77'`;
    expect(o).toMatchObject({ quoted_price: 58, min_order_qty: 12, match_status: "probable", variant_id: variantId, source_url: "https://t.me/amal_wholesale/77", status: "unverified" });
    const again = await ingestTelegramPosts(sql, { id: null, label: "n8n" }, [post]);
    expect(again.created).toBe(0);
    expect(again.duplicate).toBe(1);
  });

  it("supplier offers become stale automatically", async () => {
    await sql`UPDATE supplier_offers SET quoted_at = now() - interval '30 days' WHERE source_post_id = '-100123:77'`;
    const r = await refreshOfferFreshness(sql);
    expect(r.changed).toBeGreaterThanOrEqual(1);
    const [o] = await sql<{ status: string }[]>`SELECT status FROM supplier_offers WHERE source_post_id = '-100123:77'`;
    expect(o.status).toBe("stale");
  });
});

describe("integrations report errors visibly", () => {
  it("[AC13/AC14] Telegram: skipped when not configured, sent when configured, failure recorded", async () => {
    const { notify, dispatchPendingTelegram } = await import("@/lib/services/notifications");
    await sql`DELETE FROM notifications`;
    await notify(sql, { kind: "t", title: "اختبار", body: "1", channel: "telegram", dedupeKey: "t1" });
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(await dispatchPendingTelegram(sql)).toEqual({ sent: 0, failed: 0, skipped: 1 });

    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    process.env.TELEGRAM_OWNER_CHAT_ID = "42";
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }));
    await notify(sql, { kind: "t", title: "اختبار", body: "2", channel: "telegram", dedupeKey: "t2" });
    expect(await dispatchPendingTelegram(sql)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/bot123:abc/sendMessage");

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 }));
    await notify(sql, { kind: "t", title: "اختبار", body: "3", channel: "telegram", dedupeKey: "t3" });
    expect(await dispatchPendingTelegram(sql)).toEqual({ sent: 0, failed: 1, skipped: 0 });
    const [n] = await sql<{ status: string; error: string }[]>`SELECT status, error FROM notifications WHERE dedupe_key = 't3'`;
    expect(n).toEqual({ status: "failed", error: "Unauthorized" });
    const [i] = await sql<{ status: string; last_error: string }[]>`SELECT status, last_error FROM integration_status WHERE code = 'telegram'`;
    expect(i.status).toBe("error");
    fetchMock.mockRestore();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_OWNER_CHAT_ID;
  });

  it("[AC14] publishing without Meta credentials fails visibly and is never marked published", async () => {
    const { generateDrafts, setAssetStatus, schedulePost, approvePost, publishDuePosts } = await import("@/lib/services/marketing");
    const d = await generateDrafts(sql, owner, variantId, 260);
    expect(d.generatedBy).toBe("template");
    await setAssetStatus(sql, owner, d.captionIds[0], "approved");
    const postId = await schedulePost(sql, owner, { captionAssetId: d.captionIds[0], platform: "facebook", scheduledFor: new Date(Date.now() - 1000) });
    await approvePost(sql, owner, postId);
    const r = await publishDuePosts(sql, owner);
    expect(r.published).toBe(0);
    const [p] = await sql<{ status: string; error_message: string }[]>`SELECT status, error_message FROM scheduled_posts WHERE id = ${postId}`;
    expect(p.status).toBe("failed");
    expect(p.error_message).toContain("Meta");
    await expect(sql`UPDATE scheduled_posts SET status = 'published' WHERE id = ${postId}`).rejects.toThrow(/check constraint/);
  });

  it("job queue is idempotent and retries failures", async () => {
    const { enqueueJob, runReadyJobs, JOB_HANDLERS } = await import("@/lib/services/jobs");
    const a = await enqueueJob(sql, "refresh_freshness", {}, "fresh:test");
    const b = await enqueueJob(sql, "refresh_freshness", {}, "fresh:test");
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    const res = await runReadyJobs(sql);
    expect(res[0]).toMatchObject({ jobType: "refresh_freshness", status: "succeeded" });
    const orig = JOB_HANDLERS.low_stock_alerts;
    JOB_HANDLERS.low_stock_alerts = async () => { throw new Error("boom"); };
    await enqueueJob(sql, "low_stock_alerts", {}, "boom:1");
    const r2 = await runReadyJobs(sql);
    expect(r2[0]).toMatchObject({ status: "retry", error: "boom" });
    JOB_HANDLERS.low_stock_alerts = orig;
  });
});

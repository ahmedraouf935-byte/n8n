import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { Sql } from "@/lib/db/client";
import { freshDb } from "./helpers";
import type { Actor } from "@/lib/services/audit";
import { createProductWithVariant } from "@/lib/services/catalog";
import { addSupplierOffer, createSupplier } from "@/lib/services/suppliers";
import { detectDuplicateProducts, matchSupplierOffers, aiExtractSupplierPosts } from "@/lib/services/automation";
import { contentHash } from "@/lib/services/ingestion";

let sql: Sql;
let owner: Actor;
beforeAll(async () => { ({ sql, owner } = await freshDb()); });
afterAll(async () => { await sql.end(); });

describe("automation jobs", () => {
  it("re-matches unmatched supplier offers once a matching product exists (probable only)", async () => {
    const s = await createSupplier(sql, owner, { name: "مورد" });
    const offerId = (await addSupplierOffer(sql, owner, { supplierId: s, titleRaw: "شنطة لابتوب جلد 15 بوصة سوداء", quotedPrice: 150 }))!;
    expect((await matchSupplierOffers(sql)).suggested).toBe(0);
    const p = await createProductWithVariant(sql, owner, { nameAr: "شنطة لابتوب جلد" }, { label: "15 بوصة سوداء", material: "جلد", color: "اسود" });
    expect((await matchSupplierOffers(sql)).suggested).toBe(1);
    const [o] = await sql<{ variant_id: number; match_status: string }[]>`SELECT variant_id, match_status FROM supplier_offers WHERE id = ${offerId}`;
    expect(o).toEqual({ variant_id: p.variantId, match_status: "probable" });
  });

  it("flags likely duplicate products without merging them", async () => {
    await createProductWithVariant(sql, owner, { nameAr: "شنطه لاب توب جلد" }, { label: "15 بوصة" });
    const r = await detectDuplicateProducts(sql);
    expect(r.pairs).toBeGreaterThanOrEqual(1);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM products`;
    expect(n).toBe(2);
    const [{ k }] = await sql<{ k: number }[]>`SELECT count(*)::int AS k FROM notifications WHERE kind = 'possible_duplicate'`;
    expect(k).toBeGreaterThanOrEqual(1);
  });

  it("AI extraction skips cleanly when no API key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await aiExtractSupplierPosts(sql)).toEqual({ skipped: "ANTHROPIC_API_KEY not configured" });
  });

  it("content hashing is stable regardless of key order and includes nested values", () => {
    expect(contentHash({ a: 1, b: { c: 2, d: 3 } })).toBe(contentHash({ b: { d: 3, c: 2 }, a: 1 }));
    expect(contentHash({ a: 1, b: { c: 2 } })).not.toBe(contentHash({ a: 1, b: { c: 3 } }));
  });
});

describe("machine API authentication", () => {
  it("rejects missing/invalid bearer tokens and accepts the configured secret", async () => {
    process.env.N8N_WEBHOOK_SECRET = "x".repeat(32);
    const { authorizeMachine } = await import("@/lib/auth/apiAuth");
    const mk = (auth?: string) => new NextRequest("http://localhost/api/v1/jobs/tick", { method: "POST", headers: auth ? { authorization: auth } : {} });
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://safqa:safqa@localhost:5432/safqa_test";
    expect((await authorizeMachine(mk()))?.status).toBe(401);
    expect((await authorizeMachine(mk("Bearer nope")))?.status).toBe(401);
    expect(await authorizeMachine(mk(`Bearer ${"x".repeat(32)}`))).toBeNull();
    process.env.N8N_WEBHOOK_SECRET = "short";
    expect((await authorizeMachine(mk("Bearer short")))?.status).toBe(503);
  });
});

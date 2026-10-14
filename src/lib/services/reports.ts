import type { Db } from "../db/client";
import { formatEGP } from "../domain/money";
import { cairoDateKey } from "../domain/time";
import { getCashPosition } from "./cash";
import { lowStock } from "./inventory";

/** Overview metrics computed ONLY from recorded facts (ledger, orders, stock). */
export async function getOverview(db: Db) {
  const cash = await getCashPosition(db);
  const [sales] = await db<{ revenue: number; collected: number; refunds: number; delivered_orders: number; open_orders: number; pending_collection: number }[]>`
    SELECT
      COALESCE((SELECT SUM(subtotal - discount_total) FROM sales_orders WHERE status IN ('delivered','returned')),0) AS revenue,
      COALESCE((SELECT SUM(amount) FROM payments WHERE direction='in' AND status='collected'),0) AS collected,
      COALESCE((SELECT SUM(amount) FROM payments WHERE direction='refund'),0) AS refunds,
      (SELECT count(*)::int FROM sales_orders WHERE status = 'delivered') AS delivered_orders,
      (SELECT count(*)::int FROM sales_orders WHERE status IN ('new','confirmed','packed','shipped')) AS open_orders,
      COALESCE((SELECT SUM(amount) FROM payments WHERE direction='in' AND status='pending'),0) AS pending_collection`;
  const [costs] = await db<{ ads: number; ops: number; cogs: number; carrier: number }[]>`
    SELECT
      COALESCE((SELECT SUM(amount) FROM expenses WHERE category = 'advertising'),0) AS ads,
      COALESCE((SELECT SUM(amount) FROM expenses WHERE category <> 'advertising'),0) AS ops,
      COALESCE((SELECT SUM(oi.unit_cost_snapshot * (oi.quantity - COALESCE(r.q,0))) FROM order_items oi
        JOIN sales_orders so ON so.id = oi.order_id AND so.status IN ('delivered','returned')
        LEFT JOIN (SELECT order_item_id, SUM(quantity) q FROM returns WHERE kind='customer_return' AND condition='resellable' GROUP BY order_item_id) r ON r.order_item_id = oi.id),0) AS cogs,
      COALESCE((SELECT -SUM(amount) FROM cash_ledger WHERE entry_type IN ('carrier_cost','collection_fee')),0) AS carrier`;
  const [counts] = await db<{ active_products: number; pending_verifications: number; high_priority: number; pending_decisions: number; new_trends_today: number }[]>`
    SELECT
      (SELECT count(*)::int FROM products WHERE status IN ('testing','active')) AS active_products,
      (SELECT count(*)::int FROM supplier_offers WHERE status IN ('unverified','stale') AND variant_id IS NOT NULL) AS pending_verifications,
      (SELECT count(*)::int FROM opportunities o JOIN product_scores s ON s.id = o.latest_score_id
        WHERE s.band = 'high_priority' AND o.status NOT IN ('rejected','archived','approved')) AS high_priority,
      (SELECT count(*)::int FROM purchase_decisions WHERE status = 'pending') AS pending_decisions,
      (SELECT count(*)::int FROM trend_signals WHERE (discovered_at AT TIME ZONE 'Africa/Cairo')::date = (now() AT TIME ZONE 'Africa/Cairo')::date) AS new_trends_today`;
  const realizedContribution = sales.collected - sales.refunds - costs.cogs - costs.carrier - costs.ops - costs.ads;
  const [estimated] = await db<{ v: number }[]>`
    SELECT COALESCE(SUM((d.economics->'base'->'perShippedOrder'->>'contribution')::numeric * (d.economics->'base'->>'maxShippableOrders')::numeric * 0.75),0) AS v
    FROM purchase_decisions d WHERE d.status = 'approved'`;
  const daily = await db<{ day: string; collected: number; spent: number }[]>`
    SELECT d::date::text AS day,
      COALESCE((SELECT SUM(amount) FROM cash_ledger WHERE amount > 0 AND entry_type = 'customer_collection' AND (occurred_at AT TIME ZONE 'Africa/Cairo')::date = d::date),0) AS collected,
      COALESCE((SELECT -SUM(amount) FROM cash_ledger WHERE amount < 0 AND (occurred_at AT TIME ZONE 'Africa/Cairo')::date = d::date),0) AS spent
    FROM generate_series((now() AT TIME ZONE 'Africa/Cairo')::date - 13, (now() AT TIME ZONE 'Africa/Cairo')::date, '1 day') d`;
  return {
    cash, sales, costs, counts, daily,
    realizedContribution: Math.round(realizedContribution * 100) / 100,
    estimatedContribution: Math.round(estimated.v * 100) / 100,
    lowStock: await lowStock(db),
  };
}

export async function getFinancials(db: Db) {
  const bySku = await db<{ variant_id: number; sku: string; name_ar: string; units_sold: number; revenue: number; cogs: number; refunds: number; ads: number; other: number }[]>`
    SELECT v.id AS variant_id, v.sku, p.name_ar,
      COALESCE(SUM(oi.quantity - oi.returned_quantity) FILTER (WHERE so.status IN ('delivered','returned')),0)::int AS units_sold,
      COALESCE(SUM(oi.quantity * oi.unit_price) FILTER (WHERE so.status IN ('delivered','returned')),0) AS revenue,
      COALESCE(SUM(oi.unit_cost_snapshot * (oi.quantity - COALESCE(r.q,0))) FILTER (WHERE so.status IN ('delivered','returned')),0) AS cogs,
      COALESCE((SELECT SUM(rr.refund_amount) FROM returns rr JOIN order_items oo ON oo.id = rr.order_item_id WHERE oo.variant_id = v.id),0) AS refunds,
      COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.variant_id = v.id AND e.category = 'advertising'),0) AS ads,
      COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.variant_id = v.id AND e.category <> 'advertising'),0) AS other
    FROM product_variants v JOIN products p ON p.id = v.product_id
    LEFT JOIN order_items oi ON oi.variant_id = v.id
    LEFT JOIN sales_orders so ON so.id = oi.order_id
    LEFT JOIN (SELECT order_item_id, SUM(quantity) q FROM returns WHERE kind='customer_return' AND condition='resellable' GROUP BY order_item_id) r ON r.order_item_id = oi.id
    WHERE EXISTS (SELECT 1 FROM inventory_levels l WHERE l.variant_id = v.id AND l.total_received > 0)
    GROUP BY v.id, v.sku, p.name_ar ORDER BY revenue DESC`;
  const byCampaign = await db<{ id: number; name: string; platform: string; campaign_type: string; spend: number; orders: number; revenue: number }[]>`
    SELECT c.id, c.name, c.platform, c.campaign_type, c.spend,
      (SELECT count(*)::int FROM sales_orders so WHERE so.campaign_id = c.id AND so.status IN ('delivered','returned')) AS orders,
      COALESCE((SELECT SUM(subtotal - discount_total) FROM sales_orders so WHERE so.campaign_id = c.id AND so.status = 'delivered'),0) AS revenue
    FROM campaign_results c ORDER BY c.start_date DESC`;
  const ledger = await db<{ entry_type: string; total: number }[]>`SELECT entry_type, SUM(amount) AS total FROM cash_ledger GROUP BY entry_type ORDER BY entry_type`;
  const expensesByCat = await db<{ category: string; total: number }[]>`SELECT category, SUM(amount) AS total FROM expenses GROUP BY category ORDER BY total DESC`;
  const [turn] = await db<{ cogs_30: number; inv_value: number }[]>`
    SELECT COALESCE((SELECT SUM(oi.unit_cost_snapshot * oi.quantity) FROM order_items oi JOIN sales_orders so ON so.id = oi.order_id
             WHERE so.status IN ('delivered','returned') AND so.delivered_at > now() - interval '30 days'),0) AS cogs_30,
           COALESCE((SELECT SUM(on_hand * avg_unit_cost) FROM inventory_levels),0) AS inv_value`;
  const projected = await db<{ id: number; sku: string; name_ar: string; planned_margin: number; planned_unit: number; decided_at: Date }[]>`
    SELECT d.id, v.sku, p.name_ar, (d.economics->'base'->>'contributionMarginPct')::numeric AS planned_margin,
           (d.economics->'base'->>'contributionPerDeliveredUnit')::numeric AS planned_unit, d.decided_at
    FROM purchase_decisions d JOIN product_variants v ON v.id = d.variant_id JOIN products p ON p.id = v.product_id
    WHERE d.status = 'approved' ORDER BY d.decided_at DESC`;
  const cash = await getCashPosition(db);
  return { bySku, byCampaign, ledger, expensesByCat, turnover30: turn.inv_value > 0 ? Math.round((turn.cogs_30 / turn.inv_value) * 100) / 100 : null, projected, cash };
}

/** Compact daily Telegram summary — every number comes from the database. */
export async function buildDailySummary(db: Db) {
  const o = await getOverview(db);
  const top = await db<{ name_ar: string; sku: string; total_score: number; confidence: string; band: string }[]>`
    SELECT p.name_ar, v.sku, s.total_score, s.confidence, s.band FROM opportunities op
    JOIN product_scores s ON s.id = op.latest_score_id JOIN product_variants v ON v.id = op.variant_id JOIN products p ON p.id = v.product_id
    WHERE op.status NOT IN ('rejected','archived') ORDER BY s.total_score DESC LIMIT 3`;
  const [newCandidates] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM trend_signals WHERE created_at > now() - interval '24 hours'`;
  const [unverified] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM supplier_offers WHERE status = 'unverified'`;
  const [failedRuns] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM ingestion_runs WHERE status = 'failed' AND started_at > now() - interval '24 hours'`;
  const lines = [
    `📊 ملخص صفقة — ${cairoDateKey()}`,
    `💰 النقد المتاح: ${formatEGP(o.cash.cashBalance)} (غير ملتزم: ${formatEGP(o.cash.freeCash)})`,
    `📦 مخزون بالتكلفة: ${formatEGP(o.cash.inventoryAtCost)}`,
    `🔎 إشارات ترند جديدة (24 ساعة): ${newCandidates.n}`,
    `🏭 عروض موردين غير مؤكدة: ${unverified.n}`,
    `✅ قرارات شراء بانتظارك: ${o.counts.pending_decisions}`,
    `🧾 طلبات مفتوحة: ${o.sales.open_orders} — تحصيل معلّق: ${formatEGP(o.sales.pending_collection)}`,
  ];
  if (top.length) {
    lines.push("", "أعلى الفرص (درجة داخلية وليست تنبؤًا):");
    for (const t of top) lines.push(`• ${t.name_ar} (${t.sku}) — ${t.total_score}/100، ثقة ${t.confidence}`);
  }
  if (o.lowStock.length) {
    lines.push("", "⚠️ مخزون منخفض:");
    for (const l of o.lowStock) lines.push(`• ${l.name_ar}: متاح ${l.available}`);
  }
  if (failedRuns.n) lines.push("", `❗ ${failedRuns.n} عملية استيراد فشلت خلال 24 ساعة — راجع السجلات.`);
  return lines.join("\n");
}

/**
 * Generates importable n8n workflow JSON files into n8n/workflows/.
 *   SAFQA_PUBLIC_URL=https://safqa.example.com npm run n8n:build
 *
 * Every HTTP node uses one Header Auth credential named "SAFQA API"
 * (Name: Authorization, Value: Bearer <N8N_WEBHOOK_SECRET>). Nodes retry 3× with backoff.
 * SAFQA itself enforces idempotency (idempotency keys, content hashes), so re-running is safe.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const BASE = (process.env.SAFQA_PUBLIC_URL ?? "https://YOUR-SAFQA-DOMAIN").replace(/\/$/, "");
const OUT = path.join(__dirname, "workflows");
const CRED = { httpHeaderAuth: { id: "REPLACE_WITH_CREDENTIAL_ID", name: "SAFQA API" } };

type Node = Record<string, unknown> & { name: string };
const id = (s: string) => crypto.createHash("md5").update(s).digest("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");

function schedule(name: string, cron: string, pos: [number, number] = [0, 0]): Node {
  return {
    id: id(name), name, type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: pos,
    parameters: { rule: { interval: [{ field: "cronExpression", expression: cron }] } },
  };
}

function http(name: string, method: "GET" | "POST", route: string, body: string | null, pos: [number, number]): Node {
  return {
    id: id(name + route), name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: pos,
    parameters: {
      method, url: `${BASE}${route}`, authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth",
      ...(body ? { sendBody: true, specifyBody: "json", jsonBody: body } : {}),
      options: { timeout: 60000 },
    },
    credentials: CRED, retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
  };
}

function enqueue(name: string, jobType: string, keyExpr: string, pos: [number, number]): Node {
  return http(name, "POST", "/api/v1/jobs/enqueue",
    `={{ JSON.stringify({ jobType: "${jobType}", idempotencyKey: "${jobType}:" + ${keyExpr}, runNow: true }) }}`, pos);
}

const TODAY = `$now.setZone('Africa/Cairo').toFormat('yyyy-LL-dd')`;
const HOUR = `$now.setZone('Africa/Cairo').toFormat('yyyy-LL-dd-HH')`;
const QUARTER = `$now.setZone('Africa/Cairo').toFormat('yyyy-LL-dd-HH') + '-' + Math.floor($now.minute / 15)`;

function wf(file: string, name: string, nodes: Node[], connections: [string, string][], notes: string) {
  const conn: Record<string, { main: { node: string; type: "main"; index: number }[][] }> = {};
  for (const [from, to] of connections) {
    conn[from] ??= { main: [[]] };
    conn[from].main[0].push({ node: to, type: "main", index: 0 });
  }
  const sticky: Node = {
    id: id(name + "note"), name: "README", type: "n8n-nodes-base.stickyNote", typeVersion: 1, position: [-40, -260],
    parameters: { content: `## ${name}\n${notes}`, height: 220, width: 520 },
  };
  const json = {
    name: `SAFQA — ${name}`, nodes: [sticky, ...nodes], connections: conn, active: false,
    settings: { executionOrder: "v1", timezone: "Africa/Cairo", saveManualExecutions: true, callerPolicy: "workflowsFromSameOwner" },
    tags: [{ name: "safqa" }], meta: { templateCredsSetupCompleted: false },
  };
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(json, null, 2) + "\n");
  return file;
}

fs.mkdirSync(OUT, { recursive: true });
const files: string[] = [];

// 01 — Scheduled trend ingestion from the owner's authorized research sheet (DISABLED until Google Sheets credential is set)
files.push(wf("01-scheduled-trend-ingestion.json", "01 Scheduled trend ingestion", [
  schedule("Daily 06:30", "30 6 * * *", [0, 0]),
  {
    id: id("sheet"), name: "Read research sheet", type: "n8n-nodes-base.googleSheets", typeVersion: 4.5, position: [220, 0], disabled: true,
    parameters: { operation: "read", documentId: { __rl: true, mode: "url", value: "PASTE_YOUR_RESEARCH_SHEET_URL" }, sheetName: { __rl: true, mode: "name", value: "trends" } },
    notes: "DISABLED: connect your Google Sheets credential and sheet URL, then enable. Columns: title, platform, evidence_type, url, region, metric_type, metric_value, previous_value, discovered_at, notes",
  },
  {
    id: id("map"), name: "Map rows to signals", type: "n8n-nodes-base.code", typeVersion: 2, position: [440, 0],
    parameters: { jsCode: `// Only rows with a real source are forwarded; nothing is invented here.
const items = $input.all().map(i => i.json).filter(r => r.title && r.platform && r.evidence_type).map(r => ({
  title: String(r.title), titleEn: r.title_en || null, platform: String(r.platform), evidenceType: String(r.evidence_type),
  sourceUrl: r.url || null, region: r.region || 'EG', metricType: r.metric_type || null,
  metricValue: r.metric_value === '' || r.metric_value == null ? null : Number(r.metric_value),
  previousValue: r.previous_value === '' || r.previous_value == null ? null : Number(r.previous_value),
  discoveredAt: r.discovered_at || undefined, notes: r.notes || null,
}));
return [{ json: { items } }];` },
  },
  http("POST trends to SAFQA", "POST", "/api/v1/ingest/trends",
    `={{ JSON.stringify({ source: "n8n_webhook", method: "webhook", idempotencyKey: "sheet-trends:" + ${TODAY}, items: $json.items }) }}`, [660, 0]),
], [["Daily 06:30", "Read research sheet"], ["Read research sheet", "Map rows to signals"], ["Map rows to signals", "POST trends to SAFQA"]],
"Reads the owner's research sheet (Google Trends / TikTok Creative Center / Ad Library findings recorded with URLs) and pushes them to SAFQA. **Disabled** until a Google Sheets credential is connected — there is no authorized public API for TikTok Creative Center or commercial Meta Ad Library data in Egypt."));

// 02 — Manual URL/CSV ingestion via authenticated webhook
files.push(wf("02-manual-url-csv-ingestion.json", "02 Manual URL & CSV ingestion", [
  {
    id: id("wh2"), name: "Webhook (header auth)", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], webhookId: id("wh2id"),
    parameters: { httpMethod: "POST", path: "safqa-manual-ingest", authentication: "headerAuth", responseMode: "lastNode", options: {} },
    credentials: { httpHeaderAuth: { id: "REPLACE_WITH_CREDENTIAL_ID", name: "SAFQA Inbound Webhook" } },
  },
  {
    id: id("csv2"), name: "Normalize payload", type: "n8n-nodes-base.code", typeVersion: 2, position: [220, 0],
    parameters: { jsCode: `// Accepts {items:[...]} JSON, or {csv:"..."} text with header row.
const body = $json.body ?? $json;
if (Array.isArray(body.items)) return [{ json: { items: body.items } }];
if (typeof body.csv === 'string') {
  const [head, ...lines] = body.csv.trim().split(/\\r?\\n/);
  const cols = head.split(',').map(s => s.trim());
  const items = lines.map(l => { const v = l.split(','); const o = {}; cols.forEach((c, i) => o[c] = (v[i] ?? '').trim()); return o; })
    .map(r => ({ title: r.title, platform: r.platform, evidenceType: r.evidence_type, sourceUrl: r.url || null, region: r.region || 'EG',
      metricType: r.metric_type || null, metricValue: r.metric_value ? Number(r.metric_value) : null, previousValue: r.previous_value ? Number(r.previous_value) : null }));
  return [{ json: { items } }];
}
throw new Error('Expected {items:[...]} or {csv:"..."}');` },
  },
  http("POST trends to SAFQA", "POST", "/api/v1/ingest/trends",
    `={{ JSON.stringify({ source: "n8n_webhook", method: "webhook", items: $json.items }) }}`, [440, 0]),
], [["Webhook (header auth)", "Normalize payload"], ["Normalize payload", "POST trends to SAFQA"]],
"Lets you (or a phone shortcut) submit product URLs/observations or a small CSV. The webhook is protected with its own Header Auth credential. For large CSV files use the dashboard upload in رادار الترند."));

// 03 — Telegram supplier feed
files.push(wf("03-telegram-supplier-feed.json", "03 Telegram supplier feed", [
  {
    id: id("tg3"), name: "Telegram Trigger", type: "n8n-nodes-base.telegramTrigger", typeVersion: 1.1, position: [0, 0], webhookId: id("tg3id"),
    parameters: { updates: ["channel_post", "message", "edited_channel_post"], additionalFields: {} },
    credentials: { telegramApi: { id: "REPLACE_WITH_CREDENTIAL_ID", name: "SAFQA Telegram Bot" } },
  },
  http("POST supplier post to SAFQA", "POST", "/api/v1/ingest/supplier-posts",
    `={{ JSON.stringify({ updates: [$json], idempotencyKey: "tg-update:" + $json.update_id }) }}`, [240, 0]),
], [["Telegram Trigger", "POST supplier post to SAFQA"]],
"Receives posts from supplier channels where the bot is an **admin** (or groups where privacy mode allows it). SAFQA ignores chats not registered on a supplier record, parses price/MOQ, deduplicates by message id and suggests (never confirms) a product match. Telegram allows ONE webhook per bot: do not also set TELEGRAM_WEBHOOK_SECRET direct webhook."));

// 04–07, 09–10 — research pipeline jobs (each modular, each idempotent per period)
const jobFlows: [string, string, string, string, string, string][] = [
  ["04-ai-classification.json", "04 Supplier post AI extraction", "15 * * * *", "ai_extract_supplier_posts", HOUR, "Hourly. Uses Claude (if ANTHROPIC_API_KEY is set) to extract structured details from uncertain supplier posts into an evidence note. Never overwrites prices or marks stock verified. Skips cleanly when AI is not configured; respects the monthly AI budget."],
  ["05-duplicate-detection.json", "05 Duplicate detection", "40 6 * * *", "detect_duplicates", TODAY, "Daily. Flags products whose normalized Arabic/English names are very similar for owner review. Never merges automatically."],
  ["06-retail-offer-comparison.json", "06 Retail offer comparison & scoring", "0 7 * * *", "score_opportunities", TODAY, "Daily. Recomputes retail price ranges (dedupe, mismatch & outlier removal), recommended prices, unit economics and scores for every active SKU. Retail observations themselves arrive via the dashboard or POST /api/v1/ingest/retail-offers."],
  ["07-supplier-matching.json", "07 Supplier matching", "50 6 * * *", "match_supplier_offers", TODAY, "Daily. Re-runs matching of unmatched supplier offers against the catalog (attribute conflicts block matches). Results are 'probable' until the owner confirms."],
  ["08-freshness-checks.json", "08 Price & stock freshness", "0 */6 * * *", "refresh_freshness", HOUR, "Every 6 hours. Marks supplier quotes stale after the configured days and expires owner verifications — stale data cannot pass purchase gates."],
  ["09-daily-research-pipeline.json", "09 Daily research pipeline (profitability + scoring)", "10 7 * * *", "daily_research", TODAY, "Daily morning run: freshness → supplier matching → duplicate flags → profitability → opportunity scoring. Idempotent per day (idempotency key = date)."],
];
for (const [file, name, cron, job, key, notes] of jobFlows) {
  files.push(wf(file, name, [schedule("Schedule", cron, [0, 0]), enqueue(`Enqueue ${job}`, job, key, [240, 0])], [["Schedule", `Enqueue ${job}`]], notes));
}

// 10 — job worker tick
files.push(wf("10-job-worker.json", "10 Job queue worker", [
  schedule("Every 15 minutes", "*/15 * * * *", [0, 0]),
  http("Run ready jobs", "POST", "/api/v1/jobs/tick", null, [240, 0]),
], [["Every 15 minutes", "Run ready jobs"]], "Runs queued jobs with retries and exponential backoff (jobs that fail 3 times are marked dead and alert the owner)."));

// 11 — daily Telegram report
files.push(wf("11-daily-telegram-report.json", "11 Daily Telegram report", [
  schedule("Daily 08:00", "0 8 * * *", [0, 0]),
  enqueue("Build daily summary", "daily_summary", TODAY, [240, 0]),
  enqueue("Send via Telegram", "dispatch_notifications", TODAY + " + '-summary'", [480, 0]),
], [["Daily 08:00", "Build daily summary"], ["Build daily summary", "Send via Telegram"]],
"Builds the compact Arabic summary from recorded data (cash, candidates, unverified leads, pending approvals, stock alerts) and sends it with the SAFQA bot. If Telegram is not configured the notification is marked 'skipped' — visible in Settings → logs."));

// 12 — owner approval notifications
files.push(wf("12-owner-approval-notifications.json", "12 Owner approval notifications", [
  schedule("Every 15 minutes", "5,20,35,50 * * * *", [0, 0]),
  enqueue("Dispatch pending notifications", "dispatch_notifications", QUARTER, [240, 0]),
], [["Every 15 minutes", "Dispatch pending notifications"]], "Delivers pending Telegram notifications (purchase approvals needed, failed publishing, dead jobs). Failures are recorded, never marked sent."));

// 13 — content drafts
files.push(wf("13-content-draft-generation.json", "13 Content draft generation", [
  schedule("Daily 09:00", "0 9 * * *", [0, 0]),
  enqueue("Generate drafts", "generate_content_drafts", TODAY, [240, 0]),
], [["Daily 09:00", "Generate drafts"]], "Creates Arabic caption drafts for in-stock testing/active products from verified attributes only. Drafts always wait for owner approval."));

// 14 — approved social publishing
files.push(wf("14-approved-social-publishing.json", "14 Approved social publishing", [
  schedule("Every 30 minutes", "*/30 * * * *", [0, 0]),
  enqueue("Publish due posts", "publish_due_posts", QUARTER, [240, 0]),
], [["Every 30 minutes", "Publish due posts"]], "Publishes OWNER-APPROVED posts whose time has come to the owner's Facebook Page / Instagram professional account via the Graph API. Out-of-stock products are not published. Without Meta credentials, due posts are marked failed with a clear error."));

// 15 — low stock
files.push(wf("15-low-stock-warnings.json", "15 Low-stock warnings", [
  schedule("Daily 10:00", "0 10 * * *", [0, 0]),
  enqueue("Check low stock", "low_stock_alerts", TODAY, [240, 0]),
  enqueue("Send alerts", "dispatch_notifications", TODAY + " + '-stock'", [480, 0]),
], [["Daily 10:00", "Check low stock"], ["Check low stock", "Send alerts"]], "Alerts when available units fall to the reorder threshold for testing/active products."));

// 16 — failed workflow alerts
files.push(wf("16-failed-workflow-alerts.json", "16 Failed workflow alerts", [
  { id: id("err"), name: "Error Trigger", type: "n8n-nodes-base.errorTrigger", typeVersion: 1, position: [0, 0], parameters: {} },
  http("Report to SAFQA", "POST", "/api/v1/alerts",
    `={{ JSON.stringify({ workflow: $json.workflow.name, node: $json.execution.lastNodeExecuted, message: String($json.execution.error?.message ?? 'unknown error').slice(0, 1900), executionId: String($json.execution.id ?? '') }) }}`, [240, 0]),
], [["Error Trigger", "Report to SAFQA"]],
"Set this workflow as the **Error workflow** in the settings of every other SAFQA workflow. Failures appear in the dashboard and are sent to Telegram."));

console.log(`Wrote ${files.length} workflows to ${OUT} (base URL: ${BASE})`);

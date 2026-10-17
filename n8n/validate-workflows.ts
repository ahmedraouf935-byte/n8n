/**
 * Validates generated n8n workflow files before import.
 *   EXPECTED_BASE_URL=https://safqa-indol.vercel.app npx tsx n8n/validate-workflows.ts
 * Exit code 1 if any check fails.
 */
import fs from "node:fs";
import path from "node:path";

const DIR = process.env.WORKFLOWS_DIR ?? path.join(__dirname, "workflows");
const BASE = process.env.EXPECTED_BASE_URL?.replace(/\/$/, "");
const TRIGGERS = new Set(["n8n-nodes-base.scheduleTrigger", "n8n-nodes-base.webhook", "n8n-nodes-base.telegramTrigger", "n8n-nodes-base.errorTrigger"]);
const SECRET_PATTERNS: [string, RegExp][] = [
  ["Telegram bot token", /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/],
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{10,}/],
  ["Meta token", /\bEAA[A-Za-z0-9]{20,}/],
  ["Bearer literal", /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/],
  ["Long hex/base64 secret", /["'][A-Za-z0-9+/=_-]{40,}["']/],
  ["Postgres URL", /postgres(ql)?:\/\//],
];

type Node = { id: string; name: string; type: string; typeVersion: number; parameters: Record<string, unknown>; credentials?: Record<string, { id: string; name: string }>; disabled?: boolean };
let failures = 0;
const fail = (file: string, msg: string) => { failures++; console.log(`  FAIL ${file}: ${msg}`); };

function compileExpression(expr: string): string | null {
  // n8n expression: "={{ js }}"
  const m = expr.match(/^=\{\{([\s\S]*)\}\}$/);
  if (!m) return "not an n8n expression";
  try { new Function("$json", "$now", "$input", "$execution", `return (${m[1]});`); return null; } catch (e) { return (e as Error).message; }
}

function validCron(c: string) {
  const f = c.trim().split(/\s+/);
  const part = /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/;
  return f.length === 5 && f.every((x) => part.test(x));
}

// Values of real secrets present in this environment must never appear in the files.
const localSecrets = [process.env.N8N_WEBHOOK_SECRET, process.env.TELEGRAM_BOT_TOKEN, process.env.SESSION_SECRET].filter((s): s is string => !!s && s.length > 8);
if (fs.existsSync(".env")) for (const l of fs.readFileSync(".env", "utf8").split("\n")) { const v = l.split("=").slice(1).join("="); if (v.length >= 16) localSecrets.push(v.trim()); }

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const names = new Set<string>();
for (const file of files) {
  const raw = fs.readFileSync(path.join(DIR, file), "utf8");
  let wf: { name: string; nodes: Node[]; connections: Record<string, { main: { node: string }[][] }>; active: boolean; settings: Record<string, unknown> };
  try { wf = JSON.parse(raw); } catch (e) { fail(file, `invalid JSON: ${(e as Error).message}`); continue; }
  const before = failures;

  if (!wf.name?.startsWith("SAFQA — ")) fail(file, "name must start with 'SAFQA — '");
  if (names.has(wf.name)) fail(file, `duplicate workflow name ${wf.name}`);
  names.add(wf.name);
  if (wf.active !== false) fail(file, "workflow must be inactive");
  if (wf.settings?.timezone !== "Africa/Cairo") fail(file, "timezone must be Africa/Cairo");
  if (!Array.isArray(wf.nodes) || !wf.nodes.length) fail(file, "no nodes");

  const byName = new Map<string, Node>();
  const ids = new Set<string>();
  for (const n of wf.nodes) {
    if (byName.has(n.name)) fail(file, `duplicate node name ${n.name}`);
    if (ids.has(n.id)) fail(file, `duplicate node id ${n.id}`);
    byName.set(n.name, n); ids.add(n.id);
    if (!n.type || typeof n.typeVersion !== "number") fail(file, `node ${n.name} missing type/typeVersion`);
  }
  const triggers = wf.nodes.filter((n) => TRIGGERS.has(n.type));
  if (triggers.length !== 1) fail(file, `expected exactly 1 trigger, found ${triggers.length}`);

  // connections reference real nodes; every working node is reachable from the trigger
  const edges = new Map<string, string[]>();
  for (const [from, c] of Object.entries(wf.connections ?? {})) {
    if (!byName.has(from)) fail(file, `connection from unknown node ${from}`);
    const targets = (c.main ?? []).flat().map((t) => t.node);
    for (const t of targets) if (!byName.has(t)) fail(file, `connection to unknown node ${t}`);
    edges.set(from, targets);
  }
  const seen = new Set<string>();
  const stack = triggers.map((t) => t.name);
  while (stack.length) { const n = stack.pop()!; if (seen.has(n)) continue; seen.add(n); stack.push(...(edges.get(n) ?? [])); }
  for (const n of wf.nodes) if (n.type !== "n8n-nodes-base.stickyNote" && !seen.has(n.name)) fail(file, `node ${n.name} is not reachable from the trigger`);

  for (const n of wf.nodes) {
    const p = n.parameters ?? {};
    if (n.type === "n8n-nodes-base.scheduleTrigger") {
      const cron = (p.rule as { interval: { expression: string }[] })?.interval?.[0]?.expression;
      if (!cron || !validCron(cron)) fail(file, `invalid cron "${cron}"`);
    }
    if (n.type === "n8n-nodes-base.httpRequest") {
      const url = String(p.url ?? "");
      if (BASE && !url.startsWith(`${BASE}/api/v1/`)) fail(file, `${n.name}: URL ${url} does not use ${BASE}/api/v1/`);
      if (p.authentication !== "genericCredentialType" || p.genericAuthType !== "httpHeaderAuth") fail(file, `${n.name}: must use Header Auth credential`);
      if (n.credentials?.httpHeaderAuth?.name !== "SAFQA API") fail(file, `${n.name}: credential must be named "SAFQA API"`);
      if (p.jsonBody) { const err = compileExpression(String(p.jsonBody)); if (err) fail(file, `${n.name}: jsonBody expression: ${err}`); }
    }
    if (n.type === "n8n-nodes-base.code") {
      try { new Function("$input", "$json", "$now", `return (async () => { ${String(p.jsCode)} })`); } catch (e) { fail(file, `${n.name}: jsCode does not compile: ${(e as Error).message}`); }
    }
    if (n.type === "n8n-nodes-base.webhook" && p.authentication !== "headerAuth") fail(file, `${n.name}: webhook must require header auth`);
    if (n.type === "n8n-nodes-base.googleSheets" && n.disabled !== true) fail(file, `${n.name}: must ship disabled until a Sheets credential is connected`);
    for (const c of Object.values(n.credentials ?? {})) if (c.id && c.id !== "REPLACE_WITH_CREDENTIAL_ID") fail(file, `${n.name}: credential id must be a placeholder`);
  }

  for (const [label, re] of SECRET_PATTERNS) if (re.test(raw)) fail(file, `possible secret (${label})`);
  for (const s of localSecrets) if (raw.includes(s)) fail(file, "contains a real secret value from this environment");

  console.log(`${failures === before ? "PASS" : "FAIL"}  ${file}  (${wf.nodes.length} nodes, trigger: ${triggers[0]?.type.split(".").pop()})`);
}
console.log(`\n${failures ? "FAIL" : "PASS"} — ${files.length} workflows, ${failures} problem(s)`);
if (files.length !== 16) { console.log(`Expected 16 workflow files, found ${files.length}`); process.exitCode = 1; }
if (failures) process.exitCode = 1;

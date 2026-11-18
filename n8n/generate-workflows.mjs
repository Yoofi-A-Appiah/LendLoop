// Source of truth for n8n/workflows/*.json. Edit here, then: node n8n/generate-workflows.mjs n8n/workflows
import { writeFileSync } from "fs";
const out = process.argv[2];

const SIGN = `const crypto = require('crypto');
const sign = (body) => {
  const secret = $env.N8N_TO_LENDLOOP_SECRET;
  if (!secret) throw new Error('N8N_TO_LENDLOOP_SECRET is not set');
  const t = Math.floor(Date.now() / 1000);
  return \`t=\${t},v1=\${crypto.createHmac('sha256', secret).update(\`\${t}.\${body}\`).digest('hex')}\`;
};`;

const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

const signedPost = (name, path, position) => ({
  name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position, ...RETRY,
  parameters: {
    method: "POST",
    url: `={{ $env.CONVEX_SITE_URL }}${path}`,
    sendHeaders: true,
    headerParameters: { parameters: [{ name: "x-lendloop-signature", value: "={{ $json.signature }}" }] },
    sendBody: true, contentType: "raw", rawContentType: "application/json", body: "={{ $json.body }}",
    options: { timeout: 10000 },
  },
});

const code = (name, jsCode, position, mode) => ({
  name, type: "n8n-nodes-base.code", typeVersion: 2, position,
  parameters: { ...(mode ? { mode } : {}), jsCode },
});

const chain = (...names) => Object.fromEntries(names.slice(0, -1).map((n, i) => [n, { main: [[{ node: names[i + 1], type: "main", index: 0 }]] }]));

const wf = (name, nodes, connections) => ({
  name, nodes: nodes.map((n, i) => ({ id: `${name}-${i}`.replace(/\W+/g, "-").toLowerCase(), ...n })),
  connections, active: false,
  // errorWorkflow is set after import (IDs differ per instance) — see README.
  settings: { executionOrder: "v1", saveDataErrorExecution: "all", saveDataSuccessExecution: "all" },
});

// ---------------- 1. Request notification ----------------
const verify = code("Verify signature", `// Rejects anything not signed by Convex with LENDLOOP_TO_N8N_SECRET in the last 5 minutes.
const crypto = require('crypto');
const { headers, body } = $input.first().json;
const secret = $env.LENDLOOP_TO_N8N_SECRET;
const m = String(headers['x-lendloop-signature'] || '').match(/^t=(\\d+),v1=([0-9a-f]{64})$/);
let valid = false;
if (secret && m && Math.abs(Date.now() / 1000 - Number(m[1])) <= 300) {
  // Convex signs JSON.stringify(payload); re-stringifying the parsed body yields the same bytes.
  const expected = crypto.createHmac('sha256', secret).update(\`\${m[1]}.\${JSON.stringify(body)}\`).digest();
  const got = Buffer.from(m[2], 'hex');
  valid = got.length === expected.length && crypto.timingSafeEqual(got, expected);
}
return [{ json: { valid, event: valid ? body : null } }];`, [440, 300]);

const notify = code("Send notification (mock)", `// Swap this node for Email/Slack/Discord (using n8n credentials). Dedupes on eventId so
// a Convex retry after a lost response never notifies twice.
const { event } = $input.first().json;
const seen = $getWorkflowStaticData('global');
seen.eventIds = seen.eventIds || [];
if (seen.eventIds.includes(event.eventId)) return [{ json: { ok: true, duplicate: true } }];

const lines = {
  'request.created': \`\${event.recipient.name}, a neighbor wants to borrow your \${event.toolName} (\${event.startDate} → \${event.endDate}).\`,
  'request.approved': \`\${event.recipient.name}, your request for the \${event.toolName} was approved. Pick-up from \${event.startDate}.\`,
  'request.declined': \`\${event.recipient.name}, your request for the \${event.toolName} was declined.\`,
  'request.cancelled': \`\${event.recipient.name}, a request for your \${event.toolName} was withdrawn.\`,
  'loan.returned': \`\${event.recipient.name}, thanks for returning the \${event.toolName}!\`,
};
const message = lines[event.event] || \`\${event.toolName}: \${event.status}\`;
console.log(\`[LendLoop] to <\${event.recipient.email}>: \${message}\`);

seen.eventIds = [...seen.eventIds, event.eventId].slice(-1000);
return [{ json: { ok: true, message } }];`, [880, 200]);

writeFileSync(`${out}/request-notification.json`, JSON.stringify(wf("LendLoop – Request notification", [
  { name: "Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [220, 300], webhookId: "lendloop-request",
    parameters: { httpMethod: "POST", path: "lendloop-request", responseMode: "responseNode", options: {} } },
  verify,
  { name: "Signature valid?", type: "n8n-nodes-base.if", typeVersion: 2, position: [660, 300],
    parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict" }, combinator: "and",
      conditions: [{ id: "valid", leftValue: "={{ $json.valid }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }] }, options: {} } },
  notify,
  { name: "Respond 200", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [1100, 200],
    parameters: { respondWith: "json", responseBody: "={{ JSON.stringify({ ok: true }) }}", options: {} } },
  { name: "Respond 401", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [880, 400],
    parameters: { respondWith: "json", responseBody: "={{ JSON.stringify({ error: 'invalid signature' }) }}", options: { responseCode: 401 } } },
], {
  ...chain("Webhook", "Verify signature", "Signature valid?"),
  "Signature valid?": { main: [[{ node: "Send notification (mock)", type: "main", index: 0 }], [{ node: "Respond 401", type: "main", index: 0 }]] },
  ...chain("Send notification (mock)", "Respond 200"),
}), null, 2));

// ---------------- 2. Overdue reminders ----------------
writeFileSync(`${out}/overdue-reminders.json`, JSON.stringify(wf("LendLoop – Overdue reminders", [
  { name: "Every day 09:00", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [220, 300],
    parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 9 * * *" }] } } },
  { name: "Run now", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [220, 480], parameters: {} },
  code("Sign fetch", `${SIGN}\nconst body = '{}';\nreturn [{ json: { body, signature: sign(body) } }];`, [440, 300]),
  signedPost("Fetch overdue loans", "/n8n/overdue-loans", [660, 300]),
  { name: "One item per loan", type: "n8n-nodes-base.splitOut", typeVersion: 1, position: [880, 300], parameters: { fieldToSplitOut: "loans", options: {} } },
  code("Send reminder (mock)", `// Swap for Email/Slack (with n8n credentials). A failed send is reported as status "failed",
// not thrown, so one bad address doesn't stop reminders to everyone else.
const l = $json;
let status = 'sent', detail;
try {
  if (!l.borrower.email) throw new Error('borrower has no email');
  console.log(\`[LendLoop] to <\${l.borrower.email}>: Hi \${l.borrower.name}, the \${l.toolName} was due back \${l.endDate} (\${l.daysOverdue} day(s) ago).\`);
  detail = \`Overdue reminder sent (\${l.daysOverdue}d late)\`;
} catch (e) {
  status = 'failed';
  detail = \`Reminder failed: \${e.message}\`;
}
return { json: { loanId: l.loanId, idempotencyKey: l.idempotencyKey, status, detail } };`, [1100, 300], "runOnceForEachItem"),
  code("Sign write-back", `${SIGN}\nconst body = JSON.stringify($json);\nreturn { json: { body, signature: sign(body) } };`, [1320, 300], "runOnceForEachItem"),
  signedPost("Write reminder status", "/n8n/reminder-status", [1540, 300]),
], { ...chain("Run now", "Sign fetch"), ...chain("Every day 09:00", "Sign fetch", "Fetch overdue loans", "One item per loan", "Send reminder (mock)", "Sign write-back", "Write reminder status") }), null, 2));

// ---------------- 3. Error workflow ----------------
writeFileSync(`${out}/error-handler.json`, JSON.stringify(wf("LendLoop – Error handler", [
  { name: "Error Trigger", type: "n8n-nodes-base.errorTrigger", typeVersion: 1, position: [220, 300], parameters: {} },
  code("Report & sign", `${SIGN}
const e = $input.first().json;
const report = {
  executionId: String(e.execution?.id ?? \`trigger-\${Date.now()}\`),
  workflow: e.workflow?.name ?? 'unknown',
  message: \`\${e.execution?.lastNodeExecuted ?? 'trigger'}: \${e.execution?.error?.message ?? e.trigger?.error?.message ?? 'unknown error'}\`,
};
console.error('[LendLoop] workflow failed', JSON.stringify(report));
const body = JSON.stringify(report);
return [{ json: { body, signature: sign(body) } }];`, [440, 300]),
  signedPost("Record failure in LendLoop", "/n8n/workflow-error", [660, 300]),
], chain("Error Trigger", "Report & sign", "Record failure in LendLoop")), null, 2));

#!/usr/bin/env node
//
// Boots the server and exercises the core agent flow over HTTP: health, the
// authenticated backlog, claiming with a lease, the 409 lease conflict, and the
// Markdown packet. No browser required. Exits non-zero on the first failure.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.SMOKE_PORT || "4187";
const AGENT_TOKEN = "smoke-agent-token";
const OPERATOR_TOKEN = "smoke-operator-token";
const AUTH_SECRET = "smoke-auth-secret";
const base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-backlog-smoke-"));

let passed = 0;
const failures = [];
function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}`);
  }
}

function agentAuthed(path, init = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${AGENT_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

let operatorCookie = "";

function operatorAuthed(path, init = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      cookie: operatorCookie,
      "Content-Type": "application/json",
      "x-csrf-protection": "1",
      ...(init.headers || {}),
    },
  });
}

function readSetCookie(response) {
  const headers = response.headers;
  const raw = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  return raw.map((value) => String(value).split(";")[0]).join("; ");
}

async function waitForHealth(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return true;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function spawnServer(env) {
  return spawn("node", ["manage/server.mjs"], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

const server = spawnServer({
  PORT,
  HOST: "127.0.0.1",
  MANAGE_DATA_DIR: dataDir,
  MANAGE_BASE_URL: base,
  MANAGE_AUTH_TOKEN: AGENT_TOKEN,
  MANAGE_OPERATOR_TOKEN: OPERATOR_TOKEN,
  MANAGE_AUTH_SECRET: AUTH_SECRET,
  NODE_ENV: "development",
});

try {
  if (!(await waitForHealth())) {
    throw new Error("server did not become healthy in time");
  }

  const health = await (await fetch(`${base}/api/health`)).json();
  check("health reports file storage", health.ok === true && health.storage === "file");

  const unauth = await fetch(`${base}/api/work-items`);
  check("work-items requires auth (401)", unauth.status === 401);

  const agentLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: AGENT_TOKEN }),
  });
  check("agent token cannot mint a session (401)", agentLogin.status === 401);

  const operatorLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: OPERATOR_TOKEN }),
  });
  operatorCookie = readSetCookie(operatorLogin);
  check("operator token creates a session", operatorLogin.status === 200 && operatorCookie.includes("manage_session"));

  const agentDenied = await agentAuthed("/api/work-items");
  check("operator routes reject agent token (403)", agentDenied.status === 403);

  const items = await (await operatorAuthed("/api/work-items")).json();
  check("seed has 6 work items", Array.isArray(items.workItems) && items.workItems.length === 6);
  check("first packet is TASK-101", items.workItems.some((i) => i.key === "TASK-101"));

  const nextKey = await (await agentAuthed("/api/agent/next-key")).json();
  check("next-key is TASK-107", nextKey.nextKey === "TASK-107");

  const created = await agentAuthed("/api/agent/tasks", {
    method: "POST",
    headers: { "Idempotency-Key": "smoke-create-1" },
    body: JSON.stringify({
      title: "Agent-created lifecycle packet",
      summary: "Create via the agent route after the token split.",
      repo: "web-app",
    }),
  });
  const createdBody = await created.json();
  check("agent can create via agent route", created.status === 201 && createdBody.workItem?.key === "TASK-107");
  check("created packet has revision 1", createdBody.workItem?.revision === 1);

  const createReplay = await agentAuthed("/api/agent/tasks", {
    method: "POST",
    headers: { "Idempotency-Key": "smoke-create-1" },
    body: JSON.stringify({
      title: "Agent-created lifecycle packet",
      summary: "Create via the agent route after the token split.",
      repo: "web-app",
    }),
  });
  const createReplayBody = await createReplay.json();
  check("idempotent create retry does not allocate another key", createReplay.status === 201 && createReplayBody.workItem?.key === "TASK-107" && createReplayBody.idempotentReplay === true);

  const stalePatch = await operatorAuthed("/api/work-items/TASK-107", {
    method: "PATCH",
    body: JSON.stringify({ title: "Stale write", expectedRevision: 0 }),
  });
  const stalePatchBody = await stalePatch.json();
  check("stale revision returns 409", stalePatch.status === 409 && stalePatchBody.code === "WORK_ITEM_REVISION_CONFLICT");

  const csrfDenied = await fetch(`${base}/api/backups`, {
    method: "POST",
    headers: {
      cookie: operatorCookie,
      "Content-Type": "application/json",
      Origin: "https://evil.example",
    },
    body: JSON.stringify({ reason: "csrf-smoke" }),
  });
  check("CSRF rejects cookie writes from a hostile origin", csrfDenied.status === 403);

  const next = await (await agentAuthed("/api/agent/next?repo=web-app")).json();
  check("next ready packet for web-app is TASK-101", next.workItem?.key === "TASK-101");
  check("next packet renders a prompt", typeof next.prompt === "string" && next.prompt.includes("Fix contact import duplicate handling"));

  const claim = await agentAuthed("/api/agent/tasks/TASK-101/claim", { method: "POST", body: JSON.stringify({ agent: "Codex", leaseMinutes: 30 }) });
  const claimBody = await claim.json();
  check("claim returns 200 and a lease", claim.status === 200 && claimBody.workItem?.status === "claimed" && Boolean(claimBody.workItem?.leaseExpiresAt));
  check("claim issues an agent run id", String(claimBody.workItem?.agentRunId || "").startsWith("TASK-101-"));

  const conflict = await agentAuthed("/api/agent/tasks/TASK-101/claim", { method: "POST", body: JSON.stringify({ agent: "Claude Code" }) });
  check("second claim is rejected (409)", conflict.status === 409);

  const agentForce = await agentAuthed("/api/agent/tasks/TASK-101/claim", {
    method: "POST",
    body: JSON.stringify({ agent: "Claude Code", force: true }),
  });
  check("agent force-claim of a healthy lease is rejected (403)", agentForce.status === 403);

  check("claimed packet exposes run health", claimBody.workItem?.agentRunHealth?.state === "healthy");
  check("healthy run offers extend and release", Array.isArray(claimBody.workItem?.agentRunHealth?.actions) && claimBody.workItem.agentRunHealth.actions.some((action) => action.id === "extend"));

  const reclaimWhileHealthy = await operatorAuthed("/api/agent/tasks/TASK-101/recovery", {
    method: "POST",
    body: JSON.stringify({ action: "reclaim", agentRunId: claimBody.workItem.agentRunId }),
  });
  check("reclaim on a healthy run is rejected (409)", reclaimWhileHealthy.status === 409);

  const missingRunId = await operatorAuthed("/api/agent/tasks/TASK-101/recovery", {
    method: "POST",
    body: JSON.stringify({ action: "extend" }),
  });
  check("recovery without observed run id is rejected (400)", missingRunId.status === 400);

  const agentRecoveryDenied = await agentAuthed("/api/agent/tasks/TASK-101/recovery", {
    method: "POST",
    body: JSON.stringify({ action: "extend", agentRunId: claimBody.workItem.agentRunId }),
  });
  check("agent token cannot recover a run (403)", agentRecoveryDenied.status === 403);

  const extended = await operatorAuthed("/api/agent/tasks/TASK-101/recovery", {
    method: "POST",
    body: JSON.stringify({ action: "extend", agent: "Codex", agentRunId: claimBody.workItem.agentRunId, leaseMinutes: 30 }),
  });
  const extendedBody = await extended.json();
  check("extend returns 200 and keeps the claim", extended.status === 200 && extendedBody.workItem?.status === "claimed");
  check("extend appends a recovery event", extendedBody.workItem?.agentEvents?.at(-1)?.action === "extend");
  check("extend keeps the same run id", extendedBody.workItem?.agentRunId === claimBody.workItem.agentRunId);

  const released = await operatorAuthed("/api/agent/tasks/TASK-101/recovery", {
    method: "POST",
    body: JSON.stringify({ action: "release", agentRunId: extendedBody.workItem.agentRunId }),
  });
  const releasedBody = await released.json();
  check("release returns the packet to ready", released.status === 200 && releasedBody.workItem?.status === "ready_for_agent");
  check("release clears the lease", !releasedBody.workItem?.leaseExpiresAt && !releasedBody.workItem?.claimedBy);

  const reclaimedSetup = await agentAuthed("/api/agent/tasks/TASK-101/claim", { method: "POST", body: JSON.stringify({ agent: "Codex", leaseMinutes: 30 }) });
  const reclaimedSetupBody = await reclaimedSetup.json();
  await operatorAuthed("/api/work-items/TASK-101", {
    method: "PATCH",
    body: JSON.stringify({ leaseExpiresAt: "2020-01-01T00:00:00.000Z" }),
  });
  const reclaimed = await operatorAuthed("/api/agent/tasks/TASK-101/recovery", {
    method: "POST",
    body: JSON.stringify({ action: "reclaim", agent: "Claude Code", agentRunId: reclaimedSetupBody.workItem.agentRunId }),
  });
  const reclaimedBody = await reclaimed.json();
  check("reclaim takes over a stale lease", reclaimed.status === 200 && reclaimedBody.workItem?.claimedBy === "Claude Code");
  check("reclaim issues a new run id", Boolean(reclaimedBody.workItem?.agentRunId) && reclaimedBody.workItem.agentRunId !== reclaimedSetupBody.workItem.agentRunId);

  const status = await agentAuthed("/api/agent/tasks/TASK-101/status", {
    method: "POST",
    body: JSON.stringify({ status: "needs_review", agent: "Codex", note: "Opened a PR.", githubPrUrl: "https://github.com/your-org/web-app/pull/1" }),
  });
  const statusBody = await status.json();
  check("status writeback records needs_review", statusBody.workItem?.status === "needs_review");

  const blockedDone = await agentAuthed("/api/agent/tasks/TASK-101/status", {
    method: "POST",
    body: JSON.stringify({ status: "done", note: "Trying to close without delivery evidence." }),
  });
  const blockedDoneBody = await blockedDone.json();
  check("agent done without evidence is rejected (409)", blockedDone.status === 409 && /Completion evidence required/.test(blockedDoneBody.error || ""));

  const agentOverride = await agentAuthed("/api/agent/tasks/TASK-101/status", {
    method: "POST",
    body: JSON.stringify({
      status: "done",
      completionOverrideReason: "Agents must not override the delivery evidence gate.",
    }),
  });
  check("agent override is rejected (403)", agentOverride.status === 403);

  const operatorOverride = await operatorAuthed("/api/work-items/TASK-101", {
    method: "PATCH",
    body: JSON.stringify({
      status: "done",
      completionOverrideReason: "Planning packet completed without a code delivery.",
    }),
  });
  const operatorOverrideBody = await operatorOverride.json();
  check(
    "operator override marks the packet done",
    operatorOverride.status === 200
      && operatorOverrideBody.workItem?.status === "done"
      && operatorOverrideBody.workItem?.completionOverride?.reason === "Planning packet completed without a code delivery.",
  );

  const mockSync = await operatorAuthed("/api/github/sync", {
    method: "POST",
    body: JSON.stringify({ mock: true }),
  });
  const mockSyncBody = await mockSync.json();
  check("mock GitHub sync returns 200", mockSync.status === 200);
  check("mock GitHub sync is fresh", mockSyncBody.github?.source === "mock" && mockSyncBody.github?.syncState === "current");
  check(
    "mock GitHub sync uses TASK keys and generic repos",
    mockSyncBody.github?.repos?.some((repo) => repo.slug === "your-org/web-app")
      && mockSyncBody.github?.repos?.some((repo) => repo.mergedPulls?.some((pull) => String(pull.title || "").includes("TASK-101")))
      && !JSON.stringify(mockSyncBody).match(/Commerce Street|csc-workspace|CSC-|COM-|Harbor|RegVault/i),
  );

  const reconciliation = await operatorAuthed("/api/github/reconciliation");
  const reconciliationBody = await reconciliation.json();
  const unmatched = reconciliationBody.reconciliation?.unmatchedMergedPullRequests || [];
  const task101Match = unmatched.find((pull) => pull.number === 101 && pull.repoId === "web-app");
  const unmatchedMarketing = unmatched.find((pull) => pull.number === 88 && pull.repoId === "marketing-site");
  check("reconciliation GET returns 200", reconciliation.status === 200);
  check("reconciliation suggests TASK-101 for the matching merged PR", task101Match?.suggestedPacket?.key === "TASK-101");
  check("reconciliation leaves the unmatched marketing PR without a packet", Boolean(unmatchedMarketing) && unmatchedMarketing.suggestedPacket == null);
  check("reconciliation payload stays generic", !JSON.stringify(reconciliationBody).match(/Commerce Street|csc-workspace|CSC-|COM-|Harbor|RegVault/i));

  const linked = await operatorAuthed("/api/github/reconciliation", {
    method: "POST",
    body: JSON.stringify({
      action: "link",
      pullRequestUrl: "https://github.com/your-org/web-app/pull/101",
      workItemKey: "TASK-101",
    }),
  });
  const linkedBody = await linked.json();
  check("reconciliation link returns 200", linked.status === 200);
  check(
    "reconciliation link records the merged PR on TASK-101",
    linkedBody.workItem?.key === "TASK-101"
      && linkedBody.workItem?.githubPrUrl === "https://github.com/your-org/web-app/pull/101",
  );

  const followUp = await operatorAuthed("/api/github/reconciliation", {
    method: "POST",
    body: JSON.stringify({
      action: "follow_up",
      pullRequestUrl: "https://github.com/your-org/marketing-site/pull/88",
    }),
  });
  const followUpBody = await followUp.json();
  check("reconciliation follow-up creates a TASK packet", followUp.status === 201 && /^TASK-\d+$/.test(followUpBody.workItem?.key || ""));
  check(
    "reconciliation follow-up uses generic copy",
    followUpBody.workItem?.repo === "marketing-site"
      && followUpBody.created === true
      && !JSON.stringify(followUpBody).match(/Commerce Street|csc-workspace|CSC-|COM-|Harbor|RegVault|Shipped reconciliation/i),
  );

  const systemStatus = await operatorAuthed("/api/system/status");
  const systemStatusBody = await systemStatus.json();
  check("system status surfaces GitHub freshness", systemStatusBody.githubSync?.freshness === "fresh");

  const md = await (await agentAuthed("/agent/TASK-101.md")).text();
  check("markdown packet renders", md.includes("# TASK-101") && md.includes("## Acceptance Criteria"));

  const instructions = await (await agentAuthed("/agent/instructions.md")).text();
  check("instructions are generic (no gcloud)", instructions.includes("MANAGE_AUTH_TOKEN") && !instructions.includes("gcloud"));

  const missingReset = await operatorAuthed("/api/agent/reset", {
    method: "POST",
    body: JSON.stringify({}),
  });
  check("reset without typed confirmation is rejected (400)", missingReset.status === 400);

  const collidePort = String(Number(PORT) + 1);
  const collide = spawnServer({
    PORT: collidePort,
    HOST: "127.0.0.1",
    MANAGE_DATA_DIR: dataDir,
    MANAGE_AUTH_TOKEN: "shared-token",
    MANAGE_OPERATOR_TOKEN: "shared-token",
    MANAGE_AUTH_SECRET: AUTH_SECRET,
    NODE_ENV: "production",
  });
  const collideExit = await new Promise((resolve) => {
    let stderr = "";
    collide.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    collide.on("exit", (code) => resolve({ code, stderr }));
    setTimeout(() => {
      collide.kill("SIGTERM");
      resolve({ code: null, stderr: stderr || "timed out" });
    }, 4000);
  });
  check(
    "colliding tokens fail closed in production",
    collideExit.code !== 0 && /must differ from MANAGE_AUTH_TOKEN/.test(collideExit.stderr),
  );
} catch (error) {
  failures.push(`exception: ${error.message}`);
} finally {
  server.kill("SIGTERM");
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("Failures:\n- " + failures.join("\n- "));
  process.exit(1);
}

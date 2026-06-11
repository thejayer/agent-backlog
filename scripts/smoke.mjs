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
const TOKEN = "manage-local";
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

function authed(path, init = {}) {
  return fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) } });
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

const server = spawn("node", ["manage/server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT, HOST: "127.0.0.1", MANAGE_DATA_DIR: dataDir, NODE_ENV: "development" },
  stdio: ["ignore", "ignore", "inherit"],
});

try {
  if (!(await waitForHealth())) {
    throw new Error("server did not become healthy in time");
  }

  const health = await (await fetch(`${base}/api/health`)).json();
  check("health reports file storage", health.ok === true && health.storage === "file");

  const unauth = await fetch(`${base}/api/work-items`);
  check("work-items requires auth (401)", unauth.status === 401);

  const items = await (await authed("/api/work-items")).json();
  check("seed has 6 work items", Array.isArray(items.workItems) && items.workItems.length === 6);
  check("first packet is TASK-101", items.workItems.some((i) => i.key === "TASK-101"));

  const next = await (await authed("/api/agent/next?repo=web-app")).json();
  check("next ready packet for web-app is TASK-101", next.workItem?.key === "TASK-101");
  check("next packet renders a prompt", typeof next.prompt === "string" && next.prompt.includes("Fix contact import duplicate handling"));

  const claim = await authed("/api/agent/tasks/TASK-101/claim", { method: "POST", body: JSON.stringify({ agent: "Codex", leaseMinutes: 30 }) });
  const claimBody = await claim.json();
  check("claim returns 200 and a lease", claim.status === 200 && claimBody.workItem?.status === "claimed" && Boolean(claimBody.workItem?.leaseExpiresAt));
  check("claim issues an agent run id", String(claimBody.workItem?.agentRunId || "").startsWith("TASK-101-"));

  const conflict = await authed("/api/agent/tasks/TASK-101/claim", { method: "POST", body: JSON.stringify({ agent: "Claude Code" }) });
  check("second claim is rejected (409)", conflict.status === 409);

  const status = await authed("/api/agent/tasks/TASK-101/status", {
    method: "POST",
    body: JSON.stringify({ status: "needs_review", agent: "Codex", note: "Opened a PR.", githubPrUrl: "https://github.com/your-org/web-app/pull/1" }),
  });
  const statusBody = await status.json();
  check("status writeback records needs_review", statusBody.workItem?.status === "needs_review");

  const md = await (await authed("/agent/TASK-101.md")).text();
  check("markdown packet renders", md.includes("# TASK-101") && md.includes("## Acceptance Criteria"));

  const instructions = await (await authed("/agent/instructions.md")).text();
  check("instructions are generic (no gcloud)", instructions.includes("MANAGE_AUTH_TOKEN") && !instructions.includes("gcloud"));
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

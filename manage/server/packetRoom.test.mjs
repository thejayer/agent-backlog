import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listPacketEvents } from "./packetEventStore.mjs";
import {
  associateGithubPacketKeys,
  extractPacketKeys,
  ingestGithubPacketSignal,
  loadPacketRoom,
  mergePacketRoomEvents,
  recordAgentHeartbeat,
  recordHumanPacketNote,
  verifyGithubWebhookSignature,
} from "./packetRoom.mjs";
import { writeJsonState } from "./storage.mjs";
import { claimWorkItem, createWorkItem, listWorkItems, resetWorkItems } from "./workStore.mjs";

const CSC_LEAKAGE = /Commerce Street|csc-workspace|csc-crm|CSC-|COM-|commercestreet|Harbor|RegVault|gcloud|linear\.app\/.*COM-/i;

let dataDir;
const ENV_KEYS = [
  "MANAGE_DATA_DIR",
  "MANAGE_STORAGE_BACKEND",
  "MANAGE_AUTO_SNAPSHOTS",
  "MANAGE_GITHUB_WEBHOOK_SECRET",
  "MANAGE_PACKET_KEY_PREFIX",
];
let savedEnv;

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "manage-packet-room-"));
  process.env.MANAGE_DATA_DIR = dataDir;
  process.env.MANAGE_STORAGE_BACKEND = "file";
  process.env.MANAGE_AUTO_SNAPSHOTS = "false";
  delete process.env.MANAGE_GITHUB_WEBHOOK_SECRET;
  delete process.env.MANAGE_PACKET_KEY_PREFIX;
  await resetWorkItems();
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("packet room domain", () => {
  it("extracts TASK packet keys from GitHub branch and title text", () => {
    expect(extractPacketKeys(
      "cursor/task-717-manage-packet-room-mvp",
      "TASK-717 Packet Room MVP",
      "also mentions TASK-101 and CSC-717",
    )).toEqual(["TASK-717", "TASK-101"]);
    expect(JSON.stringify(extractPacketKeys("TASK-101", "CSC-717"))).not.toMatch(/CSC-/);
  });

  it("merges embedded agentEvents and lastAgentUpdate without dropping either", () => {
    const workItem = {
      key: "TASK-717",
      agentEvents: [{
        type: "claimed",
        at: "2026-08-27T10:00:00.000Z",
        note: "Claimed",
        agentRunId: "run-1",
      }],
      lastAgentUpdate: {
        type: "status",
        status: "in_progress",
        at: "2026-08-27T10:05:00.000Z",
        note: "Started",
        agentRunId: "run-1",
      },
    };

    const merged = mergePacketRoomEvents([], workItem);
    expect(merged.map((event) => event.summary)).toEqual(["Claimed", "Started"]);
    expect(merged.every((event) => event.kind === "lifecycle")).toBe(true);
    expect(JSON.stringify(merged)).not.toMatch(CSC_LEAKAGE);
  });

  it("migrates embedded history once, then keeps rendering it if durable writes already exist", async () => {
    await writeJsonState("work-items", [{
      id: "w-legacy",
      key: "TASK-199",
      title: "Legacy packet",
      status: "in_progress",
      repo: "web-app",
      agentEvents: [{
        type: "progress",
        at: "2026-08-27T09:00:00.000Z",
        note: "Embedded progress",
        agentRunId: "legacy-run",
      }],
      lastAgentUpdate: {
        type: "status",
        status: "in_progress",
        at: "2026-08-27T09:00:00.000Z",
        note: "Embedded progress",
        agentRunId: "legacy-run",
      },
    }]);

    const first = await loadPacketRoom("TASK-199");
    expect(first.migrated).toBe(true);
    expect(first.events).toEqual([
      expect.objectContaining({ summary: "Embedded progress", kind: "lifecycle" }),
    ]);

    const durable = await listPacketEvents("TASK-199");
    expect(durable).toHaveLength(1);

    const second = await loadPacketRoom("TASK-199");
    expect(second.migrated).toBe(false);
    expect(second.events).toHaveLength(1);
  });

  it("records a heartbeat without changing claim, status, or lease", async () => {
    const { workItem } = await createWorkItem({ title: "Heartbeat packet", ready: true, repo: "web-app" });
    const claimed = await claimWorkItem(workItem.key, { claimedBy: "Codex", leaseMinutes: 90 });
    const before = claimed.workItem;

    const result = await recordAgentHeartbeat(workItem.key, {
      state: "running",
      currentStep: "Writing Room tab",
      agentRunId: before.agentRunId,
      agent: "Codex",
    });

    const after = (await listWorkItems()).find((item) => item.key === workItem.key);
    expect(result.leaseExpiresAt).toBe(before.leaseExpiresAt);
    expect(after.leaseExpiresAt).toBe(before.leaseExpiresAt);
    expect(after.status).toBe(before.status);
    expect(after.claimedBy).toBe(before.claimedBy);
    expect(after.agentEvents).toEqual(before.agentEvents);
    expect(result.event).toMatchObject({
      kind: "heartbeat",
      state: "running",
      currentStep: "Writing Room tab",
    });
  });

  it("records operator notes and rejects GitHub signals that do not match a packet", async () => {
    const { workItem } = await createWorkItem({ title: "Note packet", ready: true, repo: "web-app" });
    const note = await recordHumanPacketNote(workItem.key, { summary: "Looks good" }, { login: "operator" });
    expect(note).toMatchObject({
      kind: "human_note",
      summary: "Looks good",
      actor: expect.objectContaining({ login: "operator" }),
    });

    await expect(associateGithubPacketKeys({
      pull_request: { title: "Unrelated change", head: { ref: "cursor/no-packet" } },
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  it("ingests allowlisted GitHub events idempotently and verifies webhook signatures", async () => {
    const { workItem } = await createWorkItem({ title: "GitHub packet", ready: true, repo: "web-app" });
    const payload = {
      action: "opened",
      number: 12,
      pull_request: {
        id: 99,
        number: 12,
        title: `${workItem.key} Packet Room`,
        html_url: `https://github.com/your-org/web-app/pull/12`,
        head: { ref: `cursor/${workItem.key.toLowerCase()}-room` },
        state: "open",
      },
      repository: { full_name: "your-org/web-app", html_url: "https://github.com/your-org/web-app" },
      sender: { login: "operator" },
    };
    const headers = {
      "x-github-event": "pull_request",
      "x-github-delivery": "delivery-1",
    };

    const first = await ingestGithubPacketSignal({
      payload,
      headers,
      actor: { agent: "Codex" },
    });
    const second = await ingestGithubPacketSignal({
      payload,
      headers,
      actor: { agent: "Codex" },
    });

    expect(first.packetKeys).toEqual([workItem.key]);
    expect(first.events[0].created).toBe(true);
    expect(second.events[0].created).toBe(false);
    expect(first.events[0].event.payload.body).toBeUndefined();
    expect(first.events[0].event.evidenceUrl).toBe("https://github.com/your-org/web-app/pull/12");
    expect(JSON.stringify(first)).not.toMatch(CSC_LEAKAGE);

    const rawBody = JSON.stringify(payload);
    const secret = "webhook-secret";
    const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
    expect(() => verifyGithubWebhookSignature(rawBody, `sha256=${digest}`, secret)).not.toThrow();
    expect(() => verifyGithubWebhookSignature(rawBody, "sha256=deadbeef", secret)).toThrow(/invalid/);
  });

  it("fails closed on unsupported GitHub types and missing origin when no webhook secret is set", async () => {
    await expect(ingestGithubPacketSignal({
      payload: { action: "created" },
      headers: { "x-github-event": "issue_comment" },
      actor: { agent: "Codex" },
    })).rejects.toMatchObject({ statusCode: 400 });

    await expect(ingestGithubPacketSignal({
      payload: { event: "pull_request", action: "opened", pull_request: { title: "TASK-101" } },
      headers: { "x-github-event": "pull_request" },
      actor: {},
    })).rejects.toMatchObject({ statusCode: 401 });
  });
});

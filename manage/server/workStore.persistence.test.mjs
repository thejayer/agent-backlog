import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { workItems as seedWorkItems } from "../src/data/workItems.mjs";
import { listPacketEvents } from "./packetEventStore.mjs";
import { writeJsonState } from "./storage.mjs";
import {
  claimWorkItem,
  createWorkItem,
  listWorkItems,
  nextWorkItemKey,
  patchWorkItem,
  resetWorkItems,
  updateTaskStatus,
} from "./workStore.mjs";

const ENV_KEYS = [
  "MANAGE_DATA_DIR",
  "MANAGE_STORAGE_BACKEND",
  "MANAGE_STORAGE_DRIVER",
  "MANAGE_AUTO_SNAPSHOTS",
  "MANAGE_PACKET_KEY_PREFIX",
];

let savedEnv;
let dataDir;

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  dataDir = mkdtempSync(path.join(os.tmpdir(), "agent-backlog-persistence-"));
  process.env.MANAGE_DATA_DIR = dataDir;
  process.env.MANAGE_AUTO_SNAPSHOTS = "false";
  delete process.env.MANAGE_STORAGE_BACKEND;
  delete process.env.MANAGE_STORAGE_DRIVER;
  delete process.env.MANAGE_PACKET_KEY_PREFIX;
  await resetWorkItems();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("workStore persistence", () => {
  it("writes created packets to the file backend and allocates the next TASK- key", async () => {
    expect(await nextWorkItemKey()).toBe("TASK-107");

    const { workItem, revision, workItems } = await createWorkItem({
      title: "Persisted packet",
      repo: "web-app",
    });

    expect(workItem.key).toBe("TASK-107");
    expect(workItem.id).toBe("w-task-107");
    expect(workItem.repo).toBe("web-app");
    expect(revision).toBe(1);
    expect(workItem.revision).toBe(1);
    expect(workItems).toHaveLength(seedWorkItems.length + 1);
    expect(workItems[0].key).toBe("TASK-107");

    const onDisk = JSON.parse(readFileSync(path.join(dataDir, "work-items.json"), "utf8"));
    expect(onDisk[0].key).toBe("TASK-107");
    expect(onDisk[0]._persistence.revision).toBe(1);
    expect(await nextWorkItemKey()).toBe("TASK-108");
  });

  it("starts keys at TASK-101 when the store is empty", async () => {
    await writeJsonState("work-items", []);

    const { workItem } = await createWorkItem({ title: "First ever", repo: "web-app" });

    expect(workItem.key).toBe("TASK-101");
  });

  it("allocates after packets whose TASK number is stored outside key", async () => {
    await writeJsonState("work-items", [
      { id: "w-task-667", title: "Legacy id packet" },
      { packetId: "TASK-666", title: "Legacy packetId packet" },
    ]);

    const { workItem } = await createWorkItem({ title: "After legacy packets" });

    expect(workItem.key).toBe("TASK-668");
  });

  it("rejects a stale revision with 409", async () => {
    const created = await createWorkItem({ title: "Revision packet" });

    await expect(patchWorkItem(created.workItem.key, {
      title: "Stale write",
      expectedRevision: 0,
    })).rejects.toMatchObject({
      statusCode: 409,
      code: "WORK_ITEM_REVISION_CONFLICT",
      expectedRevision: 0,
      actualRevision: 1,
    });

    const latest = (await listWorkItems()).find((item) => item.key === created.workItem.key);
    expect(latest.title).toBe("Revision packet");
    expect(latest.revision).toBe(1);
  });

  it("replays an idempotent create without allocating another TASK- key", async () => {
    const payload = { title: "Retry-safe packet", repo: "web-app", idempotencyKey: "create-retry-1" };
    const first = await createWorkItem(payload);
    const replay = await createWorkItem(payload);

    expect(first.workItem.key).toBe("TASK-107");
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.workItem.key).toBe(first.workItem.key);
    expect(replay.delta.upsert).toEqual([]);
    expect(await listWorkItems()).toHaveLength(seedWorkItems.length + 1);
    expect(await nextWorkItemKey()).toBe("TASK-108");
  });

  it("replays an idempotent claim without creating another run or event", async () => {
    const payload = {
      claimedBy: "Codex",
      expectedRevision: 0,
      idempotencyKey: "claim-retry-1",
    };
    const first = await claimWorkItem("TASK-101", payload);
    const replay = await claimWorkItem("TASK-101", payload);

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.workItem.agentRunId).toBe(first.workItem.agentRunId);
    expect(replay.workItem.agentEvents).toEqual(first.workItem.agentEvents);
    expect(replay.delta.upsert).toEqual([]);
    expect(replay.revision).toBe(first.revision);
  });

  it("replays an idempotent status write without duplicating its event", async () => {
    const payload = {
      status: "in_progress",
      note: "Retry-safe update",
      expectedRevision: 0,
      idempotencyKey: "status-retry-1",
    };
    const first = await updateTaskStatus("TASK-101", payload);
    const replay = await updateTaskStatus("TASK-101", payload);

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.revision).toBe(first.revision);
    expect(replay.workItem.agentEvents).toEqual(first.workItem.agentEvents);
    expect(replay.delta.upsert).toEqual([]);
  });

  it("serializes file-backed creates with updates", async () => {
    const [created] = await Promise.all([
      createWorkItem({ title: "Concurrent create", repo: "web-app", idempotencyKey: "concurrent-create" }),
      patchWorkItem("TASK-101", { summary: "Concurrent update survived" }),
    ]);
    const items = await listWorkItems();

    expect(items.find((item) => item.key === created.workItem.key)?.title).toBe("Concurrent create");
    expect(items.find((item) => item.key === "TASK-101")?.summary).toBe("Concurrent update survived");
  });

  it("keeps the file backend working for an ordinary patch", async () => {
    const { workItem } = await patchWorkItem("TASK-104", { title: "Edited draft" });

    expect(workItem.key).toBe("TASK-104");
    expect(workItem.title).toBe("Edited draft");
    expect(workItem.revision).toBe(1);

    const onDisk = JSON.parse(readFileSync(path.join(dataDir, "work-items.json"), "utf8"));
    const persisted = onDisk.find((item) => item.key === "TASK-104");
    expect(persisted.title).toBe("Edited draft");
    expect(persisted._persistence.revision).toBe(1);
  });

  it("keeps durable packet room events after the 20-event agentEvents cap", async () => {
    await claimWorkItem("TASK-101", { claimedBy: "Codex", leaseMinutes: 90 });

    for (let index = 1; index <= 25; index += 1) {
      await updateTaskStatus("TASK-101", {
        status: "in_progress",
        note: `update-${index}`,
      });
    }

    const latest = (await listWorkItems()).find((item) => item.key === "TASK-101");
    expect(latest.agentEvents).toHaveLength(20);
    expect(latest.agentEvents.at(-1)).toMatchObject({ type: "status", note: "update-25" });
    expect(latest.agentEvents.some((event) => event.type === "claimed")).toBe(false);

    const durable = await listPacketEvents("TASK-101");
    expect(durable.length).toBeGreaterThan(20);
    expect(durable.some((event) => event.type === "claimed")).toBe(true);
    expect(durable.at(-1)).toMatchObject({ kind: "lifecycle", summary: "update-25" });
    expect(JSON.stringify(durable)).not.toMatch(/Commerce Street|csc-workspace|CSC-|COM-|Harbor|RegVault/i);
  });
});

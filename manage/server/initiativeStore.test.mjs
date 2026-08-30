import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanPacketKeys, createInitiative, listInitiatives, patchInitiative, resetInitiatives } from "./initiativeStore.mjs";

const ENV_KEYS = [
  "MANAGE_DATA_DIR",
  "MANAGE_STORAGE_BACKEND",
  "MANAGE_STORAGE_DRIVER",
  "MANAGE_AUTO_SNAPSHOTS",
  "MANAGE_PACKET_KEY_PREFIX",
];
const CSC_LEAKAGE = /Commerce Street|csc-workspace|csc-crm|CSC-|COM-|commercestreet|Harbor|RegVault|gcloud|linear\.app\/.*COM-/i;
let savedEnv;
let dataDir;

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "manage-initiatives-"));
  process.env.MANAGE_DATA_DIR = dataDir;
  process.env.MANAGE_AUTO_SNAPSHOTS = "false";
  delete process.env.MANAGE_STORAGE_BACKEND;
  delete process.env.MANAGE_STORAGE_DRIVER;
  delete process.env.MANAGE_PACKET_KEY_PREFIX;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("initiative store", () => {
  it("creates a normalized initiative and persists authoritative TASK packet keys", async () => {
    const result = await createInitiative({
      title: "Delivery portfolio visibility",
      status: "active",
      health: "watch",
      packetKeys: ["task-101", "not-a-packet", "TASK-101", "CSC-394"],
      completionCriteria: "Initiatives are visible\nProgress is derived",
      labels: "backlog, portfolio, backlog",
      groupingGuidance: "  Group by operator outcome.  ",
    });

    expect(result.initiative).toMatchObject({
      title: "Delivery portfolio visibility",
      status: "active",
      health: "watch",
      packetKeys: ["TASK-101"],
      completionCriteria: ["Initiatives are visible", "Progress is derived"],
      labels: ["backlog", "portfolio"],
      groupingGuidance: "Group by operator outcome.",
    });
    expect(JSON.stringify(result)).not.toMatch(CSC_LEAKAGE);
    expect(await listInitiatives()).toHaveLength(1);
  });

  it("parameterizes packet key filtering instead of requiring a CSC- prefix", () => {
    expect(cleanPacketKeys(["TASK-101", "csc-394", "COM-12", "not-a-packet"])).toEqual(["TASK-101"]);
    process.env.MANAGE_PACKET_KEY_PREFIX = "ITEM";
    expect(cleanPacketKeys(["ITEM-7", "TASK-101", "CSC-394"])).toEqual(["ITEM-7"]);
  });

  it("patches editable fields while preserving identity and creation time", async () => {
    const created = (await createInitiative({ title: "Initial" })).initiative;
    const result = await patchInitiative(created.id, {
      title: "Updated",
      owner: "Operator",
      packetKeys: "TASK-102, TASK-101",
      labels: ["delivery"],
      groupingGuidance: "Keep the release boundary explicit.",
    });

    expect(result.initiative).toMatchObject({
      id: created.id,
      title: "Updated",
      owner: "Operator",
      packetKeys: ["TASK-102", "TASK-101"],
      labels: ["delivery"],
      groupingGuidance: "Keep the release boundary explicit.",
      createdAt: created.createdAt,
    });
    expect(JSON.stringify(result)).not.toMatch(CSC_LEAKAGE);
  });

  it("replays initiative creation with the same idempotency key", async () => {
    const first = await createInitiative({ title: "Retry-safe initiative", idempotencyKey: "initiative-create-1" });
    const replay = await createInitiative({ title: "Duplicate initiative", idempotencyKey: "initiative-create-1" });

    expect(first.idempotentReplay).toBe(false);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.initiative).toEqual(first.initiative);
    expect(replay.initiative).not.toHaveProperty("_persistence");
    expect(await listInitiatives()).toHaveLength(1);
  });

  it("rejects invalid controlled values and missing records", async () => {
    const created = (await createInitiative({ title: "Guarded" })).initiative;
    await expect(createInitiative({ title: "Invalid create", status: "bogus" })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(patchInitiative(created.id, { health: "unknown" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(patchInitiative(created.id, { status: "" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(patchInitiative("missing", { title: "Nope" })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("resets initiatives for local and browser test isolation", async () => {
    await createInitiative({ title: "Temporary" });
    expect(await resetInitiatives()).toEqual([]);
    expect(await listInitiatives()).toEqual([]);
  });
});

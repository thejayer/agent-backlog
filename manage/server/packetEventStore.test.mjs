import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendPacketEvent,
  listPacketEvents,
  normalizePacketEvent,
  resetPacketEvents,
  sanitizePacketEventPayload,
} from "./packetEventStore.mjs";

const CSC_LEAKAGE = /Commerce Street|csc-workspace|csc-crm|CSC-|COM-|commercestreet|Harbor|RegVault|gcloud|linear\.app\/.*COM-/i;

let dataDir;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "manage-packet-events-"));
  process.env.MANAGE_DATA_DIR = dataDir;
  process.env.MANAGE_STORAGE_BACKEND = "file";
});

afterEach(async () => {
  delete process.env.MANAGE_DATA_DIR;
  delete process.env.MANAGE_STORAGE_BACKEND;
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("packet event store", () => {
  it("appends events without a cap and is idempotent by id", async () => {
    const first = await appendPacketEvent({
      id: "evt-one",
      packetKey: "TASK-717",
      kind: "human_note",
      type: "note",
      summary: "First note",
      at: "2026-08-27T11:00:00.000Z",
    });
    const replay = await appendPacketEvent({
      id: "evt-one",
      packetKey: "TASK-717",
      kind: "human_note",
      type: "note",
      summary: "Changed summary must not overwrite",
      at: "2026-08-27T11:00:00.000Z",
    });
    await appendPacketEvent({
      id: "evt-two",
      packetKey: "TASK-717",
      kind: "heartbeat",
      type: "heartbeat",
      state: "running",
      currentStep: "Writing tests",
      at: "2026-08-27T11:01:00.000Z",
    });

    expect(first.created).toBe(true);
    expect(replay).toEqual({ event: first.event, created: false });
    expect(await listPacketEvents("TASK-717")).toHaveLength(2);
    expect(await fs.readFile(path.join(dataDir, "packet-events.jsonl"), "utf8")).toContain("First note");
    expect(await fs.readFile(path.join(dataDir, "packet-events.jsonl"), "utf8")).not.toContain("Changed summary");
    expect(JSON.stringify(await listPacketEvents("TASK-717"))).not.toMatch(CSC_LEAKAGE);
  });

  it("strips secrets and GitHub bodies from persisted payloads", () => {
    expect(sanitizePacketEventPayload({
      token: "secret-value",
      apiKey: "abc",
      note: "safe",
      nested: { password: "nope", ok: "yes" },
    })).toEqual({
      note: "safe",
      nested: { ok: "yes" },
    });

    expect(sanitizePacketEventPayload({
      body: "PR description with secrets",
      title: "TASK-717 packet room",
      email: "user@example.com",
    }, { github: true })).toEqual({
      title: "TASK-717 packet room",
    });
  });

  it("rejects untrusted evidence URLs and unknown GitHub types", () => {
    expect(() => normalizePacketEvent({
      packetKey: "TASK-717",
      kind: "github",
      type: "push",
    })).toThrow(/Unsupported GitHub event type/);

    expect(() => normalizePacketEvent({
      packetKey: "TASK-717",
      kind: "lifecycle",
      type: "progress",
      evidenceUrl: "https://evil.example/leak",
    })).toThrow(/trusted https link/);
  });

  it("skips a malformed JSONL tail and keeps earlier events readable", async () => {
    await appendPacketEvent({
      id: "evt-good",
      packetKey: "TASK-717",
      kind: "lifecycle",
      type: "progress",
      summary: "kept",
      at: "2026-08-27T11:00:00.000Z",
    });
    await fs.appendFile(path.join(dataDir, "packet-events.jsonl"), "{not-json\n", "utf8");

    expect(await listPacketEvents("TASK-717")).toEqual([
      expect.objectContaining({ id: "evt-good", summary: "kept" }),
    ]);
  });

  it("clears the file log on reset", async () => {
    await appendPacketEvent({
      id: "evt-reset",
      packetKey: "TASK-717",
      kind: "human_note",
      type: "note",
      summary: "temporary",
    });
    await resetPacketEvents();
    expect(await listPacketEvents("TASK-717")).toEqual([]);
  });
});

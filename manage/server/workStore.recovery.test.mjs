import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { claimWorkItem, listWorkItems, recoverAgentRun, resetWorkItems } from "./workStore.mjs";

let dataDir;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "agent-backlog-recovery-"));
  process.env.MANAGE_DATA_DIR = dataDir;
  await resetWorkItems();
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

async function claimReadyPacket() {
  return claimWorkItem("TASK-101", { agent: "Codex", leaseMinutes: 90 });
}

describe("recoverAgentRun", () => {
  it("extends an active healthy lease", async () => {
    const claimed = await claimReadyPacket();
    const before = Date.parse(claimed.workItem.leaseExpiresAt);
    const result = await recoverAgentRun("TASK-101", {
      action: "extend",
      agentRunId: claimed.workItem.agentRunId,
      agent: "Codex",
      leaseMinutes: 60,
    }, { actor: "Operator" });

    expect(result.action).toBe("extend");
    expect(result.workItem.status).toBe("claimed");
    expect(result.workItem.agentRunId).toBe(claimed.workItem.agentRunId);
    expect(Date.parse(result.workItem.leaseExpiresAt)).toBeGreaterThan(before);
    expect(result.workItem.agentEvents.at(-1)).toMatchObject({ type: "recovery", action: "extend" });
    expect(result.workItem.agentRunHealth.state).toBe("healthy");
  });

  it("releases a claimed packet back to ready", async () => {
    const claimed = await claimReadyPacket();
    const result = await recoverAgentRun("TASK-101", {
      action: "release",
      agentRunId: claimed.workItem.agentRunId,
    }, { actor: "Operator" });

    expect(result.action).toBe("release");
    expect(result.workItem.status).toBe("ready_for_agent");
    expect(result.workItem.claimedBy).toBe("");
    expect(result.workItem.agentRunId).toBe("");
    expect(result.workItem.leaseExpiresAt).toBe("");
    expect(result.workItem.agentRunHealth.state).toBe("idle");
    expect(result.workItem.agentEvents.at(-1)).toMatchObject({ type: "recovery", action: "release" });
  });

  it("reclaims a stale expired lease", async () => {
    const claimed = await claimReadyPacket();
    const { patchWorkItem } = await import("./workStore.mjs");
    await patchWorkItem("TASK-101", {
      leaseExpiresAt: "2020-01-01T00:00:00.000Z",
    });

    const result = await recoverAgentRun("TASK-101", {
      action: "reclaim",
      agentRunId: claimed.workItem.agentRunId,
      agent: "Claude Code",
    });

    expect(result.action).toBe("reclaim");
    expect(result.workItem.status).toBe("claimed");
    expect(result.workItem.claimedBy).toBe("Claude Code");
    expect(result.workItem.agentRunId).not.toBe(claimed.workItem.agentRunId);
    expect(result.workItem.agentEvents.at(-1)).toMatchObject({ type: "claimed", agent: "Claude Code" });
  });

  it("rejects reclaim while the run is healthy", async () => {
    const claimed = await claimReadyPacket();

    await expect(
      recoverAgentRun("TASK-101", {
        action: "reclaim",
        agentRunId: claimed.workItem.agentRunId,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/reclaim is not available while the agent run is healthy/),
    });
  });

  it("rejects a mismatched observed run id", async () => {
    await claimReadyPacket();

    await expect(
      recoverAgentRun("TASK-101", {
        action: "release",
        agentRunId: "TASK-101-stale-observer",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/agent run changed/),
    });
  });

  it("requires the observed agent run id", async () => {
    await claimReadyPacket();

    await expect(
      recoverAgentRun("TASK-101", { action: "release" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/observed agent run ID is required/),
    });
  });

  it("rejects agent force-claim of a healthy live lease", async () => {
    const claimed = await claimReadyPacket();

    await expect(
      claimWorkItem("TASK-101", { agent: "Claude Code", force: true }),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringMatching(/requires an operator/),
    });

    const latest = (await listWorkItems()).find((item) => item.key === "TASK-101");
    expect(latest.claimedBy).toBe("Codex");
    expect(latest.agentRunId).toBe(claimed.workItem.agentRunId);
  });

  it("lets an operator force-claim a live lease", async () => {
    await claimReadyPacket();
    const result = await claimWorkItem("TASK-101", { agent: "Operator", force: true }, { allowForce: true });

    expect(result.workItem.claimedBy).toBe("Operator");
    expect(result.workItem.status).toBe("claimed");
  });

  it("does not let a force reclaim overwrite a newer run id", async () => {
    const first = await claimReadyPacket();
    const { patchWorkItem } = await import("./workStore.mjs");
    await patchWorkItem("TASK-101", {
      leaseExpiresAt: "2020-01-01T00:00:00.000Z",
    });
    const newer = await claimWorkItem("TASK-101", { agent: "Claude Code", force: true });

    await expect(
      claimWorkItem("TASK-101", {
        agent: "Operator",
        force: true,
        expectedAgentRunId: first.workItem.agentRunId,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/agent run changed/),
    });

    await expect(
      recoverAgentRun("TASK-101", {
        action: "reclaim",
        agentRunId: first.workItem.agentRunId,
        agent: "Operator",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/agent run changed/),
    });

    await expect(
      recoverAgentRun("TASK-101", {
        action: "extend",
        agentRunId: first.workItem.agentRunId,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/agent run changed/),
    });

    await expect(
      recoverAgentRun("TASK-101", {
        action: "release",
        agentRunId: first.workItem.agentRunId,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/agent run changed/),
    });

    const latest = (await listWorkItems()).find((item) => item.key === "TASK-101");
    expect(latest.claimedBy).toBe("Claude Code");
    expect(latest.agentRunId).toBe(newer.workItem.agentRunId);
    expect(latest.status).toBe("claimed");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyGithubMatches,
  claimWorkItem,
  createWorkItem,
  patchWorkItem,
  resetWorkItems,
  updateTaskStatus,
} from "./workStore.mjs";

let dataDir;
const T0 = new Date("2026-06-12T12:00:00.000Z");
const prUrl = "https://github.com/your-org/web-app/pull/101";

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "agent-backlog-completion-"));
  process.env.MANAGE_DATA_DIR = dataDir;
  await resetWorkItems();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dataDir, { recursive: true, force: true });
});

function freezeTime() {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
}

async function linkMergedPr(key = "TASK-101", url = prUrl) {
  return applyGithubMatches(key, {
    source: "gh",
    bestPrUrl: url,
    bestBranch: "codex/task-101-closeout",
    pullRequests: [
      {
        url,
        branch: "codex/task-101-closeout",
        mergedAt: "2026-06-12T11:55:00.000Z",
        mergeCommitSha: "abc123",
      },
    ],
    branches: [],
    issues: [],
    workflowRuns: [],
  });
}

describe("completion evidence gate", () => {
  it("rejects done status without delivery evidence or an explicit override", async () => {
    await expect(updateTaskStatus("TASK-101", { status: "done" })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("Completion evidence required"),
    });
  });

  it("accepts and records server-verified closeout evidence", async () => {
    await linkMergedPr();
    const { workItem } = await updateTaskStatus("TASK-101", {
      status: "done",
      note: "Merged and ready to close.",
      githubPrUrl: prUrl,
      testsRun: ["client-supplied test result"],
      filesChanged: ["client-supplied-file.js"],
    }, {
      verifiedCompletionWriteback: {
        testsRun: ["CI: success"],
        filesChanged: ["web-app/src/App.jsx"],
        evidenceCollection: {
          tests: { success: true, results: ["CI: success"] },
          files: { success: true, results: ["web-app/src/App.jsx"] },
        },
      },
    });

    expect(workItem.status).toBe("done");
    expect(workItem.completionEvidence).toMatchObject({
      source: "gh",
      prUrl,
      mergeCommitSha: "abc123",
    });
    expect(workItem.completionOverride).toBeNull();
    expect(workItem.lastAgentUpdate.evidenceCollection).toEqual({
      tests: { success: true, results: ["CI: success"] },
      files: { success: true, results: ["web-app/src/App.jsx"] },
    });
    expect(workItem.lastAgentUpdate.testsRun).toEqual(["CI: success"]);
    expect(workItem.lastAgentUpdate.filesChanged).toEqual(["web-app/src/App.jsx"]);
  });

  it("rejects caller-supplied test and file evidence even for a matched merged pull request", async () => {
    await linkMergedPr();

    await expect(updateTaskStatus("TASK-101", {
      status: "done",
      note: "Caller evidence must not satisfy completion.",
      githubPrUrl: prUrl,
      evidenceCollection: {
        tests: { success: true, results: ["CI: success"] },
        files: { success: true, results: ["web-app/src/App.jsx"] },
      },
      testsRun: ["CI: success"],
      filesChanged: ["web-app/src/App.jsx"],
    })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("Tests run, Files changed"),
    });
  });

  it("rejects forged client completion evidence", async () => {
    await expect(updateTaskStatus("TASK-101", {
      status: "done",
      note: "Fake merge metadata should not pass.",
      githubPrUrl: prUrl,
      testsRun: ["npm test - passed"],
      filesChanged: ["web-app/src/App.jsx"],
      completionEvidence: {
        source: "github-cli",
        prUrl,
        mergedAt: "2026-06-12T11:55:00.000Z",
        mergeCommitSha: "forged",
      },
    })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("Merged pull request"),
    });
  });

  it("records a completion override on the packet and timeline", async () => {
    freezeTime();
    const { workItem } = await updateTaskStatus("TASK-101", {
      status: "done",
      completionOverrideReason: "Planning packet completed without a code delivery.",
      completionOverrideBy: "spoofed-client",
    }, { principal: { login: "operator", role: "operator" } });

    expect(workItem.status).toBe("done");
    expect(workItem.completedAt).toBe("2026-06-12T12:00:00.000Z");
    expect(workItem.completionOverride).toMatchObject({
      actor: "operator",
      reason: "Planning packet completed without a code delivery.",
    });
    expect(workItem.agentEvents.at(-1)).toMatchObject({
      type: "completion_override",
      agent: "operator",
      note: "Planning packet completed without a code delivery.",
    });
  });

  it("rejects short override reasons", async () => {
    await expect(
      updateTaskStatus("TASK-101", { status: "done", completionOverrideReason: "too short" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("clears stale completion evidence when a completed packet is claimed again", async () => {
    await updateTaskStatus("TASK-101", {
      status: "done",
      completionOverrideReason: "Previous non-code delivery was complete.",
    });
    const { workItem } = await claimWorkItem("TASK-101", { claimedBy: "Codex" });
    expect(workItem.completionEvidence).toBeNull();
    expect(workItem.completionOverride).toBeNull();
    expect(workItem.completedAt).toBe("");
  });

  it("rejects direct patch completion without evidence and validates override reasons", async () => {
    await expect(patchWorkItem("TASK-104", { status: "done" })).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      patchWorkItem("TASK-104", { status: "done", completionOverrideReason: "too short" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("uses only server-verified evidence for direct patch completion", async () => {
    const draftPr = "https://github.com/your-org/docs-site/pull/104";
    await linkMergedPr("TASK-104", draftPr);
    const { workItem } = await patchWorkItem("TASK-104", {
      status: "done",
      note: "Verified direct completion.",
      githubPrUrl: draftPr,
      testsRun: ["client-supplied result"],
      filesChanged: ["client-supplied-file.js"],
    }, {
      verifiedCompletionWriteback: {
        testsRun: ["Docs CI: success"],
        filesChanged: ["docs-site/src/index.md"],
      },
    });

    expect(workItem.status).toBe("done");
    expect(workItem.completionEvidence).toMatchObject({ prUrl: draftPr, mergeCommitSha: "abc123" });
  });

  it("rejects creating a packet as done", async () => {
    await expect(createWorkItem({ title: "Already finished", status: "done" })).rejects.toMatchObject({
      statusCode: 400,
      message: "New work packets cannot be created as done.",
    });
  });

  it("keeps completion time stable across later notes and clears it when reopened", async () => {
    freezeTime();
    const { workItem: completed } = await updateTaskStatus("TASK-101", {
      status: "done",
      completionOverrideReason: "Non-code packet completed during test setup.",
    });
    expect(completed.completedAt).toBe("2026-06-12T12:00:00.000Z");

    vi.setSystemTime(new Date(T0.getTime() + 60_000));
    const { workItem: stillDone } = await updateTaskStatus("TASK-101", { status: "done", note: "Added closeout note" });
    expect(stillDone.completedAt).toBe("2026-06-12T12:00:00.000Z");

    const { workItem: reopened } = await updateTaskStatus("TASK-101", { status: "in_progress" });
    expect(reopened.completedAt).toBe("");
    expect(reopened.completionOverride).toBeNull();
  });
});

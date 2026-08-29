import { describe, expect, it } from "vitest";
import { deriveAgentRunHealth, isLeaseActive, normalizeLeaseMinutes } from "./agentRunHealth.mjs";

const now = new Date("2026-07-20T12:00:00.000Z");

function activeRun(overrides = {}) {
  return {
    key: "TASK-430",
    status: "in_progress",
    repo: "web-app",
    claimedBy: "Codex",
    claimedAt: "2026-07-20T11:00:00.000Z",
    agentRunId: "TASK-430-run-1",
    leaseExpiresAt: "2026-07-20T13:00:00.000Z",
    githubBranch: "codex/task-430-agent-health",
    lastAgentUpdate: { at: "2026-07-20T11:55:00.000Z", note: "Working" },
    ...overrides,
  };
}

describe("agent run health", () => {
  it("reports a fresh run as healthy", () => {
    const health = deriveAgentRunHealth(activeRun(), now);

    expect(health).toMatchObject({
      state: "healthy",
      severity: "success",
      freshness: { state: "fresh", ageMinutes: 5 },
      lease: { active: true, remainingMinutes: 60, percentRemaining: 50 },
    });
    expect(health.actions.map((action) => action.id)).toEqual(["extend", "release", "open_context"]);
  });

  it("warns when an otherwise healthy lease is expiring", () => {
    const health = deriveAgentRunHealth(activeRun({
      claimedAt: "2026-07-20T10:40:00.000Z",
      leaseExpiresAt: "2026-07-20T12:10:00.000Z",
    }), now);

    expect(health).toMatchObject({
      state: "expiring",
      severity: "warning",
      lease: { active: true, remainingMinutes: 10 },
    });
    expect(health.actions.map((action) => action.id)).toContain("extend");
  });

  it("marks an expired lease as stale and reclaimable", () => {
    const item = activeRun({ leaseExpiresAt: "2026-07-20T11:59:00.000Z" });
    const health = deriveAgentRunHealth(item, now);

    expect(isLeaseActive(item, now)).toBe(false);
    expect(health).toMatchObject({
      state: "stale",
      severity: "high",
      summary: "The recorded lease has expired.",
      lease: { active: false, remainingMinutes: 0 },
    });
    expect(health.actions.map((action) => action.id)).toEqual(["reclaim", "release", "open_context"]);
  });

  it("explains missing active-run context", () => {
    const health = deriveAgentRunHealth(activeRun({
      claimedBy: "",
      claimedAt: "",
      agentRunId: "",
      leaseExpiresAt: "",
      githubBranch: "",
      lastAgentUpdate: null,
      agentEvents: [],
      updatedAt: "2026-07-20T11:50:00.000Z",
    }), now);

    expect(health).toMatchObject({
      state: "incomplete",
      severity: "high",
      missingSignals: ["claim owner", "claim timestamp", "run ID", "lease", "branch or PR"],
    });
    expect(health.summary).toContain("run ID");
  });

  it("surfaces blocked agent work as a failed run", () => {
    const health = deriveAgentRunHealth(activeRun({
      status: "blocked",
      leaseExpiresAt: "",
      blockedBy: "Production credentials were rejected.",
      lastAgentUpdate: { at: "2026-07-20T11:58:00.000Z", status: "blocked" },
    }), now);

    expect(health).toMatchObject({
      state: "failed",
      severity: "critical",
      summary: "Production credentials were rejected.",
    });
    expect(health.actions.map((action) => action.id)).toContain("reclaim");
  });

  it("uses configured repository ownership and rejects unsafe pull request URLs", () => {
    const configured = deriveAgentRunHealth(activeRun({
      githubPrUrl: "javascript:alert(1)",
      githubBranch: "codex/task-430-agent-health",
      repo: "web-app",
    }), now);
    const qualified = deriveAgentRunHealth(activeRun({
      githubPrUrl: "",
      githubBranch: "feature/context",
      repo: "your-org/custom-repo",
    }), now);

    expect(configured.context.contextUrl)
      .toBe("https://github.com/your-org/web-app/tree/codex/task-430-agent-health");
    expect(qualified.context.contextUrl)
      .toBe("https://github.com/your-org/custom-repo/tree/feature/context");
  });

  it("uses the same bounded lease normalization as claim enforcement", () => {
    expect(normalizeLeaseMinutes(undefined)).toBe(90);
    expect(normalizeLeaseMinutes(1)).toBe(5);
    expect(normalizeLeaseMinutes(61.6)).toBe(62);
    expect(normalizeLeaseMinutes(999)).toBe(480);
  });
});

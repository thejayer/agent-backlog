import { describe, expect, it } from "vitest";
import { attentionCount, attentionDestination, buildAttentionInbox } from "./attentionInbox.mjs";

const now = new Date("2026-07-20T12:00:00.000Z");
const CSC_LEAKAGE = /Commerce Street|csc-workspace|CSC-|COM-|Harbor|RegVault|csc-crm-io|commercestreet/i;

function reviewPacket(overrides = {}) {
  return {
    key: "TASK-431",
    repo: "web-app",
    status: "needs_review",
    updatedAt: "2026-07-18T11:00:00.000Z",
    githubPrUrl: "https://github.com/your-org/web-app/pull/74",
    lastAgentUpdate: {
      at: "2026-07-18T11:00:00.000Z",
      note: "Ready for review",
      githubPrUrl: "https://github.com/your-org/web-app/pull/74",
      testsRun: ["npm test"],
      filesChanged: ["web-app/src/App.jsx"],
    },
    ...overrides,
  };
}

describe("buildAttentionInbox", () => {
  it("prioritizes failed and stale server-derived run health", () => {
    const workItems = [
      {
        key: "TASK-430",
        repo: "web-app",
        agentRunHealth: {
          state: "stale",
          severity: "high",
          label: "Stale run",
          summary: "The recorded lease has expired.",
          freshness: { ageMinutes: 90 },
          context: { lastActivityAt: "2026-07-20T10:30:00.000Z" },
          actions: [{ id: "reclaim", label: "Reclaim" }],
        },
      },
      {
        key: "TASK-429",
        repo: "api-service",
        agentRunHealth: {
          state: "failed",
          severity: "critical",
          label: "Failed run",
          summary: "CI failed.",
          freshness: { ageMinutes: 15 },
          context: { lastActivityAt: "2026-07-20T11:45:00.000Z" },
          actions: [{ id: "reclaim", label: "Reclaim" }],
        },
      },
    ];

    const inbox = buildAttentionInbox({ workItems, now });

    expect(inbox.map((item) => item.packetKey)).toEqual(["TASK-429", "TASK-430"]);
    expect(inbox[0]).toMatchObject({ severity: "critical", action: { kind: "agent_recovery", recovery: "reclaim" } });
    expect(attentionCount(inbox, "all")).toBe(2);
    expect(attentionCount(inbox, "agent")).toBe(2);
    expect(JSON.stringify(inbox)).not.toMatch(CSC_LEAKAGE);
  });

  it("maps expiring and incomplete run health to their distinct actions and categories", () => {
    const workItems = [
      {
        key: "TASK-421",
        repo: "web-app",
        agentRunHealth: {
          state: "expiring",
          severity: "warning",
          label: "Lease expiring",
          summary: "The lease has 10 minutes remaining.",
          freshness: { ageMinutes: 5 },
          actions: [{ id: "extend", label: "Extend 60m" }],
        },
      },
      {
        key: "TASK-422",
        repo: "api-service",
        agentRunHealth: {
          state: "incomplete",
          severity: "high",
          label: "Incomplete context",
          summary: "Missing branch or PR.",
          freshness: { ageMinutes: 12 },
          actions: [{ id: "reclaim", label: "Reclaim" }],
        },
      },
    ];

    const inbox = buildAttentionInbox({ workItems, now });
    const expiring = inbox.find((item) => item.packetKey === "TASK-421");
    const incomplete = inbox.find((item) => item.packetKey === "TASK-422");

    expect(expiring).toMatchObject({
      severity: "warning",
      categories: ["agent"],
      action: { kind: "agent_recovery", recovery: "extend", label: "Extend 60m" },
    });
    expect(incomplete).toMatchObject({
      severity: "high",
      categories: ["agent", "handoff"],
      action: { kind: "agent_recovery", recovery: "reclaim" },
    });
    expect(attentionCount(inbox, "all")).toBe(2);
    expect(attentionCount(inbox, "agent")).toBe(2);
    expect(attentionCount(inbox, "handoff")).toBe(1);
    expect(attentionDestination(expiring)).toBe("agents");
    expect(attentionDestination(incomplete)).toBe("agents");
  });

  it("identifies missing handoff evidence and aging completed handoffs", () => {
    const incomplete = reviewPacket({
      key: "TASK-420",
      lastAgentUpdate: { at: "2026-07-20T11:30:00.000Z", note: "Please review" },
      githubPrUrl: "",
    });
    const inbox = buildAttentionInbox({ workItems: [incomplete, reviewPacket()], now });

    expect(inbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "handoff:TASK-420", categories: ["handoff", "review"] }),
      expect.objectContaining({ id: "review:TASK-431", action: { kind: "open_review", label: "Open review" } }),
    ]));
    expect(attentionCount(inbox, "handoff")).toBe(1);
    expect(attentionCount(inbox, "review")).toBe(2);
    expect(attentionDestination(inbox.find((item) => item.id === "handoff:TASK-420"))).toBe("review");
    expect(attentionDestination(inbox.find((item) => item.id === "review:TASK-431"))).toBe("review");
    expect(JSON.stringify(inbox)).not.toMatch(CSC_LEAKAGE);
  });

  it("offers direct linking only for high-confidence merged PR matches", () => {
    const reconciliation = {
      unmatchedMergedPullRequests: [
        null,
        {
          id: "web-app:74",
          repoId: "web-app",
          number: 74,
          title: "TASK-431 attention inbox",
          url: "https://github.com/your-org/web-app/pull/74",
          mergedAt: "2026-07-20T10:00:00.000Z",
          suggestedPacket: { key: "TASK-431", confidence: "high", reason: "Packet key appears in the pull request" },
        },
        {
          id: "docs-site:75",
          repoId: "docs-site",
          number: 75,
          title: "Small cleanup",
          url: "https://github.com/your-org/docs-site/pull/75",
          mergedAt: "2026-07-20T11:00:00.000Z",
          suggestedPacket: { key: "TASK-430", confidence: "low", reason: "One title term overlaps" },
        },
      ],
    };

    const inbox = buildAttentionInbox({ reconciliation, now });

    expect(inbox.find((item) => item.id.endsWith(":74"))?.action).toEqual({ kind: "link_merge", label: "Link TASK-431" });
    expect(inbox.find((item) => item.id.endsWith(":75"))?.action).toEqual({ kind: "create_follow_up", label: "Create follow-up" });
    expect(attentionCount(inbox, "all")).toBe(2);
    expect(attentionCount(inbox, "github")).toBe(2);
    expect(attentionDestination(inbox[0])).toBe("repos");
    expect(JSON.stringify(inbox)).not.toMatch(CSC_LEAKAGE);
  });

  it("returns an empty inbox when no supplied signal needs intervention", () => {
    expect(buildAttentionInbox({
      workItems: [{ key: "TASK-431", status: "done", agentRunHealth: { state: "idle" } }],
      reconciliation: { unmatchedMergedPullRequests: [] },
      now,
    })).toEqual([]);
  });
});

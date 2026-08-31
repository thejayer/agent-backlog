import { describe, expect, it } from "vitest";
import {
  blockedRepoIds,
  deriveGithubFreshness,
  deriveRepoHealthStatus,
  deriveRepoFreshness,
  githubActionsUrl,
  isRepoBlocked,
  mergeRepoStats,
} from "./repoHealth.mjs";
import { findNextMatchingWorkItem } from "./agentPrompt.mjs";

const CSC_LEAKAGE = /Commerce Street|csc-workspace|csc-crm|CSC-|COM-|commercestreet|Harbor|RegVault|gcloud|linear\.app\/.*COM-/i;

describe("repoHealth helpers", () => {
  it("merges seed and synced failed-run counts", () => {
    expect(mergeRepoStats(
      { id: "worker-service", failedRuns: 2, openPrs: 1 },
      { failedRuns: 3, openPrs: 4, openIssues: 5, branches: ["a", "b"], defaultBranch: "master" },
    )).toMatchObject({
      id: "worker-service",
      failedRuns: 3,
      openPrs: 4,
      openIssues: 5,
      branches: 2,
      defaultBranch: "master",
    });
  });

  it("marks health blocked when failed runs are present", () => {
    expect(deriveRepoHealthStatus({ health: "ready", failedRuns: 0 }, { failedRuns: 2 })).toBe("blocked");
    expect(deriveRepoHealthStatus({ health: "review", failedRuns: 1 })).toBe("blocked");
    expect(deriveRepoHealthStatus({ health: "blocked", failedRuns: 0 })).toBe("blocked");
    expect(deriveRepoHealthStatus({ health: "ready", failedRuns: 0 })).toBe("ready_for_agent");
    expect(isRepoBlocked({ health: "ready", failedRuns: 0 }, { failedRuns: 1 })).toBe(true);
  });

  it("builds blocked repo ids from seed + github cache", () => {
    const repositories = [
      { id: "web-app", health: "ready", failedRuns: 0 },
      { id: "api-service", health: "ready", failedRuns: 0 },
      { id: "worker-service", health: "blocked", failedRuns: 0 },
    ];
    const githubCache = {
      repos: [
        { id: "web-app", failedRuns: 0 },
        { id: "api-service", failedRuns: 2 },
      ],
    };
    expect([...blockedRepoIds(repositories, githubCache)].sort()).toEqual([
      "api-service",
      "worker-service",
    ]);
  });

  it("builds GitHub Actions URLs for generic demo repos", () => {
    expect(githubActionsUrl({ owner: "your-org", name: "worker-service" }))
      .toBe("https://github.com/your-org/worker-service/actions");
    expect(githubActionsUrl({ id: "web-app" })).toBe("https://github.com/your-org/web-app/actions");
  });

  it("distinguishes current, stale, degraded, and syncing evidence", () => {
    const now = Date.parse("2026-08-03T12:00:00.000Z");
    expect(deriveRepoFreshness({ lastSuccessAt: "2026-08-03T11:45:00.000Z" }, { now }).state).toBe("current");
    expect(deriveRepoFreshness({ lastSuccessAt: "2026-08-03T09:00:00.000Z" }, { now }).state).toBe("stale");
    expect(deriveRepoFreshness({ syncState: "degraded", syncError: "Unavailable" }, { now }).state).toBe("degraded");
    expect(deriveRepoFreshness({}, { now, syncing: true }).state).toBe("syncing");
    expect(deriveRepoFreshness({ openPrs: 3 }, { now })).toMatchObject({
      state: "stale",
      label: "Freshness unknown",
    });
  });

  it("reports partial degradation when any repository evidence is stale", () => {
    const now = Date.parse("2026-08-03T12:00:00.000Z");
    const freshness = deriveGithubFreshness({
      syncState: "partially_degraded",
      repos: [
        { lastSuccessAt: "2026-08-03T11:45:00.000Z" },
        { lastSuccessAt: "2026-08-01T09:00:00.000Z", syncState: "stale" },
      ],
    }, "idle", { now });
    expect(freshness).toMatchObject({ state: "partially_degraded" });
    expect(freshness.label).toContain("1 repo affected");
    expect(deriveGithubFreshness({ syncState: "partially_degraded", repos: [] })).toEqual({
      state: "partially_degraded",
      label: "Partially degraded",
    });
    expect(deriveGithubFreshness({ syncState: "degraded", repos: [] })).toEqual({
      state: "degraded",
      label: "GitHub evidence degraded",
    });
  });

  it("does not leak Commerce Street catalog ids or packet language", () => {
    const source = `${githubActionsUrl({ owner: "your-org", name: "web-app" })} ${JSON.stringify(blockedRepoIds([{ id: "web-app", failedRuns: 1 }]))}`;
    expect(source).not.toMatch(CSC_LEAKAGE);
  });
});

describe("findNextMatchingWorkItem blocked-repo filter", () => {
  const items = [
    {
      key: "TASK-A",
      status: "ready_for_agent",
      priority: "high",
      repo: "web-app",
      title: "Web app work",
      summary: "s",
      desiredOutcome: "d",
      acceptanceCriteria: ["a"],
      relevantFiles: ["f"],
      testCommands: ["t"],
      suggestedBranch: "b",
    },
    {
      key: "TASK-B",
      status: "ready_for_agent",
      priority: "urgent",
      repo: "worker-service",
      title: "Worker work",
      summary: "s",
      desiredOutcome: "d",
      acceptanceCriteria: ["a"],
      relevantFiles: ["f"],
      testCommands: ["t"],
      suggestedBranch: "b",
    },
  ];

  it("skips blocked repos unless an explicit repo filter is set", () => {
    const blocked = new Set(["worker-service"]);
    expect(findNextMatchingWorkItem(items, { blockedRepoIds: blocked }).key).toBe("TASK-A");
    expect(findNextMatchingWorkItem(items, {
      repo: "worker-service",
      blockedRepoIds: blocked,
    }).key).toBe("TASK-B");
  });
});

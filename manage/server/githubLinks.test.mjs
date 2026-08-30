import { describe, expect, it } from "vitest";
import { findGithubMatchesForItem, reconcileMergedPullRequests } from "./githubLinks.mjs";

const CSC_LEAKAGE = /Commerce Street|csc-workspace|CSC-|COM-|Harbor|RegVault|csc-crm-io/i;

describe("findGithubMatchesForItem", () => {
  it("includes merged pull requests and prefers their delivery evidence over duplicate open summaries", () => {
    const prUrl = "https://github.com/your-org/web-app/pull/201";
    const matches = findGithubMatchesForItem(
      { key: "TASK-201", repo: "web-app" },
      {
        source: "gh",
        repos: [
          {
            id: "web-app",
            slug: "your-org/web-app",
            mergedPulls: [
              {
                number: 201,
                title: "TASK-201 evidence gate",
                branch: "codex/task-201-review-evidence-gate",
                url: prUrl,
                mergedAt: "2026-07-17T12:00:00.000Z",
                mergeCommitSha: "abc123",
              },
            ],
            latestPulls: [
              {
                number: 201,
                title: "TASK-201 evidence gate",
                branch: "codex/task-201-review-evidence-gate",
                url: prUrl,
              },
            ],
          },
        ],
      },
    );

    expect(matches.pullRequests).toHaveLength(1);
    expect(matches.pullRequests[0]).toMatchObject({
      url: prUrl,
      mergedAt: "2026-07-17T12:00:00.000Z",
      mergeCommitSha: "abc123",
    });
    expect(matches.bestPrUrl).toBe(prUrl);
    expect(JSON.stringify(matches)).not.toMatch(CSC_LEAKAGE);
  });

  it("does not confuse a shorter packet key with a longer packet number", () => {
    const matches = findGithubMatchesForItem(
      { key: "TASK-42", repo: "web-app" },
      {
        source: "test-cache",
        repos: [
          {
            id: "web-app",
            slug: "your-org/web-app",
            mergedPulls: [
              {
                number: 72,
                title: "TASK-429 reconcile merged pull requests",
                branch: "codex/task-429-reconciliation",
                url: "https://github.com/your-org/web-app/pull/72",
                mergedAt: "2026-07-20T01:00:00.000Z",
              },
            ],
          },
        ],
      },
    );

    expect(matches.pullRequests).toEqual([]);
    expect(matches.bestPrUrl).toBe("");
  });
});

describe("reconcileMergedPullRequests", () => {
  it("returns only unmatched merges and suggests the strongest packet-key match", () => {
    const cache = {
      source: "test-cache",
      syncedAt: "2026-07-20T01:00:00.000Z",
      repos: [
        {
          id: "web-app",
          name: "web-app",
          slug: "your-org/web-app",
          mergedPulls: [
            {
              number: 71,
              title: "TASK-428 evidence gate",
              branch: "codex/task-428-review-evidence-gate",
              url: "https://github.com/your-org/web-app/pull/71",
              mergedAt: "2026-07-18T18:20:51.000Z",
            },
            {
              number: 72,
              title: "TASK-429 reconcile merged pull requests",
              branch: "codex/task-429-reconcile-merged-pull-requests-with-shipped-packets",
              url: "https://github.com/your-org/web-app/pull/72",
              mergedAt: "2026-07-20T01:00:00.000Z",
            },
          ],
          latestPulls: [],
          branches: [],
          latestIssues: [],
          failedWorkflowRuns: [],
        },
      ],
    };
    const reconciliation = reconcileMergedPullRequests([
      {
        key: "TASK-428",
        repo: "web-app",
        title: "Gate Review completion on delivery evidence",
        status: "done",
        githubPrUrl: "https://github.com/your-org/web-app/pull/71",
      },
      {
        key: "TASK-429",
        repo: "web-app",
        title: "Reconcile merged pull requests with shipped packets",
        suggestedBranch: "codex/task-429-reconcile-merged-pull-requests-with-shipped-packets",
        status: "claimed",
      },
    ], cache);

    expect(reconciliation).toMatchObject({
      totalMergedPullRequests: 2,
      linkedMergedPullRequests: 1,
      source: "test-cache",
    });
    expect(reconciliation.unmatchedMergedPullRequests).toHaveLength(1);
    expect(reconciliation.unmatchedMergedPullRequests[0]).toMatchObject({
      repoId: "web-app",
      number: 72,
      suggestedPacket: {
        key: "TASK-429",
        score: 100,
        confidence: "high",
      },
    });
    expect(JSON.stringify(reconciliation)).not.toMatch(CSC_LEAKAGE);
  });

  it("treats completion evidence and cached links as resolved without duplicating merged PRs", () => {
    const url = "https://github.com/your-org/web-app/pull/72";
    const cache = {
      source: "test-cache",
      repos: [
        {
          id: "web-app",
          slug: "your-org/web-app",
          mergedPulls: [
            { number: 72, title: "TASK-429", url, mergedAt: "2026-07-20T01:00:00.000Z" },
            { number: 72, title: "TASK-429 duplicate", url, mergedAt: "2026-07-20T01:00:00.000Z" },
          ],
        },
      ],
    };
    const reconciliation = reconcileMergedPullRequests([
      { key: "TASK-429", repo: "web-app", status: "done", completionEvidence: { prUrl: `${url}/` } },
    ], cache);

    expect(reconciliation.totalMergedPullRequests).toBe(1);
    expect(reconciliation.linkedMergedPullRequests).toBe(1);
    expect(reconciliation.unmatchedMergedPullRequests).toEqual([]);
  });

  it("keeps a linked merge unmatched until its packet is done", () => {
    const url = "https://github.com/your-org/web-app/pull/72";
    const cache = {
      source: "test-cache",
      repos: [
        {
          id: "web-app",
          slug: "your-org/web-app",
          mergedPulls: [
            { number: 72, title: "TASK-429 reconciliation", url, mergedAt: "2026-07-20T01:00:00.000Z" },
          ],
        },
      ],
    };
    const reconciliation = reconcileMergedPullRequests([
      { key: "TASK-429", repo: "web-app", status: "draft", githubPrUrl: url },
    ], cache);

    expect(reconciliation.linkedMergedPullRequests).toBe(0);
    expect(reconciliation.unmatchedMergedPullRequests).toHaveLength(1);
    expect(reconciliation.unmatchedMergedPullRequests[0]).toMatchObject({
      url,
      suggestedPacket: { key: "TASK-429", score: 100 },
    });
  });

  it("leaves unmatched merges without a packet suggestion when no TASK key or title overlap exists", () => {
    const reconciliation = reconcileMergedPullRequests(
      [
        {
          key: "TASK-101",
          repo: "web-app",
          title: "Fix contact import duplicate handling",
          status: "ready_for_agent",
        },
      ],
      {
        source: "mock",
        repos: [
          {
            id: "marketing-site",
            name: "marketing-site",
            slug: "your-org/marketing-site",
            mergedPulls: [
              {
                number: 88,
                title: "Refresh the public homepage hero",
                branch: "docs/homepage-hero",
                url: "https://github.com/your-org/marketing-site/pull/88",
                mergedAt: "2026-07-21T09:00:00.000Z",
              },
            ],
          },
        ],
      },
    );

    expect(reconciliation.unmatchedMergedPullRequests).toHaveLength(1);
    expect(reconciliation.unmatchedMergedPullRequests[0].suggestedPacket).toBeNull();
    expect(JSON.stringify(reconciliation)).not.toMatch(CSC_LEAKAGE);
  });
});

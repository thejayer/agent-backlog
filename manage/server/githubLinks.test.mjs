import { describe, expect, it } from "vitest";
import {
  completionLinkMatches,
  findCompletionPullRequest,
  findGithubMatchesForItem,
  parseGithubPullRequestRef,
  reconcileMergedPullRequests,
} from "./githubLinks.mjs";

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

  it("includes a reconciled merge linked by packet branch instead of TASK key", () => {
    const prUrl = "https://github.com/your-org/web-app/pull/88";
    const matches = findGithubMatchesForItem(
      {
        key: "TASK-201",
        repo: "web-app",
        suggestedBranch: "docs/homepage-hero",
        githubPrUrl: prUrl,
      },
      {
        source: "mock",
        repos: [
          {
            id: "web-app",
            slug: "your-org/web-app",
            mergedPulls: [
              {
                number: 88,
                title: "Refresh the public homepage hero",
                branch: "docs/homepage-hero",
                url: prUrl,
                mergedAt: "2026-07-21T09:00:00.000Z",
                mergeCommitSha: "def456",
                deliveryEvidence: { tests: { success: true, results: ["mock"] } },
              },
            ],
          },
        ],
      },
    );

    expect(matches.pullRequests).toHaveLength(1);
    expect(matches.pullRequests[0]).toMatchObject({
      url: prUrl,
      mergedAt: "2026-07-21T09:00:00.000Z",
      mergeCommitSha: "def456",
    });
    expect(matches.bestPrUrl).toBe(prUrl);
    expect(JSON.stringify(matches)).not.toMatch(CSC_LEAKAGE);
  });
});

describe("parseGithubPullRequestRef", () => {
  it("parses owner, repo, and number from a pull request URL", () => {
    expect(parseGithubPullRequestRef("https://github.com/thejayer/agent-backlog/pull/21/")).toEqual({
      owner: "thejayer",
      repo: "agent-backlog",
      slug: "thejayer/agent-backlog",
      number: 21,
      url: "https://github.com/thejayer/agent-backlog/pull/21",
    });
  });

  it("rejects non-pull-request URLs", () => {
    expect(parseGithubPullRequestRef("https://github.com/thejayer/agent-backlog")).toBeNull();
    expect(parseGithubPullRequestRef("thejayer/agent-backlog#21")).toBeNull();
  });
});

describe("findCompletionPullRequest", () => {
  const prUrl = "https://github.com/thejayer/docs-site/pull/88";
  const merged = {
    number: 88,
    url: prUrl,
    mergedAt: "2026-07-31T13:11:58Z",
    mergeCommitSha: "a4e7bf67",
  };

  it("uses already-linked githubLinks when the packet repo cache misses", () => {
    const resolved = findCompletionPullRequest(
      {
        key: "TASK-352",
        repo: "agent-backlog",
        githubPrUrl: "https://github.com/thejayer/agent-backlog/pull/21",
        githubLinks: {
          source: "github-token",
          repoSlug: "thejayer/agent-backlog",
          pullRequests: [{
            number: 21,
            url: "https://github.com/thejayer/agent-backlog/pull/21",
            mergedAt: "2026-07-31T03:23:51Z",
            mergeCommitSha: "cfa8f212",
          }],
        },
      },
      {},
      { pullRequests: [], repoSlug: "" },
      { source: "github-cache", repos: [] },
    );

    expect(resolved.source).toBe("github-token");
    expect(resolved.repoSlug).toBe("thejayer/agent-backlog");
    expect(resolved.pullRequest.mergeCommitSha).toBe("cfa8f212");
    expect(JSON.stringify(resolved)).not.toMatch(CSC_LEAKAGE);
  });

  it("finds a merged PR in another cached repo when packet.repo does not match", () => {
    const resolved = findCompletionPullRequest(
      { key: "TASK-361", repo: "agent-backlog", githubPrUrl: prUrl },
      {},
      { pullRequests: [], repoSlug: "" },
      {
        source: "github-cache",
        repos: [
          {
            id: "docs-site",
            slug: "thejayer/docs-site",
            mergedPulls: [merged],
          },
        ],
      },
    );

    expect(resolved.source).toBe("github-cache");
    expect(resolved.repoSlug).toBe("thejayer/docs-site");
    expect(resolved.pullRequest).toMatchObject(merged);
    expect(JSON.stringify(resolved)).not.toMatch(CSC_LEAKAGE);
  });

  it("returns a parseable URL for live GitHub delivery when nothing is cached or linked", () => {
    const resolved = findCompletionPullRequest(
      { key: "TASK-436", repo: "research-notes", githubPrUrl: "https://github.com/thejayer/research-notes/pull/111" },
      {},
      { pullRequests: [], repoSlug: "" },
      { source: "github-cache", repos: [] },
    );

    expect(resolved.pullRequest).toBeNull();
    expect(resolved.parsed).toEqual({
      owner: "thejayer",
      repo: "research-notes",
      slug: "thejayer/research-notes",
      number: 111,
      url: "https://github.com/thejayer/research-notes/pull/111",
    });
    expect(JSON.stringify(resolved)).not.toMatch(CSC_LEAKAGE);
  });
});

describe("completionLinkMatches", () => {
  const requestedUrl = "https://github.com/thejayer/agent-backlog/pull/21";
  const resolvedPullRequest = {
    number: 21,
    url: requestedUrl,
    branch: "fix/task-352",
    mergedAt: "2026-07-31T03:23:51Z",
    mergeCommitSha: "cfa8f212",
  };
  const workItem = { key: "TASK-352", repo: "agent-backlog", githubBranch: "legacy-branch" };
  const unrelatedMatches = {
    repoId: "agent-backlog",
    repoSlug: "thejayer/agent-backlog",
    source: "github-cache",
    bestPrUrl: "https://github.com/thejayer/agent-backlog/pull/7",
    pullRequests: [{
      number: 7,
      url: "https://github.com/thejayer/agent-backlog/pull/7",
      mergedAt: "2026-06-12T11:55:00.000Z",
    }],
    branches: [{ name: "unrelated" }],
    issues: [],
    workflowRuns: [],
  };

  it("persists the resolved pull request instead of unrelated packet-repo cache matches", () => {
    const linkMatches = completionLinkMatches(
      workItem,
      {
        pullRequest: resolvedPullRequest,
        repoSlug: "thejayer/agent-backlog",
        source: "github-token",
        requestedUrl,
      },
      unrelatedMatches,
    );

    expect(linkMatches).toMatchObject({
      repoId: "agent-backlog",
      repoSlug: "thejayer/agent-backlog",
      source: "github-token",
      bestPrUrl: requestedUrl,
      bestBranch: "fix/task-352",
      pullRequests: [resolvedPullRequest],
      branches: [],
      issues: [],
      workflowRuns: [],
    });
    expect(linkMatches.pullRequests).not.toEqual(unrelatedMatches.pullRequests);
    expect(JSON.stringify(linkMatches)).not.toMatch(CSC_LEAKAGE);
  });

  it("returns cache matches only when they already include the requested merged pull request", () => {
    const matchingCache = {
      ...unrelatedMatches,
      bestPrUrl: requestedUrl,
      pullRequests: [resolvedPullRequest, ...unrelatedMatches.pullRequests],
      branches: [{ name: "fix/task-352" }],
    };

    expect(completionLinkMatches(
      workItem,
      { pullRequest: resolvedPullRequest, requestedUrl },
      matchingCache,
    )).toBe(matchingCache);
  });

  it("treats mixed-case GitHub URLs as the same requested pull request", () => {
    const mixedCaseUrl = "https://GitHub.com/TheJayer/Agent-Backlog/pull/21/";
    const matchingCache = {
      ...unrelatedMatches,
      bestPrUrl: requestedUrl,
      pullRequests: [resolvedPullRequest],
    };

    expect(completionLinkMatches(
      workItem,
      {
        pullRequest: { ...resolvedPullRequest, url: mixedCaseUrl },
        requestedUrl: mixedCaseUrl,
      },
      matchingCache,
    )).toBe(matchingCache);
  });

  it("returns null when neither the cache nor the resolver has the requested pull request", () => {
    expect(completionLinkMatches(
      workItem,
      { pullRequest: null, requestedUrl },
      unrelatedMatches,
    )).toBeNull();
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

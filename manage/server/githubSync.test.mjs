import { describe, expect, it, vi } from "vitest";
import {
  createMockGithubCache,
  fetchClosedPullsIncremental,
  fetchCompletedWorkflowRuns,
  fetchPullRequestDeliveryEvidence,
  revalidateFailedWorkflowRuns,
  summarizeGithubSyncStatus,
  summarizeMergedPulls,
  syncGithubCache,
} from "./githubSync.mjs";

const CSC_LEAKAGE = /Commerce Street|csc-workspace|csc-crm|CSC-|COM-|commercestreet|Harbor|RegVault|gcloud|linear\.app\/.*COM-/i;

function testRepo(id) {
  return {
    id,
    owner: "your-org",
    name: id,
    domain: id === "web-app" ? "Web app" : id,
    openPrs: 0,
    openIssues: 0,
    failedRuns: 0,
  };
}

function successfulSyncRequest(overrides = {}) {
  return vi.fn(async (endpoint) => {
    if (overrides[endpoint]) {
      return overrides[endpoint](endpoint);
    }
    if (/^\/repos\/your-org\/[^/?]+$/.test(endpoint)) {
      return { default_branch: "main", pushed_at: "2026-08-01T00:00:00.000Z" };
    }
    if (endpoint.includes("/pulls?state=open")) {
      return [];
    }
    if (endpoint.includes("/pulls?state=closed")) {
      return [];
    }
    if (endpoint.includes("/issues?state=open")) {
      return [];
    }
    if (endpoint.includes("/actions/runs?")) {
      return { workflow_runs: [], total_count: 0 };
    }
    if (endpoint.includes("/branches?")) {
      return [{ name: "main", protected: true, commit: { sha: "main" } }];
    }
    throw new Error(`Unexpected endpoint: ${endpoint}`);
  });
}

describe("GitHub delivery evidence", () => {
  it("does not verify pending or failed pull request checks", async () => {
    const request = vi.fn(async (endpoint) => {
      if (endpoint === "/repos/your-org/web-app/pulls/101") {
        return {
          html_url: "https://github.com/your-org/web-app/pull/101",
          merged_at: "2026-07-10T18:00:00.000Z",
          head: { sha: "head-101" },
        };
      }
      if (endpoint.includes("/files?")) {
        return [{ filename: "web-app/src/App.jsx" }];
      }
      if (endpoint.includes("/check-runs?")) {
        return {
          total_count: 1,
          check_runs: [{ id: 1, name: "CI", status: "completed", conclusion: "failure" }],
        };
      }
      return [{ context: "review", state: "pending" }];
    });

    const evidence = await fetchPullRequestDeliveryEvidence("your-org/web-app", 101, request);

    expect(evidence.tests).toEqual({
      success: false,
      results: ["CI: failure", "review: pending"],
    });
  });

  it("does not miss a failed check run after the first 100 results", async () => {
    const successfulRuns = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      name: `Check ${index + 1}`,
      status: "completed",
      conclusion: "success",
    }));
    const request = vi.fn(async (endpoint) => {
      if (endpoint === "/repos/your-org/web-app/pulls/101") {
        return {
          html_url: "https://github.com/your-org/web-app/pull/101",
          merged_at: "2026-07-10T18:00:00.000Z",
          head: { sha: "head-101" },
        };
      }
      if (endpoint.includes("/files?")) {
        return [{ filename: "web-app/src/App.jsx" }];
      }
      if (endpoint.endsWith("check-runs?filter=latest&per_page=100&page=1")) {
        return { total_count: 101, check_runs: successfulRuns };
      }
      if (endpoint.endsWith("check-runs?filter=latest&per_page=100&page=2")) {
        return {
          total_count: 101,
          check_runs: [{ id: 101, name: "Late failure", status: "completed", conclusion: "failure" }],
        };
      }
      if (endpoint.includes("/statuses?")) {
        return [];
      }
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    const evidence = await fetchPullRequestDeliveryEvidence("your-org/web-app", 101, request);

    expect(evidence.tests.success).toBe(false);
    expect(evidence.tests.results).toHaveLength(101);
    expect(evidence.tests.results.at(-1)).toBe("Late failure: failure");
  });
});

describe("incremental GitHub cache refresh", () => {
  const now = () => new Date("2026-08-03T12:00:00.000Z");

  it("stops closed-pull pagination at the stored update checkpoint", async () => {
    const request = vi.fn(async () => [
      { number: 2, updated_at: "2026-08-03T10:00:00.000Z", merged_at: "2026-08-03T10:00:00.000Z" },
      { number: 1, updated_at: "2026-08-01T10:00:00.000Z", merged_at: "2026-08-01T10:00:00.000Z" },
    ]);

    const pulls = await fetchClosedPullsIncremental("your-org/web-app", request, {
      updatedSince: "2026-08-02T00:00:00.000Z",
      historyCutoff: "2025-01-01T00:00:00.000Z",
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(pulls.map((pull) => pull.number)).toEqual([2]);
  });

  it("skips already-fresh closed pull pages on a second sync", async () => {
    const repo = testRepo("web-app");
    const priorCache = {
      source: "gh",
      syncedAt: "2026-08-03T11:00:00.000Z",
      lastSuccessAt: "2026-08-03T11:00:00.000Z",
      syncState: "current",
      repos: [{
        ...repo,
        slug: "your-org/web-app",
        defaultBranch: "main",
        mergedPulls: [{ number: 1, title: "Existing", mergedAt: "2026-08-01T00:00:00.000Z" }],
        failedWorkflowRuns: [],
        latestPulls: [],
        latestIssues: [],
        branches: [],
        checkpoints: { closedPullUpdatedAt: "2026-08-03T10:00:00.000Z" },
      }],
    };
    const request = successfulSyncRequest({
      "/repos/your-org/web-app/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=1": async () => [{
        number: 1,
        title: "Existing",
        html_url: "https://github.com/your-org/web-app/pull/1",
        updated_at: "2026-08-01T00:00:00.000Z",
        merged_at: "2026-08-01T00:00:00.000Z",
      }],
    });

    const cache = await syncGithubCache({
      repoList: [repo],
      priorCache,
      request,
      now,
      write: vi.fn(),
    });

    expect(request.mock.calls.filter(([endpoint]) => String(endpoint).includes("/pulls?state=closed"))).toHaveLength(1);
    expect(cache.repos[0].mergedPulls.map((pull) => pull.number)).toEqual([1]);
    expect(cache.syncState).toBe("current");
    expect(summarizeGithubSyncStatus(cache).freshness).toBe("fresh");
  });

  it("merges newly updated pull requests into a live cache", async () => {
    const repo = testRepo("web-app");
    const priorCache = {
      source: "gh",
      syncedAt: "2026-08-01T00:00:00.000Z",
      repos: [{
        ...repo,
        slug: "your-org/web-app",
        defaultBranch: "main",
        mergedPulls: [{ number: 1, title: "Existing", mergedAt: "2026-08-01T00:00:00.000Z" }],
        failedWorkflowRuns: [],
        latestPulls: [],
        latestIssues: [],
        branches: [],
        checkpoints: { closedPullUpdatedAt: "2026-08-01T00:00:00.000Z" },
      }],
    };
    const request = successfulSyncRequest({
      "/repos/your-org/web-app/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=1": async () => [{
        number: 2,
        title: "TASK-101: Incremental merge",
        html_url: "https://github.com/your-org/web-app/pull/2",
        updated_at: "2026-08-03T10:00:00.000Z",
        merged_at: "2026-08-03T10:00:00.000Z",
      }],
    });

    const cache = await syncGithubCache({
      repoList: [repo],
      priorCache,
      request,
      now,
      write: vi.fn(),
    });

    expect(cache.syncState).toBe("current");
    expect(cache.repos[0].mergedPulls.map((pull) => pull.number)).toEqual([2, 1]);
    expect(cache.repos[0].checkpoints.closedPullUpdatedAt).toBe("2026-08-03T10:00:00.000Z");
    expect(cache.requestBudget.used).toBeGreaterThan(0);
  });

  it("preserves last-known-good repository data when one refresh fails", async () => {
    const healthy = testRepo("docs-site");
    const failing = testRepo("web-app");
    const priorCache = {
      source: "github-token",
      syncedAt: "2026-08-01T00:00:00.000Z",
      repos: [{
        ...failing,
        slug: "your-org/web-app",
        openPrs: 7,
        mergedPulls: [{ number: 9, mergedAt: "2026-08-01T00:00:00.000Z" }],
        latestPulls: [],
        latestIssues: [],
        branches: [],
        failedWorkflowRuns: [],
      }],
    };
    const request = successfulSyncRequest({
      "/repos/your-org/web-app": async () => {
        throw new Error("Repository unavailable");
      },
    });

    const cache = await syncGithubCache({
      repoList: [healthy, failing],
      priorCache,
      request,
      now,
      concurrency: 2,
      write: vi.fn(),
    });
    const failedRepo = cache.repos.find((repo) => repo.id === "web-app");

    expect(cache.syncState).toBe("partially_degraded");
    expect(failedRepo).toMatchObject({
      openPrs: 7,
      syncState: "stale",
      syncError: "Repository unavailable",
      lastSuccessAt: "2026-08-01T00:00:00.000Z",
    });
    expect(failedRepo.mergedPulls[0].number).toBe(9);
    expect(cache.repos.find((repo) => repo.id === "docs-site").syncState).toBe("current");
    expect(summarizeGithubSyncStatus(cache).freshness).toBe("stale");
  });

  it("keeps total failures degraded without assigning success evidence to a new repository", async () => {
    const existing = testRepo("web-app");
    const newRepo = testRepo("docs-site");
    const previousSuccessAt = "2026-08-01T00:00:00.000Z";
    const priorCache = {
      source: "gh",
      syncedAt: previousSuccessAt,
      repos: [{
        ...existing,
        slug: "your-org/web-app",
        latestPulls: [],
        mergedPulls: [],
        latestIssues: [],
        branches: [],
        failedWorkflowRuns: [],
      }],
    };
    const request = vi.fn(async () => {
      throw new Error("GitHub unavailable");
    });

    const cache = await syncGithubCache({
      repoList: [existing, newRepo],
      priorCache,
      request,
      now,
      write: vi.fn(),
    });

    expect(cache).toMatchObject({
      syncedAt: previousSuccessAt,
      lastSuccessAt: previousSuccessAt,
      syncState: "degraded",
    });
    expect(cache.repos.find((repo) => repo.id === "web-app")).toMatchObject({
      lastSuccessAt: previousSuccessAt,
      syncState: "stale",
    });
    expect(cache.repos.find((repo) => repo.id === "docs-site")).toMatchObject({
      lastSuccessAt: "",
      syncState: "degraded",
    });
    expect(summarizeGithubSyncStatus(cache).freshness).toBe("stale");
  });

  it("removes cached failures when an incrementally fetched run succeeds", async () => {
    const repo = testRepo("web-app");
    const priorCache = {
      source: "gh",
      syncedAt: "2026-08-01T00:00:00.000Z",
      repos: [{
        ...repo,
        slug: "your-org/web-app",
        mergedPulls: [],
        latestPulls: [],
        latestIssues: [],
        branches: [],
        failedRuns: 1,
        failedWorkflowRuns: [{ id: 12, name: "CI", conclusion: "failure", updatedAt: "2026-08-01T00:00:00.000Z" }],
      }],
    };
    const request = successfulSyncRequest({
      "/repos/your-org/web-app/actions/runs?status=completed&per_page=100&page=1": async () => ({
        workflow_runs: [{
          id: 12,
          name: "CI",
          status: "completed",
          conclusion: "success",
          created_at: "2026-08-03T10:00:00.000Z",
          updated_at: "2026-08-03T10:00:00.000Z",
        }],
      }),
    });

    const cache = await syncGithubCache({
      repoList: [repo],
      priorCache,
      request,
      now,
      write: vi.fn(),
    });

    expect(cache.repos[0].failedRuns).toBe(0);
    expect(cache.repos[0].failedWorkflowRuns).toEqual([]);
  });

  it("stops workflow pagination on created_at, not updated_at", async () => {
    const pageOne = Array.from({ length: 100 }, (_, index) => ({
      id: 200 + index,
      created_at: "2026-08-03T10:00:00.000Z",
      updated_at: index === 0 ? "2026-08-01T00:00:00.000Z" : "2026-08-03T10:00:00.000Z",
      conclusion: "success",
    }));
    const pageTwo = [
      { id: 2, created_at: "2026-08-03T09:00:00.000Z", updated_at: "2026-08-03T09:00:00.000Z", conclusion: "failure" },
      { id: 1, created_at: "2026-08-01T10:00:00.000Z", updated_at: "2026-08-01T10:00:00.000Z", conclusion: "failure" },
    ];
    const request = vi.fn()
      .mockResolvedValueOnce({ workflow_runs: pageOne })
      .mockResolvedValueOnce({ workflow_runs: pageTwo });

    const runs = await fetchCompletedWorkflowRuns("your-org/web-app", request, {
      createdSince: "2026-08-02T00:00:00.000Z",
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(runs.workflow_runs.map((run) => run.id)).toEqual([
      ...pageOne.map((run) => run.id),
      2,
    ]);
  });

  it("revalidates a cached failure by id so a later successful re-run is dropped", async () => {
    const request = vi.fn(async (endpoint) => {
      if (endpoint === "/repos/your-org/web-app/actions/runs/12") {
        return {
          id: 12,
          name: "CI",
          status: "completed",
          conclusion: "success",
          created_at: "2026-07-01T00:00:00.000Z",
          updated_at: "2026-08-03T10:00:00.000Z",
        };
      }
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    await expect(revalidateFailedWorkflowRuns(
      "your-org/web-app",
      [{ id: 12, name: "CI", conclusion: "failure", updatedAt: "2026-08-01T00:00:00.000Z" }],
      request,
    )).resolves.toEqual([]);
    expect(request).toHaveBeenCalledWith("/repos/your-org/web-app/actions/runs/12");
  });

  it("drops a cached failed run after a re-run succeeds off the first list page", async () => {
    const repo = testRepo("web-app");
    const priorCache = {
      source: "gh",
      syncedAt: "2026-08-02T00:00:00.000Z",
      repos: [{
        ...repo,
        slug: "your-org/web-app",
        mergedPulls: [],
        latestPulls: [],
        latestIssues: [],
        branches: [],
        failedRuns: 1,
        failedWorkflowRuns: [{
          id: 12,
          name: "CI",
          conclusion: "failure",
          updatedAt: "2026-08-01T00:00:00.000Z",
        }],
        checkpoints: {
          workflowRunCreatedAt: "2026-08-02T00:00:00.000Z",
          workflowRunUpdatedAt: "2026-08-02T00:00:00.000Z",
        },
      }],
    };
    const newerCreatedRuns = Array.from({ length: 100 }, (_, index) => ({
      id: 200 + index,
      name: "Lint",
      status: "completed",
      conclusion: "success",
      created_at: "2026-08-03T09:00:00.000Z",
      updated_at: "2026-08-01T12:00:00.000Z",
    }));
    const request = successfulSyncRequest({
      "/repos/your-org/web-app/actions/runs?status=completed&per_page=100&page=1": async () => ({
        workflow_runs: newerCreatedRuns,
      }),
      "/repos/your-org/web-app/actions/runs?status=completed&per_page=100&page=2": async () => ({
        workflow_runs: [{
          id: 12,
          name: "CI",
          status: "completed",
          conclusion: "success",
          created_at: "2026-07-01T00:00:00.000Z",
          updated_at: "2026-08-03T10:00:00.000Z",
        }],
      }),
      "/repos/your-org/web-app/actions/runs/12": async () => ({
        id: 12,
        name: "CI",
        status: "completed",
        conclusion: "success",
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-08-03T10:00:00.000Z",
      }),
    });

    const cache = await syncGithubCache({
      repoList: [repo],
      priorCache,
      request,
      now,
      write: vi.fn(),
    });

    expect(cache.repos[0].failedRuns).toBe(0);
    expect(cache.repos[0].failedWorkflowRuns).toEqual([]);
    expect(request).toHaveBeenCalledWith("/repos/your-org/web-app/actions/runs/12");
    expect(JSON.stringify(cache)).not.toMatch(CSC_LEAKAGE);
  });

  it("bounds repository concurrency and stops at the shared request budget", async () => {
    const repos = [testRepo("web-app"), testRepo("api-service"), testRepo("docs-site"), testRepo("worker-service")];
    let activeMetadata = 0;
    let maxActiveMetadata = 0;
    const request = successfulSyncRequest(Object.fromEntries(repos.map((repo) => [
      `/repos/your-org/${repo.id}`,
      async () => {
        activeMetadata += 1;
        maxActiveMetadata = Math.max(maxActiveMetadata, activeMetadata);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeMetadata -= 1;
        return { default_branch: "main" };
      },
    ])));

    const cache = await syncGithubCache({
      repoList: repos,
      priorCache: null,
      request,
      now,
      concurrency: 2,
      requestBudget: 13,
      write: vi.fn(),
    });

    expect(maxActiveMetadata).toBe(2);
    expect(cache.requestBudget).toEqual({ used: 13, limit: 13 });
    expect(cache.repos.some((repo) => repo.syncError.includes("request budget exhausted"))).toBe(true);
  });

  it("records rate-limit context without retrying the repository", async () => {
    const repo = testRepo("web-app");
    const request = successfulSyncRequest({
      "/repos/your-org/web-app": async () => {
        const error = new Error("API rate limit exceeded");
        error.rateLimited = true;
        error.retryAfter = "60";
        throw error;
      },
    });

    const cache = await syncGithubCache({
      repoList: [repo],
      priorCache: null,
      request,
      now,
      write: vi.fn(),
    });

    expect(request.mock.calls.filter(([endpoint]) => endpoint === "/repos/your-org/web-app")).toHaveLength(1);
    expect(cache.repos[0]).toMatchObject({ syncState: "degraded" });
    expect(cache.repos[0].syncError).toContain("retry after 60s");
  });

  it("drops merged pull requests older than the bounded history window", async () => {
    const repo = testRepo("web-app");
    const priorCache = {
      source: "gh",
      syncedAt: "2026-08-01T00:00:00.000Z",
      repos: [{
        ...repo,
        slug: "your-org/web-app",
        mergedPulls: [{ number: 1, mergedAt: "2023-01-01T00:00:00.000Z" }],
        latestPulls: [],
        latestIssues: [],
        branches: [],
        failedWorkflowRuns: [],
      }],
    };
    const cache = await syncGithubCache({
      repoList: [repo],
      priorCache,
      request: successfulSyncRequest(),
      now,
      write: vi.fn(),
    });

    expect(cache.repos[0].mergedPulls).toEqual([]);
    expect(cache.historyCutoff).toBe("2024-08-03T12:00:00.000Z");
  });

  it("retains only merged pulls with their completion metadata", () => {
    const result = summarizeMergedPulls([
      {
        number: 12,
        title: "TASK-101: Merged work",
        html_url: "https://github.com/your-org/web-app/pull/12",
        head: { ref: "codex/task-101" },
        base: { ref: "main" },
        user: { login: "codex" },
        merged_by: { login: "operator" },
        merged_at: "2026-07-10T18:00:00.000Z",
        closed_at: "2026-07-10T18:00:00.000Z",
        merge_commit_sha: "merge-12",
      },
      {
        number: 11,
        title: "Closed without merge",
        html_url: "https://github.com/your-org/web-app/pull/11",
        merged_at: null,
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        number: 12,
        branch: "codex/task-101",
        baseBranch: "main",
        mergedBy: "operator",
        mergedAt: "2026-07-10T18:00:00.000Z",
        mergeCommitSha: "merge-12",
      }),
    ]);
  });
});

describe("mock GitHub sync", () => {
  it("writes a fresh mock cache with TASK keys and generic demo repos", async () => {
    const writes = [];
    const cache = await syncGithubCache({
      mock: true,
      write: async (value) => {
        writes.push(value);
      },
    });

    expect(writes).toHaveLength(1);
    expect(cache).toMatchObject({
      source: "mock",
      syncState: "current",
    });
    expect(summarizeGithubSyncStatus(cache)).toMatchObject({
      source: "mock",
      freshness: "fresh",
      syncState: "current",
    });
    expect(cache.repos.some((repo) => repo.slug === "your-org/web-app")).toBe(true);
    expect(cache.repos.some((repo) => repo.mergedPulls.some((pull) => String(pull.title).startsWith("TASK-")))).toBe(true);
    expect(cache.repos.some((repo) => repo.mergedPulls.some((pull) => pull.deliveryEvidence?.tests?.success))).toBe(true);
    expect(JSON.stringify(cache)).not.toMatch(CSC_LEAKAGE);
  });

  it("includes merged work in the mock cache used by local Review gating", () => {
    const cache = createMockGithubCache();
    const webApp = cache.repos.find((repo) => repo.id === "web-app");

    expect(webApp.mergedPulls[0]).toMatchObject({
      title: expect.stringContaining("TASK-101"),
      url: "https://github.com/your-org/web-app/pull/101",
    });
    expect(webApp.deliveryEvidence || webApp.mergedPulls[0].deliveryEvidence).toMatchObject({
      tests: { success: true },
      files: { success: true },
    });
  });
});

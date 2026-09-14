import { describe, expect, it, vi } from "vitest";
import { resolveCompletionGithubEvidence } from "./completionWrite.mjs";

const prUrl = "https://github.com/your-org/web-app/pull/101";
const workItem = {
  key: "TASK-101",
  repo: "web-app",
  githubPrUrl: prUrl,
  githubBranch: "codex/task-101-closeout",
  revision: 4,
};

const unmergedCache = {
  source: "github-cache",
  repos: [{
    id: "web-app",
    name: "web-app",
    slug: "your-org/web-app",
    latestPulls: [{
      url: prUrl,
      number: 101,
      title: "TASK-101 contact import",
      branch: "codex/task-101-closeout",
    }],
    branches: [{ name: "codex/task-101-closeout" }],
    mergedPulls: [],
    latestIssues: [],
    failedWorkflowRuns: [],
  }],
};

describe("resolveCompletionGithubEvidence", () => {
  it("does not persist cache matches and returns live merged evidence for mark done", async () => {
    const fetchEvidence = vi.fn(async () => ({
      pullRequest: {
        url: prUrl,
        number: 101,
        mergedAt: "2026-06-12T11:55:00.000Z",
        mergeCommitSha: "abc123",
      },
      tests: { success: true, results: ["CI: success"] },
      files: { success: true, results: ["web-app/src/App.jsx"] },
    }));

    const result = await resolveCompletionGithubEvidence(workItem, {
      status: "done",
      githubPrUrl: prUrl,
      expectedRevision: 4,
      idempotencyKey: "ui-mark-done",
    }, {
      githubCache: unmergedCache,
      localGithubCache: false,
      fetchEvidence,
    });

    expect(fetchEvidence).toHaveBeenCalledWith("your-org/web-app", 101);
    expect(result.completionGithubMatches.pullRequests[0]).toMatchObject({
      url: prUrl,
      mergedAt: "2026-06-12T11:55:00.000Z",
      mergeCommitSha: "abc123",
    });
    expect(result.verifiedCompletionWriteback).toEqual({
      testsRun: ["CI: success"],
      filesChanged: ["web-app/src/App.jsx"],
      evidenceCollection: {
        tests: { success: true, results: ["CI: success"] },
        files: { success: true, results: ["web-app/src/App.jsx"] },
      },
    });
    expect(result).not.toHaveProperty("expectedRevision");
  });

  it("uses merged cache matches in memory without a live fetch", async () => {
    const fetchEvidence = vi.fn();
    const result = await resolveCompletionGithubEvidence(workItem, {
      status: "done",
      githubPrUrl: prUrl,
    }, {
      githubCache: {
        source: "mock",
        repos: [{
          id: "web-app",
          name: "web-app",
          slug: "your-org/web-app",
          mergedPulls: [{
            url: prUrl,
            number: 101,
            title: "TASK-101 contact import",
            branch: "codex/task-101-closeout",
            mergedAt: "2026-06-12T11:55:00.000Z",
            mergeCommitSha: "abc123",
            deliveryEvidence: {
              pullRequest: { url: prUrl, number: 101, mergedAt: "2026-06-12T11:55:00.000Z" },
              tests: { success: true, results: ["mock tests"] },
              files: { success: true, results: ["web-app/src/App.jsx"] },
            },
          }],
          latestPulls: [],
          branches: [],
          latestIssues: [],
          failedWorkflowRuns: [],
        }],
      },
      localGithubCache: true,
      fetchEvidence,
    });

    expect(fetchEvidence).not.toHaveBeenCalled();
    expect(result.completionGithubMatches.pullRequests[0].mergedAt).toBe("2026-06-12T11:55:00.000Z");
    expect(result.verifiedCompletionWriteback.testsRun).toEqual(["mock tests"]);
  });

  it("loads mock delivery evidence for a merge linked by branch or title instead of TASK key", async () => {
    const titleOnlyUrl = "https://github.com/your-org/web-app/pull/88";
    const fetchEvidence = vi.fn();
    const result = await resolveCompletionGithubEvidence({
      key: "TASK-201",
      repo: "web-app",
      githubPrUrl: titleOnlyUrl,
      githubBranch: "docs/homepage-hero",
    }, {
      status: "done",
      githubPrUrl: titleOnlyUrl,
    }, {
      githubCache: {
        source: "mock",
        repos: [{
          id: "web-app",
          name: "web-app",
          slug: "your-org/web-app",
          mergedPulls: [{
            url: titleOnlyUrl,
            number: 88,
            title: "Refresh the public homepage hero",
            branch: "docs/homepage-hero",
            mergedAt: "2026-07-21T09:00:00.000Z",
            mergeCommitSha: "def456",
            deliveryEvidence: {
              pullRequest: { url: titleOnlyUrl, number: 88, mergedAt: "2026-07-21T09:00:00.000Z" },
              tests: { success: true, results: ["branch-linked tests"] },
              files: { success: true, results: ["web-app/src/hero.js"] },
            },
          }],
          latestPulls: [],
          branches: [],
          latestIssues: [],
          failedWorkflowRuns: [],
        }],
      },
      localGithubCache: true,
      fetchEvidence,
    });

    expect(fetchEvidence).not.toHaveBeenCalled();
    expect(result.completionGithubMatches.pullRequests[0]).toMatchObject({
      url: titleOnlyUrl,
      mergedAt: "2026-07-21T09:00:00.000Z",
      mergeCommitSha: "def456",
    });
    expect(result.verifiedCompletionWriteback).toEqual({
      testsRun: ["branch-linked tests"],
      filesChanged: ["web-app/src/hero.js"],
      evidenceCollection: {
        tests: { success: true, results: ["branch-linked tests"] },
        files: { success: true, results: ["web-app/src/hero.js"] },
      },
    });
  });

  it("uses already-linked githubLinks when the packet-repo cache misses", async () => {
    const linkedUrl = "https://github.com/thejayer/agent-backlog/pull/21";
    const fetchEvidence = vi.fn(async () => ({
      pullRequest: {
        url: linkedUrl,
        number: 21,
        mergedAt: "2026-07-31T03:23:51Z",
        mergeCommitSha: "cfa8f212",
      },
      tests: { success: true, results: ["linked PR tests"] },
      files: { success: true, results: ["manage/server/completionWrite.mjs"] },
    }));

    const result = await resolveCompletionGithubEvidence({
      key: "TASK-352",
      repo: "agent-backlog",
      githubPrUrl: linkedUrl,
      githubLinks: {
        source: "github-token",
        repoSlug: "thejayer/agent-backlog",
        pullRequests: [{
          number: 21,
          url: linkedUrl,
          branch: "fix/task-352",
          mergedAt: "2026-07-31T03:23:51Z",
          mergeCommitSha: "cfa8f212",
        }],
      },
    }, {
      status: "done",
      githubPrUrl: linkedUrl,
    }, {
      githubCache: { source: "github-cache", repos: [] },
      localGithubCache: false,
      fetchEvidence,
    });

    expect(fetchEvidence).toHaveBeenCalledWith("thejayer/agent-backlog", 21);
    expect(result.completionGithubMatches.pullRequests[0]).toMatchObject({
      url: linkedUrl,
      mergedAt: "2026-07-31T03:23:51Z",
      mergeCommitSha: "cfa8f212",
    });
    expect(result.verifiedCompletionWriteback.testsRun).toEqual(["linked PR tests"]);
  });

  it("matches a merged pull request from another cached repo", async () => {
    const crossRepoUrl = "https://github.com/thejayer/docs-site/pull/88";
    const fetchEvidence = vi.fn(async () => ({
      pullRequest: {
        url: crossRepoUrl,
        number: 88,
        mergedAt: "2026-07-31T13:11:58Z",
        mergeCommitSha: "a4e7bf67",
      },
      tests: { success: true, results: ["docs CI"] },
      files: { success: true, results: ["docs-site/README.md"] },
    }));

    const result = await resolveCompletionGithubEvidence({
      key: "TASK-361",
      repo: "agent-backlog",
      githubPrUrl: crossRepoUrl,
    }, {
      status: "done",
      githubPrUrl: crossRepoUrl,
    }, {
      githubCache: {
        source: "github-cache",
        repos: [{
          id: "docs-site",
          name: "docs-site",
          slug: "thejayer/docs-site",
          mergedPulls: [{
            url: crossRepoUrl,
            number: 88,
            title: "TASK-361 docs closeout",
            branch: "docs/task-361",
            mergedAt: "2026-07-31T13:11:58Z",
            mergeCommitSha: "a4e7bf67",
          }],
          latestPulls: [],
          branches: [],
          latestIssues: [],
          failedWorkflowRuns: [],
        }],
      },
      localGithubCache: false,
      fetchEvidence,
    });

    expect(fetchEvidence).toHaveBeenCalledWith("thejayer/docs-site", 88);
    expect(result.completionGithubMatches).toMatchObject({
      repoId: "agent-backlog",
      repoSlug: "thejayer/docs-site",
      bestPrUrl: crossRepoUrl,
    });
    expect(result.completionGithubMatches.pullRequests[0]).toMatchObject({
      url: crossRepoUrl,
      mergedAt: "2026-07-31T13:11:58Z",
    });
  });

  it("fetches live delivery evidence by the requested pull request URL", async () => {
    const liveUrl = "https://github.com/thejayer/research-notes/pull/111";
    const fetchEvidence = vi.fn(async () => ({
      pullRequest: {
        url: liveUrl,
        number: 111,
        mergedAt: "2026-08-02T16:00:00.000Z",
        mergeCommitSha: "live111",
      },
      tests: { success: true, results: ["research CI"] },
      files: { success: true, results: ["research-notes/index.md"] },
    }));

    const result = await resolveCompletionGithubEvidence({
      key: "TASK-436",
      repo: "research-notes",
      githubPrUrl: liveUrl,
    }, {
      status: "done",
      githubPrUrl: liveUrl,
    }, {
      githubCache: { source: "github-cache", repos: [] },
      localGithubCache: false,
      fetchEvidence,
    });

    expect(fetchEvidence).toHaveBeenCalledWith("thejayer/research-notes", 111);
    expect(result.completionGithubMatches).toMatchObject({
      source: "github-delivery",
      repoSlug: "thejayer/research-notes",
      bestPrUrl: liveUrl,
    });
    expect(result.verifiedCompletionWriteback.filesChanged).toEqual(["research-notes/index.md"]);
  });

  it("resolves mixed-case and trailing-slash GitHub URLs to the same merged pull request", async () => {
    const canonicalUrl = "https://github.com/thejayer/agent-backlog/pull/21";
    const requestedUrl = "https://GitHub.com/TheJayer/Agent-Backlog/pull/21/";
    const fetchEvidence = vi.fn();

    const result = await resolveCompletionGithubEvidence({
      key: "TASK-352",
      repo: "agent-backlog",
      githubPrUrl: requestedUrl,
      githubLinks: {
        source: "github-token",
        repoSlug: "thejayer/agent-backlog",
        pullRequests: [{
          number: 21,
          url: canonicalUrl,
          mergedAt: "2026-07-31T03:23:51Z",
          mergeCommitSha: "cfa8f212",
          deliveryEvidence: {
            pullRequest: { url: canonicalUrl, number: 21, mergedAt: "2026-07-31T03:23:51Z" },
            tests: { success: true, results: ["case-insensitive tests"] },
            files: { success: true, results: ["manage/server/githubLinks.mjs"] },
          },
        }],
      },
    }, {
      status: "done",
      githubPrUrl: requestedUrl,
    }, {
      githubCache: { source: "mock", repos: [] },
      localGithubCache: true,
      fetchEvidence,
    });

    expect(fetchEvidence).not.toHaveBeenCalled();
    expect(result.completionGithubMatches.pullRequests[0]).toMatchObject({
      url: canonicalUrl,
      mergedAt: "2026-07-31T03:23:51Z",
    });
    expect(result.verifiedCompletionWriteback.testsRun).toEqual(["case-insensitive tests"]);
  });

  it("fails closed when the requested pull request is missing or unmerged", async () => {
    const missingUrl = "https://github.com/thejayer/agent-backlog/pull/999";
    const fetchEvidence = vi.fn(async () => ({
      pullRequest: { url: missingUrl, number: 999 },
      tests: { success: true, results: ["client-supplied"] },
      files: { success: true, results: ["untrusted.js"] },
    }));

    const result = await resolveCompletionGithubEvidence({
      key: "TASK-999",
      repo: "agent-backlog",
      githubPrUrl: missingUrl,
    }, {
      status: "done",
      githubPrUrl: missingUrl,
      testsRun: ["client-supplied"],
      filesChanged: ["untrusted.js"],
    }, {
      githubCache: { source: "github-cache", repos: [] },
      localGithubCache: false,
      fetchEvidence,
    });

    expect(result).toEqual({
      completionGithubMatches: null,
      verifiedCompletionWriteback: null,
    });
  });
});

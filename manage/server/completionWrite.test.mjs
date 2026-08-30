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
});

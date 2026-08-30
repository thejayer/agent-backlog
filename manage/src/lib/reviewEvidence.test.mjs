import { describe, expect, it } from "vitest";
import { reviewCompletionEvidence } from "./reviewEvidence.mjs";

const prUrl = "https://github.com/your-org/web-app/pull/101";

function reviewItem(overrides = {}) {
  return {
    key: "TASK-101",
    githubPrUrl: prUrl,
    lastAgentUpdate: {
      note: "Ready for reviewer sign-off.",
      githubPrUrl: prUrl,
      testsRun: ["npm test - passed"],
      filesChanged: ["web-app/src/App.jsx"],
    },
    githubLinks: {
      source: "gh",
      pullRequests: [],
    },
    ...overrides,
  };
}

describe("reviewCompletionEvidence", () => {
  it("reports every missing requirement for an empty review writeback", () => {
    const evidence = reviewCompletionEvidence({ key: "TASK-428", lastAgentUpdate: null });

    expect(evidence.canComplete).toBe(false);
    expect(evidence.missing.map((check) => check.id)).toEqual([
      "agent_note",
      "pull_request",
      "merged_pull_request",
      "tests_run",
      "files_changed",
    ]);
  });

  it("accepts a matching merged pull request from the GitHub cache", () => {
    const item = reviewItem({
      githubLinks: {
        source: "gh",
        pullRequests: [{ url: prUrl, mergedAt: "2026-07-17T12:00:00.000Z", mergeCommitSha: "abc123" }],
      },
    });
    const evidence = reviewCompletionEvidence(item);

    expect(evidence.canComplete).toBe(true);
    expect(evidence.completionEvidence).toEqual({
      source: "gh",
      prUrl,
      mergedAt: "2026-07-17T12:00:00.000Z",
      mergeCommitSha: "abc123",
      testsRun: ["npm test - passed"],
      filesChanged: ["web-app/src/App.jsx"],
      evidenceCollection: {
        tests: { success: true, results: ["npm test - passed"] },
        files: { success: true, results: ["web-app/src/App.jsx"] },
      },
    });
  });

  it("does not treat an open or unrelated pull request as merged evidence", () => {
    const item = reviewItem({
      githubLinks: {
        source: "gh",
        pullRequests: [
          { url: prUrl },
          { url: "https://github.com/your-org/web-app/pull/102", mergedAt: "2026-07-17T12:00:00.000Z" },
        ],
      },
    });

    expect(reviewCompletionEvidence(item).missing.map((check) => check.id)).toEqual(["merged_pull_request"]);
  });

  it("ignores client-supplied merge evidence", () => {
    const evidence = reviewCompletionEvidence(reviewItem(), {
      completionEvidence: {
        source: "github-cli",
        prUrl,
        mergedAt: "2026-07-17T12:00:00.000Z",
        mergeCommitSha: "abc123",
      },
    });

    expect(evidence.canComplete).toBe(false);
    expect(evidence.missing.map((check) => check.id)).toEqual(["merged_pull_request"]);
    expect(evidence.completionEvidence).toBeNull();
  });

  it("rejects failed or empty evidence collection results", () => {
    const item = reviewItem({
      lastAgentUpdate: {
        note: "Ready for reviewer sign-off.",
        githubPrUrl: prUrl,
        testsRun: ["gh pr checks failed: checks are unavailable"],
        filesChanged: ["No changed files reported by gh pr diff"],
      },
      githubLinks: {
        source: "gh",
        pullRequests: [{ url: prUrl, mergedAt: "2026-07-17T12:00:00.000Z", mergeCommitSha: "abc123" }],
      },
    });
    const evidence = reviewCompletionEvidence(item);

    expect(evidence.missing.map((check) => check.id)).toEqual(["tests_run", "files_changed"]);
    expect(evidence.evidenceCollection).toEqual({
      tests: { success: false, results: ["gh pr checks failed: checks are unavailable"] },
      files: { success: false, results: ["No changed files reported by gh pr diff"] },
    });
  });

  it("rejects failure summaries followed by punctuation", () => {
    const item = reviewItem({
      lastAgentUpdate: {
        note: "Ready for reviewer sign-off.",
        githubPrUrl: prUrl,
        testsRun: ["1 failed, 2 passed"],
        filesChanged: ["web-app/src/App.jsx"],
      },
      githubLinks: {
        source: "gh",
        pullRequests: [{ url: prUrl, mergedAt: "2026-07-17T12:00:00.000Z", mergeCommitSha: "abc123" }],
      },
    });

    expect(reviewCompletionEvidence(item).missing.map((check) => check.id)).toEqual(["tests_run"]);
  });

  it("requires structured collection success even when results are present", () => {
    const item = reviewItem({
      lastAgentUpdate: {
        note: "Ready for reviewer sign-off.",
        githubPrUrl: prUrl,
        testsRun: ["npm test - passed"],
        filesChanged: ["web-app/src/App.jsx"],
        evidenceCollection: {
          tests: { success: false, results: ["npm test - passed"] },
          files: { success: true, results: ["web-app/src/App.jsx"] },
        },
      },
      githubLinks: {
        source: "gh",
        pullRequests: [{ url: prUrl, mergedAt: "2026-07-17T12:00:00.000Z", mergeCommitSha: "abc123" }],
      },
    });

    expect(reviewCompletionEvidence(item).missing.map((check) => check.id)).toEqual(["tests_run"]);
  });
});

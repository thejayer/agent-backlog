import { describe, expect, it } from "vitest";
import { fetchPullRequestDeliveryEvidence, parseGithubPullRequestUrl } from "./githubSync.mjs";

describe("parseGithubPullRequestUrl", () => {
  it("extracts owner, repo, and number from a GitHub pull request URL", () => {
    expect(parseGithubPullRequestUrl("https://github.com/your-org/web-app/pull/101/")).toEqual({
      slug: "your-org/web-app",
      number: 101,
      url: "https://github.com/your-org/web-app/pull/101",
    });
  });

  it("returns null for non-PR URLs", () => {
    expect(parseGithubPullRequestUrl("https://github.com/your-org/web-app")).toBeNull();
  });
});

describe("fetchPullRequestDeliveryEvidence", () => {
  it("requires a merged pull request and successful checks plus changed files", async () => {
    const requests = [];
    async function request(endpoint) {
      requests.push(endpoint);
      if (endpoint === "/repos/your-org/web-app/pulls/101") {
        return {
          html_url: "https://github.com/your-org/web-app/pull/101",
          merged_at: "2026-06-12T11:55:00.000Z",
          merge_commit_sha: "abc123",
          head: { sha: "def456" },
        };
      }
      if (endpoint.includes("/files")) {
        return [{ filename: "web-app/src/App.jsx" }];
      }
      if (endpoint.includes("/check-runs")) {
        return { check_runs: [{ name: "CI", status: "completed", conclusion: "success" }], total_count: 1 };
      }
      if (endpoint.includes("/statuses")) {
        return [];
      }
      throw new Error(`unexpected ${endpoint}`);
    }

    const evidence = await fetchPullRequestDeliveryEvidence("your-org/web-app", 101, request);

    expect(evidence.pullRequest).toMatchObject({
      url: "https://github.com/your-org/web-app/pull/101",
      mergedAt: "2026-06-12T11:55:00.000Z",
      mergeCommitSha: "abc123",
    });
    expect(evidence.tests).toEqual({ success: true, results: ["CI: success"] });
    expect(evidence.files).toEqual({ success: true, results: ["web-app/src/App.jsx"] });
    expect(requests.length).toBeGreaterThan(1);
  });

  it("rejects an unmerged pull request", async () => {
    await expect(
      fetchPullRequestDeliveryEvidence("your-org/web-app", 101, async () => ({
        html_url: "https://github.com/your-org/web-app/pull/101",
        merged_at: "",
        head: { sha: "def456" },
      })),
    ).rejects.toThrow(/not merged/);
  });
});

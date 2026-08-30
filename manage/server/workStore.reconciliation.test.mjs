import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { workItems as seedWorkItems } from "../src/data/workItems.mjs";
import { reviewCompletionEvidence } from "../src/lib/reviewEvidence.mjs";
import {
  createWorkItemForPullRequest,
  linkMergedPullRequest,
  listWorkItems,
  readWorkItems,
  resetWorkItems,
} from "./workStore.mjs";

let dataDir;
const T0 = new Date("2026-06-12T12:00:00.000Z");
const CSC_LEAKAGE = /Commerce Street|csc-workspace|CSC-|COM-|Harbor|RegVault|csc-crm-io/i;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "agent-backlog-reconciliation-"));
  process.env.MANAGE_DATA_DIR = dataDir;
  await resetWorkItems();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dataDir, { recursive: true, force: true });
});

function freezeTime() {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
}

describe("merged PR reconciliation store", () => {
  it("linkMergedPullRequest records an explicit reconciliation link idempotently", async () => {
    freezeTime();
    const pullRequest = {
      number: 101,
      title: "Ship contact import dedupe",
      branch: "codex/contact-import-dedupe",
      url: "https://github.com/your-org/web-app/pull/101",
      mergedAt: "2026-06-12T11:55:00.000Z",
      mergeCommitSha: "abc123",
    };
    const repo = { id: "web-app", name: "web-app", slug: "your-org/web-app" };

    const { workItem } = await linkMergedPullRequest("TASK-101", {
      repo,
      pullRequest,
      source: "test-cache",
    });
    expect(workItem).toMatchObject({
      key: "TASK-101",
      githubBranch: pullRequest.branch,
      githubPrUrl: pullRequest.url,
      githubLinks: {
        repoId: "web-app",
        repoSlug: "your-org/web-app",
        bestPrUrl: pullRequest.url,
      },
    });
    expect(workItem.githubLinks.pullRequests).toEqual([pullRequest]);
    expect(JSON.stringify(workItem)).not.toMatch(CSC_LEAKAGE);

    const { workItem: again } = await linkMergedPullRequest("TASK-101", {
      repo,
      pullRequest,
      source: "test-cache",
    });
    expect(again.githubLinks.pullRequests).toEqual([pullRequest]);
    expect(again.lastGithubLinkUpdate).toEqual({
      at: T0.toISOString(),
      source: "test-cache",
      matchCount: 1,
    });
  });

  it("linkMergedPullRequest rejects cross-repository links", async () => {
    await expect(linkMergedPullRequest("TASK-101", {
      repo: { id: "docs-site", name: "docs-site", slug: "your-org/docs-site" },
      pullRequest: {
        number: 281,
        url: "https://github.com/your-org/docs-site/pull/281",
        mergedAt: "2026-06-12T11:55:00.000Z",
      },
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("serializes concurrent follow-up creation by pull request URL", async () => {
    const githubPrUrl = "https://github.com/your-org/marketing-site/pull/88";
    const payload = {
      title: "Follow up marketing-site PR #88: Refresh the public homepage hero",
      repo: "marketing-site",
      githubPrUrl,
    };

    const results = await Promise.all([
      createWorkItemForPullRequest(payload),
      createWorkItemForPullRequest(payload),
    ]);
    const matchingItems = (await readWorkItems()).filter((item) => item.githubPrUrl === githubPrUrl);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.filter((result) => !result.created)).toHaveLength(1);
    expect(results[0].workItem.key).toBe(results[1].workItem.key);
    expect(results[0].workItem.key).toMatch(/^TASK-\d+$/);
    expect(matchingItems).toHaveLength(1);
    expect(await listWorkItems()).toHaveLength(seedWorkItems.length + 1);
    expect(JSON.stringify(results)).not.toMatch(CSC_LEAKAGE);
  });

  it("createWorkItemForPullRequest persists cached merge metadata for Review evidence", async () => {
    freezeTime();
    const pullRequest = {
      number: 88,
      title: "Refresh the public homepage hero",
      branch: "docs/homepage-hero",
      url: "https://github.com/your-org/marketing-site/pull/88",
      mergedAt: "2026-06-12T11:55:00.000Z",
      mergeCommitSha: "def456",
    };

    const { workItem, created } = await createWorkItemForPullRequest({
      title: "Follow up marketing-site PR #88: Refresh the public homepage hero",
      repo: "marketing-site",
      githubPrUrl: pullRequest.url,
      githubBranch: pullRequest.branch,
      mergedPullRequest: pullRequest,
      linkRepo: { id: "marketing-site", name: "marketing-site", slug: "your-org/marketing-site" },
      githubSource: "mock",
    });

    expect(created).toBe(true);
    expect(workItem.key).toMatch(/^TASK-\d+$/);
    expect(workItem.githubLinks.pullRequests[0]).toMatchObject({
      url: pullRequest.url,
      mergedAt: pullRequest.mergedAt,
      mergeCommitSha: pullRequest.mergeCommitSha,
    });
    expect(workItem.lastGithubLinkUpdate).toEqual({
      at: T0.toISOString(),
      source: "mock",
      matchCount: 1,
    });

    const evidence = reviewCompletionEvidence({
      ...workItem,
      lastAgentUpdate: {
        note: "Follow-up reviewed.",
        githubPrUrl: pullRequest.url,
        testsRun: ["npm test - passed"],
        filesChanged: ["marketing-site/src/hero.js"],
      },
    });
    expect(evidence.checks.find((check) => check.id === "merged_pull_request")?.satisfied).toBe(true);
    expect(JSON.stringify(workItem)).not.toMatch(CSC_LEAKAGE);
  });
});

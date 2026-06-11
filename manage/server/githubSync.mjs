import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { repositories } from "../src/data/workItems.mjs";
import { readJsonState, writeJsonState } from "./storage.mjs";

const execFileAsync = promisify(execFile);

function repoSlug(repo) {
  return `${repo.owner}/${repo.name}`;
}

async function writeCache(cache) {
  await writeJsonState("github-cache", cache);
}

async function githubApiWithToken(endpoint) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "User-Agent": "agent-backlog",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || `GitHub API request failed: ${response.status}`);
  }

  return payload;
}

async function githubApiWithCli(endpoint) {
  const { stdout } = await execFileAsync("gh", ["api", endpoint], {
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  return JSON.parse(stdout);
}

async function githubApi(endpoint) {
  return process.env.GITHUB_TOKEN ? githubApiWithToken(endpoint) : githubApiWithCli(endpoint);
}

function summarizePulls(pulls) {
  return pulls.slice(0, 8).map((pr) => ({
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    branch: pr.head?.ref || "",
    author: pr.user?.login || "",
    updatedAt: pr.updated_at,
    draft: Boolean(pr.draft),
  }));
}

function summarizeIssues(issues) {
  return issues
    .filter((issue) => !issue.pull_request)
    .slice(0, 8)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      author: issue.user?.login || "",
      updatedAt: issue.updated_at,
      labels: (issue.labels || []).map((label) => label.name),
    }));
}

function summarizeFailedRuns(runsPayload) {
  return (runsPayload.workflow_runs || [])
    .filter((run) => run.conclusion && run.conclusion !== "success" && run.conclusion !== "skipped")
    .slice(0, 8)
    .map((run) => ({
      id: run.id,
      name: run.name,
      conclusion: run.conclusion,
      status: run.status,
      branch: run.head_branch,
      url: run.html_url,
      updatedAt: run.updated_at,
    }));
}

function summarizeBranches(branches) {
  return branches.slice(0, 40).map((branch) => ({
    name: branch.name,
    protected: Boolean(branch.protected),
    sha: branch.commit?.sha || "",
  }));
}

function mockWorkForRepo(repoId) {
  const matches = {
    "web-app": {
      key: "TASK-101",
      title: "contact import duplicate handling",
      branch: "codex/task-101-contact-import-dedupe",
    },
    "api-service": {
      key: "TASK-102",
      title: "request validation",
      branch: "codex/task-102-api-request-validation",
    },
    "data-pipeline": {
      key: "TASK-106",
      title: "analytics export template",
      branch: "codex/task-106-data-export-template",
    },
  };

  return matches[repoId];
}

export function createMockGithubCache() {
  const syncedAt = new Date().toISOString();

  return {
    syncedAt,
    source: "mock",
    repos: repositories.map((repo) => {
      const linkedWork = mockWorkForRepo(repo.id);

      return {
        id: repo.id,
        slug: repoSlug(repo),
        name: repo.name,
        domain: repo.domain,
        defaultBranch: "main",
        openPrs: repo.openPrs,
        openIssues: repo.id === "web-app" ? 4 : repo.id === "worker-service" ? 3 : 1,
        failedRuns: repo.failedRuns,
        pushedAt: syncedAt,
        latestPulls:
          repo.openPrs && linkedWork
            ? [
                {
                  number: Number(linkedWork.key.replace("TASK-", "")),
                  title: `${linkedWork.key}: ${linkedWork.title}`,
                  url: `https://github.com/${repoSlug(repo)}/pull/${Number(linkedWork.key.replace("TASK-", ""))}`,
                  branch: linkedWork.branch,
                  author: "codex",
                  updatedAt: syncedAt,
                  draft: true,
                },
              ]
            : [],
        latestIssues: [
          {
            number: 201,
            title: `${repo.domain} backlog grooming`,
            url: `https://github.com/${repoSlug(repo)}/issues/201`,
            author: "operator",
            updatedAt: syncedAt,
            labels: ["manage"],
          },
        ],
        branches: [
          { name: "main", protected: true, sha: "mock-main" },
          ...(linkedWork ? [{ name: linkedWork.branch, protected: false, sha: `mock-${linkedWork.key.toLowerCase()}` }] : []),
        ],
        failedWorkflowRuns: repo.failedRuns
          ? [
              {
                id: 301,
                name: "CI",
                conclusion: "failure",
                status: "completed",
                branch: linkedWork?.branch || "main",
                url: `https://github.com/${repoSlug(repo)}/actions/runs/301`,
                updatedAt: syncedAt,
              },
            ]
          : [],
        syncError: "",
      };
    }),
  };
}

export async function readGithubCache() {
  return readJsonState("github-cache", () => {
    const cache = createMockGithubCache();
    cache.source = "seed";
    return cache;
  });
}

export async function syncGithubCache({ mock = false } = {}) {
  if (mock) {
    const cache = createMockGithubCache();
    await writeCache(cache);
    return cache;
  }

  const syncedAt = new Date().toISOString();
  const repoSummaries = [];

  for (const repo of repositories) {
    const slug = repoSlug(repo);

    try {
      const [metadata, pulls, issues, runs, branches] = await Promise.all([
        githubApi(`/repos/${slug}`),
        githubApi(`/repos/${slug}/pulls?state=open&per_page=20`),
        githubApi(`/repos/${slug}/issues?state=open&per_page=20`),
        githubApi(`/repos/${slug}/actions/runs?per_page=20&status=completed`),
        githubApi(`/repos/${slug}/branches?per_page=100`),
      ]);

      const failedWorkflowRuns = summarizeFailedRuns(runs);

      repoSummaries.push({
        id: repo.id,
        slug,
        name: repo.name,
        domain: repo.domain,
        defaultBranch: metadata.default_branch || "",
        openPrs: pulls.length,
        openIssues: summarizeIssues(issues).length,
        failedRuns: failedWorkflowRuns.length,
        pushedAt: metadata.pushed_at || "",
        latestPulls: summarizePulls(pulls),
        latestIssues: summarizeIssues(issues),
        branches: summarizeBranches(branches),
        failedWorkflowRuns,
        syncError: "",
      });
    } catch (error) {
      repoSummaries.push({
        id: repo.id,
        slug,
        name: repo.name,
        domain: repo.domain,
        defaultBranch: "",
        openPrs: repo.openPrs,
        openIssues: 0,
        failedRuns: repo.failedRuns,
        pushedAt: "",
        latestPulls: [],
        latestIssues: [],
        branches: [],
        failedWorkflowRuns: [],
        syncError: error.message,
      });
    }
  }

  const cache = {
    syncedAt,
    source: process.env.GITHUB_TOKEN ? "github-token" : "gh",
    repos: repoSummaries,
  };
  await writeCache(cache);
  return cache;
}

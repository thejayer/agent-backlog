import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { repositories } from "../src/data/workItems.mjs";
import { readJsonState, writeJsonState } from "./storage.mjs";

const execFileAsync = promisify(execFile);
const CLOSED_PULLS_PAGE_SIZE = 100;
const CLOSED_PULLS_MAX_PAGES = 10;
const MERGED_PULL_HISTORY_DAYS = 730;
const DEFAULT_SYNC_CONCURRENCY = 3;
const DEFAULT_SYNC_REQUEST_BUDGET = 160;
const FAILED_WORKFLOW_RUN_LIMIT = 8;
const WORKFLOW_RUNS_PAGE_SIZE = 100;
const WORKFLOW_RUNS_MAX_PAGES = 10;

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
    const error = new Error(payload.message || `GitHub API request failed: ${response.status}`);
    error.statusCode = response.status;
    error.rateLimited = response.status === 429
      || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")
      || /secondary rate limit/i.test(error.message);
    error.retryAfter = response.headers.get("retry-after") || "";
    error.rateLimitReset = response.headers.get("x-ratelimit-reset") || "";
    throw error;
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

export function createGithubRequestBudget(limit = DEFAULT_SYNC_REQUEST_BUDGET) {
  let used = 0;

  return {
    async request(endpoint, request = githubApi) {
      if (used >= limit) {
        const error = new Error(`GitHub sync request budget exhausted after ${limit} requests`);
        error.code = "GITHUB_REQUEST_BUDGET_EXHAUSTED";
        throw error;
      }
      used += 1;
      return request(endpoint);
    },
    get used() {
      return used;
    },
    get limit() {
      return limit;
    },
  };
}

export function parseGithubPullRequestUrl(value) {
  const match = String(value || "").trim().match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (!match) {
    return null;
  }

  return {
    slug: `${match[1]}/${match[2]}`,
    number: Number(match[3]),
    url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
  };
}

export async function githubApiPaginated(endpoint, requestPage = githubApi) {
  const items = [];
  const separator = endpoint.includes("?") ? "&" : "?";

  for (let page = 1; ; page += 1) {
    const payload = await requestPage(`${endpoint}${separator}per_page=100&page=${page}`);

    if (!Array.isArray(payload)) {
      throw new Error("Paginated GitHub API request must return an array");
    }

    items.push(...payload);

    if (payload.length < 100) {
      return items;
    }
  }
}

export async function githubApiObjectPaginated(endpoint, field, requestPage = githubApi) {
  const items = [];
  const separator = endpoint.includes("?") ? "&" : "?";

  for (let page = 1; ; page += 1) {
    const payload = await requestPage(`${endpoint}${separator}per_page=100&page=${page}`);
    const pageItems = payload?.[field];

    if (!Array.isArray(pageItems)) {
      throw new Error(`Paginated GitHub API response must include an array at ${field}`);
    }

    items.push(...pageItems);

    if (
      pageItems.length < 100
      || (Number.isFinite(Number(payload.total_count)) && items.length >= Number(payload.total_count))
    ) {
      return items;
    }
  }
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function newestTimestamp(values = [], fields = []) {
  return values.reduce((latest, value) => {
    const candidate = fields.reduce((result, field) => Math.max(result, timestamp(value?.[field])), 0);
    return Math.max(latest, candidate);
  }, 0);
}

function isoOrEmpty(value) {
  return value > 0 ? new Date(value).toISOString() : "";
}

export function githubSyncFreshness(syncState, source = "") {
  if (syncState === "current" || ["mock", "seed"].includes(source)) {
    return syncState && syncState !== "current" ? "stale" : "fresh";
  }

  if (syncState === "stale" || syncState === "partially_degraded" || syncState === "degraded") {
    return "stale";
  }

  return "unknown";
}

export function summarizeGithubSyncStatus(cache = {}) {
  const source = cache.source
    || (process.env.GITHUB_TOKEN ? "github-token" : "gh-cli");
  const syncState = cache.syncState
    || (["mock", "seed"].includes(cache.source) ? "current" : "");
  const freshness = githubSyncFreshness(syncState, cache.source);

  return {
    source,
    syncState: syncState || "unknown",
    freshness,
    lastAttemptAt: cache.lastAttemptAt || "",
    lastSuccessAt: cache.lastSuccessAt || cache.syncedAt || "",
    requestBudget: cache.requestBudget || null,
  };
}

export async function fetchClosedPullsIncremental(
  slug,
  requestPage = githubApi,
  { updatedSince = "", historyCutoff = "", maxPages = CLOSED_PULLS_MAX_PAGES } = {},
) {
  const pulls = [];
  const updatedSinceTime = timestamp(updatedSince);
  const historyCutoffTime = timestamp(historyCutoff);

  for (let page = 1; page <= maxPages; page += 1) {
    const pagePulls = await requestPage(
      `/repos/${slug}/pulls?state=closed&sort=updated&direction=desc&per_page=${CLOSED_PULLS_PAGE_SIZE}&page=${page}`,
    );
    if (!Array.isArray(pagePulls)) {
      throw new Error("Closed pull request response must be an array");
    }
    pulls.push(...pagePulls);

    const reachedKnownData = updatedSinceTime > 0
      && pagePulls.some((pull) => timestamp(pull.updated_at) <= updatedSinceTime);
    const reachedHistoryBoundary = historyCutoffTime > 0
      && pagePulls.some((pull) => timestamp(pull.updated_at || pull.closed_at) < historyCutoffTime);
    if (pagePulls.length < CLOSED_PULLS_PAGE_SIZE || reachedKnownData || reachedHistoryBoundary) {
      break;
    }
  }

  return pulls.filter((pull) => (
    timestamp(pull.updated_at) > updatedSinceTime
    && (historyCutoffTime === 0 || timestamp(pull.merged_at) >= historyCutoffTime)
  ));
}

function mergeByKey(current = [], incoming = [], key, sortField, limit, cutoff = 0) {
  const merged = new Map();
  for (const item of [...current, ...incoming]) {
    const id = String(item?.[key] ?? "");
    const occurredAt = timestamp(item?.[sortField]);
    if (!id || (cutoff > 0 && occurredAt > 0 && occurredAt < cutoff)) {
      continue;
    }
    merged.set(id, { ...(merged.get(id) || {}), ...item });
  }
  return [...merged.values()]
    .sort((a, b) => timestamp(b?.[sortField]) - timestamp(a?.[sortField]))
    .slice(0, limit);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, run));
  return results;
}

const successfulCheckConclusions = new Set(["success", "neutral", "skipped"]);

function checkRunResult(run) {
  return `${run?.name || `Check ${run?.id || "unknown"}`}: ${run?.conclusion || run?.status || "unknown"}`;
}

function commitStatusResult(status) {
  return `${status?.context || "Commit status"}: ${status?.state || "unknown"}`;
}

function latestCommitStatuses(statuses) {
  const contexts = new Set();

  return statuses.filter((status) => {
    const context = String(status?.context || status?.id || "");

    if (contexts.has(context)) {
      return false;
    }

    contexts.add(context);
    return true;
  });
}

export async function fetchPullRequestDeliveryEvidence(slug, pullRequestNumber, request = githubApi) {
  const normalizedSlug = String(slug || "").trim();
  const normalizedNumber = Number(pullRequestNumber);

  if (!/^[^/]+\/[^/]+$/.test(normalizedSlug) || !Number.isInteger(normalizedNumber) || normalizedNumber <= 0) {
    throw new Error("A valid repository and pull request number are required for delivery evidence");
  }

  const pullRequest = await request(`/repos/${normalizedSlug}/pulls/${normalizedNumber}`);
  const mergedAt = String(pullRequest?.merged_at || "").trim();
  const headSha = String(pullRequest?.head?.sha || "").trim();

  if (!mergedAt || !headSha) {
    throw new Error(`Pull request #${normalizedNumber} is not merged or has no verifiable head commit`);
  }

  const [files, checkRuns, allCommitStatuses] = await Promise.all([
    githubApiPaginated(`/repos/${normalizedSlug}/pulls/${normalizedNumber}/files`, request),
    githubApiObjectPaginated(`/repos/${normalizedSlug}/commits/${headSha}/check-runs?filter=latest`, "check_runs", request),
    githubApiPaginated(`/repos/${normalizedSlug}/commits/${headSha}/statuses`, request),
  ]);
  const commitStatuses = latestCommitStatuses(allCommitStatuses);
  const testResults = [
    ...checkRuns.map(checkRunResult),
    ...commitStatuses.map(commitStatusResult),
  ];
  const checksPassed = checkRuns.every(
    (run) => run?.status === "completed" && successfulCheckConclusions.has(String(run?.conclusion || "")),
  );
  const statusesPassed = commitStatuses.every((status) => status?.state === "success");
  const fileResults = files.map((file) => String(file?.filename || "").trim()).filter(Boolean);

  return {
    pullRequest: {
      number: normalizedNumber,
      url: String(pullRequest?.html_url || "").trim(),
      mergedAt,
      mergeCommitSha: String(pullRequest?.merge_commit_sha || "").trim(),
      headSha,
    },
    tests: {
      success: testResults.length > 0 && checksPassed && statusesPassed,
      results: testResults,
    },
    files: {
      success: fileResults.length > 0,
      results: fileResults,
    },
  };
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

export function summarizeMergedPulls(pulls, { limit = 100, historyCutoff = "" } = {}) {
  const cutoff = timestamp(historyCutoff);
  return pulls
    .filter((pr) => pr.merged_at && (!cutoff || timestamp(pr.merged_at) >= cutoff))
    .sort((a, b) => String(b.merged_at).localeCompare(String(a.merged_at)))
    .slice(0, limit)
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      branch: pr.head?.ref || "",
      baseBranch: pr.base?.ref || "",
      author: pr.user?.login || "",
      mergedBy: pr.merged_by?.login || "",
      mergedAt: pr.merged_at,
      updatedAt: pr.updated_at || pr.merged_at,
      closedAt: pr.closed_at || "",
      mergeCommitSha: pr.merge_commit_sha || "",
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

function isFailedWorkflowRun(run) {
  return Boolean(run?.conclusion && run.conclusion !== "success" && run.conclusion !== "skipped");
}

function summarizeFailedRuns(runsPayload) {
  return (runsPayload.workflow_runs || [])
    .filter(isFailedWorkflowRun)
    .slice(0, FAILED_WORKFLOW_RUN_LIMIT)
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

export async function fetchCompletedWorkflowRuns(
  slug,
  requestPage = githubApi,
  { createdSince = "", maxPages = WORKFLOW_RUNS_MAX_PAGES } = {},
) {
  const workflowRuns = [];
  const createdSinceTime = timestamp(createdSince);

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await requestPage(
      `/repos/${slug}/actions/runs?status=completed&per_page=${WORKFLOW_RUNS_PAGE_SIZE}&page=${page}`,
    );
    const pageRuns = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
    workflowRuns.push(...pageRuns);

    // The Actions list is newest-created first and has no updated_at sort.
    // Stop on created_at so a stale updated_at on page 1 cannot hide later rows.
    const reachedKnownData = createdSinceTime > 0
      && pageRuns.some((run) => timestamp(run.created_at) <= createdSinceTime);

    if (pageRuns.length < WORKFLOW_RUNS_PAGE_SIZE || reachedKnownData) {
      break;
    }
  }

  return {
    workflow_runs: createdSinceTime > 0
      ? workflowRuns.filter((run) => timestamp(run.created_at) > createdSinceTime)
      : workflowRuns,
  };
}

export async function revalidateFailedWorkflowRuns(slug, failedRuns = [], request = githubApi) {
  const unique = [];
  const seen = new Set();

  for (const failed of failedRuns) {
    const id = String(failed?.id || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(id);
  }

  const results = await Promise.all(unique.map(async (id) => {
    try {
      return await request(`/repos/${slug}/actions/runs/${id}`);
    } catch {
      return null;
    }
  }));

  return results.filter(isFailedWorkflowRun);
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

function withFreshness(record, syncedAt) {
  return {
    ...record,
    lastAttemptAt: syncedAt,
    lastSuccessAt: syncedAt,
    syncState: "current",
  };
}

export function createMockGithubCache() {
  const syncedAt = new Date().toISOString();

  return withFreshness({
    syncedAt,
    source: "mock",
    repos: repositories.map((repo) => {
      const linkedWork = mockWorkForRepo(repo.id);

      return withFreshness({
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
        mergedPulls: [
          ...(linkedWork
            ? [
                {
                  number: Number(linkedWork.key.replace("TASK-", "")),
                  title: `${linkedWork.key}: ${linkedWork.title}`,
                  url: `https://github.com/${repoSlug(repo)}/pull/${Number(linkedWork.key.replace("TASK-", ""))}`,
                  branch: linkedWork.branch,
                  baseBranch: "main",
                  author: "codex",
                  mergedBy: "operator",
                  mergedAt: syncedAt,
                  updatedAt: syncedAt,
                  closedAt: syncedAt,
                  mergeCommitSha: `mock-merge-${linkedWork.key.toLowerCase()}`,
                  deliveryEvidence: {
                    tests: { success: true, results: ["Mock CI: success"] },
                    files: { success: true, results: [`${repo.id}/mock-delivery-file.js`] },
                  },
                },
              ]
            : []),
          ...(repo.id === "marketing-site"
            ? [
                {
                  number: 88,
                  title: "Refresh the public homepage hero",
                  url: `https://github.com/${repoSlug(repo)}/pull/88`,
                  branch: "docs/homepage-hero",
                  baseBranch: "main",
                  author: "codex",
                  mergedBy: "operator",
                  mergedAt: syncedAt,
                  updatedAt: syncedAt,
                  closedAt: syncedAt,
                  mergeCommitSha: "mock-merge-marketing-88",
                  deliveryEvidence: {
                    tests: { success: true, results: ["Mock CI: success"] },
                    files: { success: true, results: ["marketing-site/src/hero.js"] },
                  },
                },
              ]
            : []),
        ],
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
        checkpoints: {
          closedPullUpdatedAt: syncedAt,
          workflowRunCreatedAt: syncedAt,
          workflowRunUpdatedAt: syncedAt,
        },
        syncError: "",
      }, syncedAt);
    }),
  }, syncedAt);
}

export async function readGithubCache() {
  return readJsonState("github-cache", () => {
    const cache = createMockGithubCache();
    cache.source = "seed";
    cache.repos = cache.repos.map((repo) => ({ ...repo, mergedPulls: [] }));
    return cache;
  });
}

function fallbackRepoSummary(repo) {
  return {
    id: repo.id,
    slug: repoSlug(repo),
    name: repo.name,
    domain: repo.domain,
    defaultBranch: repo.defaultBranch || "",
    openPrs: repo.openPrs,
    openIssues: repo.openIssues || 0,
    failedRuns: repo.failedRuns,
    pushedAt: "",
    latestPulls: [],
    mergedPulls: [],
    latestIssues: [],
    branches: [],
    failedWorkflowRuns: [],
  };
}

async function refreshGithubRepository(repo, previous, {
  attemptedAt,
  historyCutoff,
  requestPage,
  previousCache,
}) {
  const slug = repoSlug(repo);
  const previousSummary = previous || fallbackRepoSummary(repo);
  const checkpoints = previous?.checkpoints || {};

  try {
    const [metadata, pulls, closedPulls, issues, runs, branches] = await Promise.all([
      requestPage(`/repos/${slug}`),
      requestPage(`/repos/${slug}/pulls?state=open&per_page=20`),
      fetchClosedPullsIncremental(slug, requestPage, {
        updatedSince: checkpoints.closedPullUpdatedAt || "",
        historyCutoff,
      }),
      requestPage(`/repos/${slug}/issues?state=open&per_page=20`),
      fetchCompletedWorkflowRuns(slug, requestPage, {
        createdSince: checkpoints.workflowRunCreatedAt || "",
      }),
      requestPage(`/repos/${slug}/branches?per_page=100`),
    ]);

    const incrementalRuns = runs.workflow_runs || [];
    const incrementalIds = new Set(incrementalRuns.map((run) => String(run.id)));
    const retainedCandidates = (previousSummary.failedWorkflowRuns || [])
      .filter((run) => !incrementalIds.has(String(run.id)));
    const revalidatedRuns = await revalidateFailedWorkflowRuns(slug, retainedCandidates, requestPage);
    const incomingMergedPulls = summarizeMergedPulls(closedPulls, { historyCutoff });
    const incomingFailedRuns = summarizeFailedRuns({
      workflow_runs: [...incrementalRuns, ...revalidatedRuns],
    });
    const cutoffTime = timestamp(historyCutoff);
    const closedPullCheckpoint = Math.max(
      timestamp(checkpoints.closedPullUpdatedAt),
      newestTimestamp(closedPulls, ["updated_at", "merged_at"]),
    );
    const workflowRunCreatedCheckpoint = Math.max(
      timestamp(checkpoints.workflowRunCreatedAt),
      newestTimestamp(incrementalRuns, ["created_at"]),
    );
    const workflowRunUpdatedCheckpoint = Math.max(
      timestamp(checkpoints.workflowRunUpdatedAt),
      newestTimestamp(incrementalRuns, ["updated_at", "run_started_at"]),
      newestTimestamp(revalidatedRuns, ["updated_at", "run_started_at"]),
    );
    const mergedFailedRuns = mergeByKey(
      [],
      incomingFailedRuns,
      "id",
      "updatedAt",
      FAILED_WORKFLOW_RUN_LIMIT,
    );
    const summarizedIssues = summarizeIssues(issues);

    return {
      id: repo.id,
      slug,
      name: repo.name,
      domain: repo.domain,
      defaultBranch: metadata.default_branch || previousSummary.defaultBranch || "",
      openPrs: pulls.length,
      openIssues: summarizedIssues.length,
      failedRuns: mergedFailedRuns.length,
      pushedAt: metadata.pushed_at || previousSummary.pushedAt || "",
      latestPulls: summarizePulls(pulls),
      mergedPulls: mergeByKey(
        previousSummary.mergedPulls,
        incomingMergedPulls,
        "number",
        "mergedAt",
        100,
        cutoffTime,
      ),
      latestIssues: summarizedIssues,
      branches: summarizeBranches(branches),
      failedWorkflowRuns: mergedFailedRuns,
      checkpoints: {
        closedPullUpdatedAt: isoOrEmpty(closedPullCheckpoint),
        workflowRunCreatedAt: isoOrEmpty(workflowRunCreatedCheckpoint),
        workflowRunUpdatedAt: isoOrEmpty(workflowRunUpdatedCheckpoint),
      },
      lastAttemptAt: attemptedAt,
      lastSuccessAt: attemptedAt,
      syncState: "current",
      syncError: "",
    };
  } catch (error) {
    const lastSuccessAt = previous?.lastSuccessAt
      || (previous ? previousCache?.lastSuccessAt || previousCache?.syncedAt || "" : "");
    return {
      ...previousSummary,
      id: repo.id,
      slug,
      name: repo.name,
      domain: repo.domain,
      lastAttemptAt: attemptedAt,
      lastSuccessAt,
      syncState: lastSuccessAt ? "stale" : "degraded",
      syncError: error.rateLimited
        ? `${error.message}${error.retryAfter ? ` (retry after ${error.retryAfter}s)` : ""}`
        : error.message,
    };
  }
}

export async function syncGithubCache({
  mock = false,
  request = githubApi,
  repoList = repositories,
  now = () => new Date(),
  concurrency = DEFAULT_SYNC_CONCURRENCY,
  requestBudget = DEFAULT_SYNC_REQUEST_BUDGET,
  priorCache,
  write = writeCache,
} = {}) {
  if (mock) {
    const cache = createMockGithubCache();
    await write(cache);
    return cache;
  }

  const attemptedAt = new Date(now()).toISOString();
  const historyCutoff = new Date(timestamp(attemptedAt) - MERGED_PULL_HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const previousCache = priorCache === undefined ? await readGithubCache() : priorCache;
  const incrementalCache = ["gh", "github-token"].includes(previousCache?.source) ? previousCache : null;
  const previousByRepo = new Map((incrementalCache?.repos || []).map((repo) => [repo.id, repo]));
  const budget = createGithubRequestBudget(requestBudget);
  const requestPage = (endpoint) => budget.request(endpoint, request);
  const repoSummaries = await mapWithConcurrency(repoList, concurrency, (repo) => (
    refreshGithubRepository(repo, previousByRepo.get(repo.id), {
      attemptedAt,
      historyCutoff,
      requestPage,
      previousCache: incrementalCache,
    })
  ));
  const hasFailures = repoSummaries.some((repo) => repo.syncState !== "current");
  const hasSuccess = repoSummaries.some((repo) => repo.syncState === "current");
  const previousSuccessAt = incrementalCache?.lastSuccessAt || incrementalCache?.syncedAt || "";
  const lastSuccessAt = hasSuccess ? attemptedAt : previousSuccessAt;

  const cache = {
    syncedAt: hasSuccess ? attemptedAt : previousSuccessAt,
    lastAttemptAt: attemptedAt,
    lastSuccessAt,
    syncState: !hasSuccess && hasFailures
      ? "degraded"
      : hasFailures ? "partially_degraded" : "current",
    requestBudget: { used: budget.used, limit: budget.limit },
    historyCutoff,
    source: process.env.GITHUB_TOKEN ? "github-token" : "gh",
    repos: repoSummaries,
  };
  await write(cache);
  return cache;
}

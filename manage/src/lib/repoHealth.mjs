/**
 * Shared repo-health helpers for the console and agent next-work selection.
 * Failed CI runs from GitHub sync (or seed) mark a repo as blocked so agents
 * skip that repo unless they explicitly filter by repo id.
 */

function asCount(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

const FRESH_CACHE_MINUTES = 60;

function ageMinutes(value, now = Date.now()) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? Math.max(0, Math.round((Number(now) - parsed) / 60_000)) : null;
}

export function deriveRepoFreshness(syncedRepo = null, { now = Date.now(), syncing = false } = {}) {
  if (syncing) return { state: "syncing", label: "Syncing", ageMinutes: ageMinutes(syncedRepo?.lastSuccessAt, now) };
  const age = ageMinutes(syncedRepo?.lastSuccessAt || syncedRepo?.lastAttemptAt, now);
  if (syncedRepo?.syncState === "degraded" || (syncedRepo?.syncError && !syncedRepo?.lastSuccessAt)) {
    return { state: "degraded", label: "No current evidence", ageMinutes: age };
  }
  if (syncedRepo?.syncState === "stale" || syncedRepo?.syncError || age === null || age > FRESH_CACHE_MINUTES) {
    return { state: "stale", label: age === null ? "Freshness unknown" : `Stale · ${age}m old`, ageMinutes: age };
  }
  return { state: "current", label: `Current · ${age}m old`, ageMinutes: age };
}

export function deriveGithubFreshness(githubCache = null, githubState = "idle", options = {}) {
  if (githubState === "syncing") return { state: "syncing", label: "Syncing GitHub evidence" };
  const rows = (githubCache?.repos || []).map((repo) => deriveRepoFreshness(repo, options));
  if (githubCache?.syncState === "degraded") {
    return { state: "degraded", label: "GitHub evidence degraded" };
  }
  if (githubCache?.syncState === "partially_degraded" || rows.some((row) => ["stale", "degraded"].includes(row.state))) {
    const affected = rows.filter((row) => ["stale", "degraded"].includes(row.state)).length;
    return {
      state: "partially_degraded",
      label: affected
        ? `Partially degraded · ${affected} repo${affected === 1 ? "" : "s"} affected`
        : "Partially degraded",
    };
  }
  if (!rows.length) return { state: "stale", label: "GitHub freshness unavailable" };
  return { state: "current", label: "GitHub evidence current" };
}

/** Merge seed repository metadata with optional GitHub sync cache row. */
export function mergeRepoStats(seedRepo = {}, syncedRepo = null) {
  const branchValue = syncedRepo?.branches;
  const branchCount = Array.isArray(branchValue)
    ? branchValue.length
    : asCount(branchValue, asCount(seedRepo.branches, 0));

  return {
    ...seedRepo,
    openPrs: asCount(syncedRepo?.openPrs, asCount(seedRepo.openPrs, 0)),
    openIssues: asCount(syncedRepo?.openIssues, asCount(seedRepo.openIssues, 0)),
    failedRuns: asCount(syncedRepo?.failedRuns, asCount(seedRepo.failedRuns, 0)),
    branches: branchCount,
    defaultBranch: syncedRepo?.defaultBranch || seedRepo.defaultBranch || "main",
    freshness: deriveRepoFreshness(syncedRepo),
    syncError: syncedRepo?.syncError || seedRepo.syncError || "",
  };
}

/**
 * Derive status-pill value for a repository.
 * Failed runs always force blocked, even when seed health is ready/review.
 */
export function deriveRepoHealthStatus(seedRepo = {}, syncedRepo = null) {
  const stats = mergeRepoStats(seedRepo, syncedRepo);
  if (stats.failedRuns > 0 || seedRepo.health === "blocked") {
    return "blocked";
  }
  if (seedRepo.health === "ready") {
    return "ready_for_agent";
  }
  return "needs_review";
}

export function isRepoBlocked(seedRepo = {}, syncedRepo = null) {
  return deriveRepoHealthStatus(seedRepo, syncedRepo) === "blocked";
}

/** Build a Set of repository ids that should be skipped by unfiltered agent next-work. */
export function blockedRepoIds(repositories = [], githubCache = null) {
  const byId = new Map((githubCache?.repos || []).map((repo) => [repo.id, repo]));
  return new Set(
    repositories
      .filter((repo) => isRepoBlocked(repo, byId.get(repo.id)))
      .map((repo) => repo.id),
  );
}

export function githubActionsUrl(repo = {}) {
  const owner = repo.owner || "your-org";
  const name = repo.name || repo.id || "";
  if (!name) return "";
  return `https://github.com/${owner}/${name}/actions`;
}

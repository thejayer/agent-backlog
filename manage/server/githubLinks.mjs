function keyVariants(key) {
  const normalized = String(key || "").trim().toLowerCase();

  if (!normalized) {
    return [];
  }

  return Array.from(new Set([normalized, normalized.replace("-", "_"), normalized.replace("-", "")]));
}

function containsKey(value, variants) {
  const normalized = String(value || "").toLowerCase();
  return variants.some((variant) => normalized.includes(variant));
}

function matchesAnyField(candidate, fields, variants) {
  return fields.some((field) => containsKey(candidate?.[field], variants));
}

function countMatches(matches) {
  return (
    matches.pullRequests.length +
    matches.branches.length +
    matches.issues.length +
    matches.workflowRuns.length
  );
}

function repoMatches(workItem, repo) {
  return repo.id === workItem.repo || repo.name === workItem.repo || repo.slug?.endsWith(`/${workItem.repo}`);
}

function normalizedGithubUrl(value) {
  return String(value || "").trim().replace(/\/$/, "").toLowerCase();
}

export function uniquePullRequests(pullRequests = []) {
  const byIdentity = new Map();

  for (const pullRequest of pullRequests) {
    const identity = normalizedGithubUrl(pullRequest?.url) || (pullRequest?.number ? String(pullRequest.number) : "");

    if (identity && !byIdentity.has(identity)) {
      byIdentity.set(identity, pullRequest);
    }
  }

  return [...byIdentity.values()];
}

export function countGithubMatches(matches) {
  return countMatches({
    pullRequests: matches?.pullRequests || [],
    branches: matches?.branches || [],
    issues: matches?.issues || [],
    workflowRuns: matches?.workflowRuns || [],
  });
}

export function findGithubMatchesForItem(workItem, githubCache) {
  const variants = keyVariants(workItem.key);
  const repos = githubCache?.repos || [];
  const repo = repos.find((candidate) => repoMatches(workItem, candidate));
  const matchedAt = new Date().toISOString();

  if (!repo || variants.length === 0) {
    return {
      repoId: workItem.repo,
      repoSlug: "",
      source: githubCache?.source || "unknown",
      matchedAt,
      bestBranch: "",
      bestPrUrl: "",
      pullRequests: [],
      branches: [],
      issues: [],
      workflowRuns: [],
    };
  }

  const pullRequests = uniquePullRequests([...(repo.mergedPulls || []), ...(repo.latestPulls || [])]).filter((pullRequest) =>
    matchesAnyField(pullRequest, ["title", "branch", "url"], variants),
  );
  const branches = (repo.branches || []).filter((branch) => containsKey(branch.name, variants));
  const issues = (repo.latestIssues || []).filter((issue) => matchesAnyField(issue, ["title", "url"], variants));
  const workflowRuns = (repo.failedWorkflowRuns || []).filter((run) =>
    matchesAnyField(run, ["name", "branch", "url"], variants),
  );
  const bestPr = pullRequests[0];
  const bestBranch = bestPr?.branch || branches[0]?.name || "";

  return {
    repoId: repo.id,
    repoSlug: repo.slug || "",
    source: githubCache?.source || "github-cache",
    matchedAt,
    bestBranch,
    bestPrUrl: bestPr?.url || "",
    pullRequests,
    branches,
    issues,
    workflowRuns,
  };
}

export function hasGithubMatches(matches) {
  return countGithubMatches(matches) > 0;
}

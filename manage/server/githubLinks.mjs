function keyVariants(key) {
  const normalized = String(key || "").trim().toLowerCase();

  if (!normalized) {
    return [];
  }

  return Array.from(new Set([normalized, normalized.replace("-", "_"), normalized.replace("-", "")]));
}

export function normalizedGithubUrl(value) {
  return String(value || "").trim().replace(/\/$/, "").toLowerCase();
}

function containsKey(value, variants) {
  const normalized = String(value || "").toLowerCase();
  return variants.some((variant) => {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(normalized);
  });
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

export function repoMatches(workItem, repo) {
  const repoId = String(repo?.id || "").trim();
  const repoName = String(repo?.name || "").trim();
  const repoSlug = String(repo?.slug || "").trim();
  const workItemRepo = String(workItem?.repo || "").trim();

  return Boolean(
    workItemRepo
    && (workItemRepo === repoId || workItemRepo === repoName || repoSlug.endsWith(`/${workItemRepo}`)),
  );
}

function pullRequestMatchesUrl(pullRequest, url) {
  return Boolean(url) && normalizedGithubUrl(pullRequest?.url) === normalizedGithubUrl(url);
}

export function githubLinksFromMergedPullRequest(repo, pullRequest, {
  source = "github-cache",
  matchedAt = new Date().toISOString(),
  currentLinks = {},
  currentBranch = "",
} = {}) {
  const pullRequests = uniquePullRequests([pullRequest, ...(currentLinks.pullRequests || [])].filter(Boolean));

  return {
    ...currentLinks,
    repoId: repo?.id || repo?.name || currentLinks.repoId || "",
    repoSlug: repo?.slug || currentLinks.repoSlug || "",
    source,
    matchedAt,
    bestBranch: pullRequest?.branch || currentLinks.bestBranch || currentBranch || "",
    bestPrUrl: String(pullRequest?.url || currentLinks.bestPrUrl || "").trim(),
    pullRequests,
    branches: currentLinks.branches || [],
    issues: currentLinks.issues || [],
    workflowRuns: currentLinks.workflowRuns || [],
  };
}

function packetBranchMatches(workItem, pullRequest) {
  const branch = String(pullRequest?.branch || "").trim();
  return Boolean(branch) && [workItem?.githubBranch, workItem?.suggestedBranch]
    .some((candidate) => String(candidate || "").trim() === branch);
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

function linkedPullRequestUrls(workItem) {
  return new Set(
    [
      workItem?.githubPrUrl,
      workItem?.lastAgentUpdate?.githubPrUrl,
      workItem?.completionEvidence?.prUrl,
      workItem?.githubLinks?.bestPrUrl,
      ...(workItem?.githubLinks?.pullRequests || []).map((pullRequest) => pullRequest?.url),
    ]
      .map(normalizedGithubUrl)
      .filter(Boolean),
  );
}

export function workItemLinksPullRequest(workItem, pullRequestUrl) {
  const url = normalizedGithubUrl(pullRequestUrl);
  return Boolean(url) && linkedPullRequestUrls(workItem).has(url);
}

const suggestionStopWords = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "pr",
  "pull",
  "request",
  "the",
  "to",
  "with",
]);

function titleTokens(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/task[-_ ]?\d+/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !suggestionStopWords.has(token)),
  );
}

function titleSimilarity(left, right) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return { score: 0, sharedTerms: 0 };
  }

  const sharedTerms = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const score = Math.round((140 * sharedTerms) / (leftTokens.size + rightTokens.size));
  return { score, sharedTerms };
}

function suggestionForPullRequest(workItems, repo, pullRequest) {
  const candidates = workItems
    .filter((workItem) => repoMatches(workItem, repo))
    .map((workItem) => {
      const variants = keyVariants(workItem.key);
      const exactKeyMatch = variants.length > 0
        && matchesAnyField(pullRequest, ["title", "branch", "url"], variants);

      if (exactKeyMatch) {
        return {
          workItem,
          score: 100,
          confidence: "high",
          reason: "Packet key appears in the pull request",
        };
      }

      const branch = String(pullRequest?.branch || "").trim();
      const branchMatch = branch && [workItem.githubBranch, workItem.suggestedBranch]
        .some((candidate) => String(candidate || "").trim() === branch);

      if (branchMatch) {
        return {
          workItem,
          score: 92,
          confidence: "high",
          reason: "Packet branch matches the pull request",
        };
      }

      const similarity = titleSimilarity(workItem.title, pullRequest.title);

      if (similarity.score < 24) {
        return null;
      }

      return {
        workItem,
        score: similarity.score,
        confidence: similarity.score >= 55 ? "medium" : "low",
        reason: `${similarity.sharedTerms} title ${similarity.sharedTerms === 1 ? "term" : "terms"} overlap`,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || String(right.workItem.updatedAt || "").localeCompare(String(left.workItem.updatedAt || "")));
  const strongest = candidates[0];

  if (!strongest) {
    return null;
  }

  return {
    key: strongest.workItem.key,
    title: strongest.workItem.title,
    status: strongest.workItem.status,
    score: strongest.score,
    confidence: strongest.confidence,
    reason: strongest.reason,
  };
}

export function findMergedPullRequest(githubCache, pullRequestUrl) {
  const url = normalizedGithubUrl(pullRequestUrl);

  if (!url) {
    return null;
  }

  for (const repo of githubCache?.repos || []) {
    const pullRequest = (repo.mergedPulls || []).find((candidate) => (
      candidate?.mergedAt && pullRequestMatchesUrl(candidate, url)
    ));

    if (pullRequest) {
      return { repo, pullRequest };
    }
  }

  return null;
}

export function reconcileMergedPullRequests(workItems = [], githubCache = {}) {
  const linkedUrls = new Set(
    workItems
      .filter((workItem) => workItem.status === "done")
      .flatMap((workItem) => [...linkedPullRequestUrls(workItem)]),
  );
  const mergedPullRequests = [];
  const seenUrls = new Set();

  for (const repo of githubCache?.repos || []) {
    for (const pullRequest of repo.mergedPulls || []) {
      const url = normalizedGithubUrl(pullRequest?.url);

      if (!pullRequest?.mergedAt || !url || seenUrls.has(url)) {
        continue;
      }

      seenUrls.add(url);
      mergedPullRequests.push({ repo, pullRequest, url });
    }
  }

  const unmatchedMergedPullRequests = mergedPullRequests
    .filter(({ url }) => !linkedUrls.has(url))
    .map(({ repo, pullRequest }) => ({
      id: `${repo.id || repo.name}:${pullRequest.number}`,
      repoId: repo.id || repo.name || "",
      repoName: repo.name || repo.id || "",
      repoSlug: repo.slug || "",
      number: pullRequest.number,
      title: pullRequest.title || `Pull request #${pullRequest.number}`,
      url: pullRequest.url,
      branch: pullRequest.branch || "",
      author: pullRequest.author || "",
      mergedBy: pullRequest.mergedBy || "",
      mergedAt: pullRequest.mergedAt,
      mergeCommitSha: pullRequest.mergeCommitSha || "",
      suggestedPacket: suggestionForPullRequest(workItems, repo, pullRequest),
    }))
    .sort((left, right) => String(right.mergedAt).localeCompare(String(left.mergedAt)));

  return {
    source: githubCache?.source || "unknown",
    syncedAt: githubCache?.syncedAt || "",
    totalMergedPullRequests: mergedPullRequests.length,
    linkedMergedPullRequests: mergedPullRequests.length - unmatchedMergedPullRequests.length,
    unmatchedMergedPullRequests,
  };
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
    matchesAnyField(pullRequest, ["title", "branch", "url"], variants)
    || workItemLinksPullRequest(workItem, pullRequest.url)
    || packetBranchMatches(workItem, pullRequest),
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

import {
  completionLinkMatches,
  findCompletionPullRequest,
  findGithubMatchesForItem,
  normalizedGithubUrl,
  parseGithubPullRequestRef,
} from "./githubLinks.mjs";

export function completionPullRequest(workItem, payload, matches, githubCache = {}) {
  return findCompletionPullRequest(workItem, payload, matches, githubCache).pullRequest;
}

export function verifiedCompletionWriteback(evidence) {
  const testsRun = Array.isArray(evidence?.tests?.results) ? evidence.tests.results : [];
  const filesChanged = Array.isArray(evidence?.files?.results) ? evidence.files.results : [];

  return {
    testsRun,
    filesChanged,
    evidenceCollection: {
      tests: { success: evidence?.tests?.success === true, results: testsRun },
      files: { success: evidence?.files?.success === true, results: filesChanged },
    },
  };
}

export function buildMergedPullRequestMatches({
  workItem,
  githubCache,
  fetched,
  parsed,
  source,
} = {}) {
  return {
    source: source || githubCache?.source || "github-cache",
    repoId: workItem?.repo || "",
    repoSlug: parsed?.slug || "",
    matchedAt: new Date().toISOString(),
    bestPrUrl: fetched?.url || "",
    bestBranch: fetched?.branch || workItem?.githubBranch || "",
    pullRequests: [{
      url: fetched?.url,
      number: fetched?.number,
      branch: fetched?.branch || workItem?.githubBranch || "",
      mergedAt: fetched?.mergedAt,
      mergeCommitSha: fetched?.mergeCommitSha,
    }],
    branches: [],
    issues: [],
    workflowRuns: [],
  };
}

function evidenceTarget(resolved) {
  const parsed = resolved?.parsed || parseGithubPullRequestRef(resolved?.pullRequest?.url || resolved?.requestedUrl);
  return {
    repoSlug: resolved?.repoSlug || parsed?.slug || "",
    number: resolved?.pullRequest?.number || parsed?.number || 0,
    url: resolved?.pullRequest?.url || resolved?.requestedUrl || parsed?.url || "",
  };
}

export async function resolveCompletionGithubEvidence(workItem, payload = {}, {
  githubCache,
  localGithubCache = false,
  fetchEvidence,
} = {}) {
  const matches = findGithubMatchesForItem(workItem, githubCache);
  const resolved = findCompletionPullRequest(workItem, payload, matches, githubCache);
  const pullRequest = resolved.pullRequest;
  const completionGithubMatches = completionLinkMatches(workItem, resolved, matches);

  if (!pullRequest && !localGithubCache && typeof fetchEvidence === "function" && resolved.parsed) {
    try {
      const evidence = await fetchEvidence(resolved.parsed.slug, resolved.parsed.number);
      const fetched = evidence?.pullRequest;
      if (fetched?.mergedAt) {
        if (normalizedGithubUrl(fetched.url) !== normalizedGithubUrl(resolved.parsed.url)) {
          throw new Error("GitHub returned evidence for a different pull request");
        }
        return {
          completionGithubMatches: buildMergedPullRequestMatches({
            workItem,
            githubCache,
            fetched,
            parsed: resolved.parsed,
            source: "github-delivery",
          }),
          verifiedCompletionWriteback: verifiedCompletionWriteback(evidence),
        };
      }
    } catch (error) {
      if (error.message === "GitHub returned evidence for a different pull request") {
        throw Object.assign(new Error(`Unable to verify delivery evidence: ${error.message}`), { statusCode: 409 });
      }
      // Fall through to the packet-level evidence check. A missing or
      // unreachable pull request is treated as incomplete delivery evidence.
    }
  }

  if (!pullRequest) {
    return { completionGithubMatches: null, verifiedCompletionWriteback: null };
  }

  try {
    const target = evidenceTarget(resolved);
    const evidence = localGithubCache
      ? pullRequest.deliveryEvidence
      : await fetchEvidence(target.repoSlug, target.number);

    if (
      !evidence
      || normalizedGithubUrl(evidence.pullRequest?.url || pullRequest.url) !== normalizedGithubUrl(pullRequest.url)
    ) {
      throw new Error("GitHub returned evidence for a different pull request");
    }

    return {
      completionGithubMatches,
      verifiedCompletionWriteback: verifiedCompletionWriteback(evidence),
    };
  } catch (error) {
    throw Object.assign(new Error(`Unable to verify delivery evidence: ${error.message}`), { statusCode: 409 });
  }
}

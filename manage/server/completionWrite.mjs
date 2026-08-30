import { findGithubMatchesForItem, hasGithubMatches } from "./githubLinks.mjs";
import { parseGithubPullRequestUrl } from "./githubSync.mjs";

function normalizedGithubUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

export function completionPullRequest(workItem, payload, matches) {
  const requestedUrl = normalizedGithubUrl(
    payload.githubPrUrl || workItem.lastAgentUpdate?.githubPrUrl || workItem.githubPrUrl,
  );

  if (!requestedUrl) {
    return null;
  }

  return (matches.pullRequests || []).find(
    (pullRequest) => normalizedGithubUrl(pullRequest?.url) === requestedUrl && pullRequest?.mergedAt,
  ) || null;
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
} = {}) {
  return {
    source: githubCache?.source || "github-cache",
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

export async function resolveCompletionGithubEvidence(workItem, payload = {}, {
  githubCache,
  localGithubCache = false,
  fetchEvidence,
} = {}) {
  const matches = findGithubMatchesForItem(workItem, githubCache);
  let pullRequest = completionPullRequest(workItem, payload, matches);
  let completionGithubMatches = pullRequest && hasGithubMatches(matches) ? matches : null;

  if (!pullRequest && !localGithubCache && typeof fetchEvidence === "function") {
    const parsed = parseGithubPullRequestUrl(
      payload.githubPrUrl || workItem.lastAgentUpdate?.githubPrUrl || workItem.githubPrUrl,
    );

    if (parsed) {
      try {
        const evidence = await fetchEvidence(parsed.slug, parsed.number);
        const fetched = evidence?.pullRequest;
        if (fetched?.mergedAt) {
          const liveMatches = buildMergedPullRequestMatches({
            workItem,
            githubCache,
            fetched,
            parsed,
          });
          return {
            completionGithubMatches: liveMatches,
            verifiedCompletionWriteback: verifiedCompletionWriteback(evidence),
          };
        }
      } catch {
        // Fall through to the packet-level evidence check. A missing or
        // unreachable pull request is treated as incomplete delivery evidence.
      }
    }
  }

  if (!pullRequest) {
    return { completionGithubMatches: null, verifiedCompletionWriteback: null };
  }

  try {
    const evidence = localGithubCache
      ? pullRequest.deliveryEvidence
      : await fetchEvidence(matches.repoSlug, pullRequest.number);

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

const requirementCopy = {
  agent_note: {
    label: "Latest agent note",
    missing: "Add a reviewer-facing agent note.",
    repair: "packet",
  },
  pull_request: {
    label: "Linked pull request",
    missing: "Link the delivery pull request.",
    repair: "packet",
  },
  merged_pull_request: {
    label: "Merged pull request",
    missing: "Refresh GitHub evidence after the pull request merges.",
    repair: "github",
  },
  tests_run: {
    label: "Tests run",
    missing: "Record the verification commands and results.",
    repair: "packet",
  },
  files_changed: {
    label: "Files changed",
    missing: "Record the delivered files.",
    repair: "packet",
  },
};

export const MIN_COMPLETION_OVERRIDE_REASON_LENGTH = 12;

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value || {}, field);
}

function lines(value) {
  return (Array.isArray(value) ? value : String(value || "").split("\n"))
    .map((entry) => String(entry).trim())
    .filter(Boolean);
}

function isSuccessfulEvidenceResult(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\b0\s+failed\b/gi, "");

  if (!normalized) {
    return false;
  }

  return !(
    /^no\s+(?:changed files|pr checks|tests?)\b/i.test(normalized) ||
    /^gh\b.*\bfailed:/i.test(normalized) ||
    /(?:^|\s)[-—:]?\s*(?:fail|failed|failure|error)\b/i.test(normalized)
  );
}

function normalizeCollectionPart(part, fallbackResults) {
  const supplied = part && typeof part === "object" ? part : {};
  const results = lines(hasOwn(supplied, "results") ? supplied.results : fallbackResults);
  const resultsAreValid = results.length > 0 && results.every(isSuccessfulEvidenceResult);

  return {
    success: supplied.success === false ? false : resultsAreValid,
    results,
  };
}

export function normalizeEvidenceCollection(value = {}, { testsRun = [], filesChanged = [] } = {}) {
  const supplied = value && typeof value === "object" ? value : {};

  return {
    tests: normalizeCollectionPart(supplied.tests, testsRun),
    files: normalizeCollectionPart(supplied.files, filesChanged),
  };
}

function normalizedUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function writebackValue(writeback, current, field) {
  return hasOwn(writeback, field) ? writeback[field] : current?.[field];
}

function matchingPullRequest(item, prUrl) {
  const normalizedPrUrl = normalizedUrl(prUrl);

  if (!normalizedPrUrl) {
    return null;
  }

  return (item.githubLinks?.pullRequests || []).find(
    (pullRequest) => normalizedUrl(pullRequest?.url) === normalizedPrUrl,
  ) || null;
}

export function normalizeCompletionOverrideReason(value) {
  return String(value || "").trim();
}

export function reviewCompletionEvidence(item, { writeback = {} } = {}) {
  const currentUpdate = item.lastAgentUpdate || {};
  const note = String(writebackValue(writeback, currentUpdate, "note") || "").trim();
  const testsRun = lines(writebackValue(writeback, currentUpdate, "testsRun"));
  const filesChanged = lines(writebackValue(writeback, currentUpdate, "filesChanged"));
  const evidenceCollection = normalizeEvidenceCollection(
    writebackValue(writeback, currentUpdate, "evidenceCollection"),
    { testsRun, filesChanged },
  );
  const prUrl = normalizedUrl(
    hasOwn(writeback, "githubPrUrl")
      ? writeback.githubPrUrl
      : currentUpdate.githubPrUrl || item.githubPrUrl,
  );
  const pullRequest = matchingPullRequest(item, prUrl);
  const mergedAt = String(pullRequest?.mergedAt || "").trim();
  const mergeCommitSha = String(pullRequest?.mergeCommitSha || "").trim();
  const source = item.githubLinks?.source || "github-cache";
  const states = {
    agent_note: Boolean(note),
    pull_request: Boolean(prUrl),
    merged_pull_request: Boolean(prUrl && mergedAt),
    tests_run: evidenceCollection.tests.success,
    files_changed: evidenceCollection.files.success,
  };
  const checks = Object.entries(requirementCopy).map(([id, copy]) => ({
    id,
    ...copy,
    satisfied: states[id],
  }));
  const missing = checks.filter((check) => !check.satisfied);

  return {
    canComplete: missing.length === 0,
    checks,
    missing,
    note,
    testsRun,
    filesChanged,
    evidenceCollection,
    prUrl,
    pullRequest,
    mergedAt,
    mergeCommitSha,
    completionEvidence: mergedAt
      ? {
          source,
          prUrl,
          mergedAt,
          mergeCommitSha,
          testsRun,
          filesChanged,
          evidenceCollection,
        }
      : null,
  };
}

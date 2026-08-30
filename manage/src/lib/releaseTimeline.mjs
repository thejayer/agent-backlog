const DEPLOYMENT_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

function parseTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function packetCompletedAt(packet) {
  if (packet?.status !== "done") {
    return "";
  }

  return packet.completedAt
    || (packet.lastAgentUpdate?.status === "done" ? packet.lastAgentUpdate.at : "")
    || packet.updatedAt
    || packet.createdAt
    || "";
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/$/, "").toLowerCase();
}

function keyPattern(key) {
  const match = String(key || "").trim().match(/^([a-z]+)-(\d+)$/i);
  return match ? new RegExp(`\\b${match[1]}[-_]?${match[2]}\\b`, "i") : null;
}

function containsPacketKey(value, key) {
  const pattern = keyPattern(key);
  return Boolean(pattern && pattern.test(String(value || "")));
}

function repoMatches(packet, repo) {
  return repo?.id === packet?.repo
    || repo?.name === packet?.repo
    || String(repo?.slug || "").endsWith(`/${packet?.repo}`);
}

function packetPullRequestUrls(packet) {
  return new Set([
    packet?.githubPrUrl,
    ...(Array.isArray(packet?.githubLinks?.pullRequests)
      ? packet.githubLinks.pullRequests.map((pullRequest) => pullRequest?.url)
      : []),
  ].map(normalizeUrl).filter(Boolean));
}

function packetBranches(packet) {
  return new Set([
    packet?.githubBranch,
    packet?.suggestedBranch,
    packet?.lastAgentUpdate?.githubBranch,
    ...(Array.isArray(packet?.githubLinks?.branches)
      ? packet.githubLinks.branches.map((branch) => typeof branch === "string" ? branch : branch?.name)
      : []),
  ].map((branch) => String(branch || "").trim().toLowerCase()).filter(Boolean));
}

function pullRequestMatchesPacket(packet, repo, pullRequest) {
  const pullRequestUrl = normalizeUrl(pullRequest?.url);
  const hasExactUrl = pullRequestUrl && packetPullRequestUrls(packet).has(pullRequestUrl);

  if (!hasExactUrl && !repoMatches(packet, repo)) {
    return false;
  }

  const branch = String(pullRequest?.branch || "").trim().toLowerCase();
  return hasExactUrl
    || (branch && packetBranches(packet).has(branch))
    || [pullRequest?.title, pullRequest?.branch, pullRequest?.url]
      .some((value) => containsPacketKey(value, packet.key));
}

function deploymentTime(run) {
  return run?.runStartedAt || run?.updatedAt || run?.createdAt || "";
}

function directDeploymentPacketKeys(run, packets) {
  const branch = String(run?.branch || "").trim().toLowerCase();
  return packets
    .filter((packet) => (
      (branch && packetBranches(packet).has(branch))
      || [run?.name, run?.branch, run?.url].some((value) => containsPacketKey(value, packet.key))
    ))
    .map((packet) => packet.key);
}

function nearestPrecedingPullRequest(run, pullRequests, defaultBranch) {
  const runAt = parseTimestamp(deploymentTime(run));
  const runBranch = String(run?.branch || "").trim().toLowerCase();
  const normalizedDefaultBranch = String(defaultBranch || "").trim().toLowerCase();

  if (!runAt || !normalizedDefaultBranch || runBranch !== normalizedDefaultBranch) {
    return null;
  }

  return pullRequests
    .filter((pullRequest) => {
      const mergedAt = parseTimestamp(pullRequest.mergedAt);
      const baseBranch = String(pullRequest.baseBranch || "").trim().toLowerCase();
      if (!mergedAt || baseBranch !== normalizedDefaultBranch || mergedAt > runAt) {
        return false;
      }
      return runAt.getTime() - mergedAt.getTime() <= DEPLOYMENT_MATCH_WINDOW_MS;
    })
    .sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)))[0] || null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function buildInitiativeReleaseTimeline({ initiative, items = [], githubCache = null } = {}) {
  const linkedKeys = new Set(initiative?.packetKeys || []);
  const packets = items.filter((item) => linkedKeys.has(item.key) && item.status === "done");
  const events = [];

  for (const packet of packets) {
    const occurredAt = packetCompletedAt(packet);
    if (!occurredAt || !parseTimestamp(occurredAt)) {
      continue;
    }

    events.push({
      id: `packet:${packet.key}:${occurredAt}`,
      type: "packet",
      occurredAt,
      title: `${packet.key} completed`,
      summary: packet.title,
      repo: packet.repo || "",
      packetKey: packet.key,
      packetKeys: [packet.key],
      url: "",
    });
  }

  for (const repo of githubCache?.repos || []) {
    const repoPackets = packets.filter((packet) => repoMatches(packet, repo));
    const matchingPullRequests = [];

    for (const pullRequest of repo.mergedPulls || []) {
      if (!pullRequest?.mergedAt || !parseTimestamp(pullRequest.mergedAt)) {
        continue;
      }

      const matchingPackets = packets.filter((packet) => pullRequestMatchesPacket(packet, repo, pullRequest));
      if (matchingPackets.length === 0) {
        continue;
      }

      const packetKeys = unique(matchingPackets.map((packet) => packet.key));
      const enrichedPullRequest = { ...pullRequest, packetKeys };
      matchingPullRequests.push(enrichedPullRequest);
      events.push({
        id: `pull-request:${pullRequest.url || `${repo.id || repo.slug}#${pullRequest.number}`}`,
        type: "pull_request",
        occurredAt: pullRequest.mergedAt,
        title: pullRequest.title || `Pull request #${pullRequest.number} merged`,
        summary: `Merged pull request #${pullRequest.number}`,
        repo: repo.id || repo.name || repo.slug || "",
        repoSlug: repo.slug || "",
        packetKeys,
        url: pullRequest.url || "",
      });
    }

    for (const run of repo.deploymentWorkflowRuns || []) {
      const occurredAt = deploymentTime(run);
      if (run?.conclusion !== "success" || !occurredAt || !parseTimestamp(occurredAt)) {
        continue;
      }

      const mergeMatches = matchingPullRequests.filter((pullRequest) => (
        run.headSha && pullRequest.mergeCommitSha && run.headSha === pullRequest.mergeCommitSha
      ));
      let packetKeys = unique([
        ...directDeploymentPacketKeys(run, repoPackets),
        ...mergeMatches.flatMap((pullRequest) => pullRequest.packetKeys),
      ]);

      if (packetKeys.length === 0) {
        const nearestPullRequest = nearestPrecedingPullRequest(run, matchingPullRequests, repo.defaultBranch);
        packetKeys = nearestPullRequest?.packetKeys || [];
      }

      if (packetKeys.length === 0) {
        continue;
      }

      events.push({
        id: `deployment:${repo.id || repo.slug}:${run.id}`,
        type: "deployment",
        occurredAt,
        title: `${run.name || "Deployment"} succeeded`,
        summary: run.branch ? `Released from ${run.branch}` : "Successful deployment workflow",
        repo: repo.id || repo.name || repo.slug || "",
        repoSlug: repo.slug || "",
        packetKeys,
        url: run.url || "",
      });
    }
  }

  const seen = new Set();
  return events
    .filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
}

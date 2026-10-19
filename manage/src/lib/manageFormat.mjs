import { priorityOptions, repositories, statusOptions } from "../data/workItems.mjs";
import { deriveRepoHealthStatus } from "./repoHealth.mjs";
import { itemLabels } from "../features/backlog/useBacklogController.mjs";

export function formatStatus(statusId) {
  return statusOptions.find((status) => status.id === statusId)?.label || statusId;
}

export function formatPriority(priorityId) {
  return priorityOptions.find((priority) => priority.id === priorityId)?.label || priorityId;
}

export function labelsToText(value) {
  return itemLabels({ labels: value }).join(", ");
}

export function getStatusTone(statusId) {
  return statusOptions.find((status) => status.id === statusId)?.tone || "muted";
}

export function getRepo(repoId) {
  return repositories.find((repo) => repo.id === repoId);
}

export function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

export function formatRelativeTime(value) {
  if (!value) {
    return "Not recorded";
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "Not recorded";
  }

  const diffMs = Date.now() - timestamp;
  const suffix = diffMs >= 0 ? "ago" : "from now";
  const absoluteMs = Math.abs(diffMs);
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (absoluteMs < minuteMs) {
    return "just now";
  }

  if (absoluteMs < hourMs) {
    const minutes = Math.round(absoluteMs / minuteMs);
    return `${minutes}m ${suffix}`;
  }

  if (absoluteMs < dayMs) {
    const hours = Math.round(absoluteMs / hourMs);
    return `${hours}h ${suffix}`;
  }

  const days = Math.round(absoluteMs / dayMs);
  return `${days}d ${suffix}`;
}

export function linesFromValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function hasStructuredAgentUpdate(update) {
  return ["githubBranch", "githubPrUrl", "testsRun", "filesChanged", "blockers", "nextSteps"].some((field) => {
    const value = update?.[field];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
}

export function formatEventType(type) {
  if (type === "claimed") {
    return "Claimed";
  }

  if (type === "progress") {
    return "Progress update";
  }

  if (type === "needs_review") {
    return "Submitted for review";
  }

  if (type === "done") {
    return "Closed out";
  }

  if (type === "blocked") {
    return "Blocked";
  }

  if (type === "status") {
    return "Status update";
  }

  if (type === "recovery") {
    return "Recovery action";
  }

  if (type === "completion_override") {
    return "Completion override";
  }

  if (type === "heartbeat") {
    return "Heartbeat";
  }

  if (type === "note") {
    return "Human note";
  }

  if (type === "pull_request") {
    return "GitHub pull request";
  }

  if (type === "check_run") {
    return "GitHub check run";
  }

  if (type === "check_suite") {
    return "GitHub check suite";
  }

  return type || "Event";
}

export function formatPacketRoomEventLabel(event) {
  if (event?.kind === "heartbeat") {
    return "Heartbeat";
  }

  if (event?.kind === "human_note" || event?.type === "note") {
    return "Human note";
  }

  if (event?.kind === "github") {
    if (event.type === "status") {
      return "GitHub commit status";
    }
    return formatEventType(event.type);
  }

  return formatAgentEventLabel(event);
}

export function formatAgentEventLabel(event) {
  if (event?.type === "status") {
    if (event.status === "needs_review") {
      return "Submitted for review";
    }

    if (event.status === "done") {
      return "Closed out";
    }

    if (event.status === "blocked") {
      return "Blocked";
    }

    if (event.status === "in_progress" || event.status === "claimed") {
      return "Progress update";
    }
  }

  if (event?.type === "recovery") {
    if (event.action === "extend") return "Extended lease";
    if (event.action === "reclaim") return "Reclaimed";
    if (event.action === "release") return "Released";
    return "Recovery action";
  }

  return formatEventType(event?.type);
}

export function buildActivityFeed(items, limit = 5) {
  return items
    .flatMap((item) =>
      (item.agentEvents || []).map((event) => ({
        ...event,
        key: item.key,
        title: item.title,
        repo: item.repo,
        at: event.at || item.updatedAt,
      })),
    )
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
    .slice(0, limit);
}

export function activityTone(type, status) {
  const effectiveType = type === "status" ? status : type;

  if (effectiveType === "claimed") {
    return "claimed";
  }

  if (effectiveType === "needs_review" || effectiveType === "blocked") {
    return "review";
  }

  if (effectiveType === "done") {
    return "done";
  }

  return "progress";
}

export function activityIcon(type, status) {
  const effectiveType = type === "status" ? status : type;

  if (effectiveType === "claimed") {
    return "agent";
  }

  if (effectiveType === "needs_review" || effectiveType === "blocked") {
    return "review";
  }

  if (effectiveType === "done") {
    return "check";
  }

  return "queue";
}

export function leaseProgress(item) {
  const claimedAt = Date.parse(item?.claimedAt || "");
  const expiresAt = Date.parse(item?.leaseExpiresAt || "");

  if (!Number.isFinite(claimedAt) || !Number.isFinite(expiresAt) || expiresAt <= claimedAt) {
    return null;
  }

  const remaining = Math.max(0, expiresAt - Date.now());
  const total = expiresAt - claimedAt;
  return Math.max(0, Math.min(100, Math.round((remaining / total) * 100)));
}

export function repoHealthStatus(repo) {
  return deriveRepoHealthStatus(repo);
}

export function buildMiniRepoHealth(githubCache) {
  const githubByRepo = new Map((githubCache?.repos || []).map((repo) => [repo.id, repo]));

  return repositories.map((repo) => {
    const syncedRepo = githubByRepo.get(repo.id);
    const branchValue = syncedRepo?.branches;
    const branchCount = Array.isArray(branchValue) ? branchValue.length : Number(branchValue || 0);

    return {
      ...repo,
      openPrs: syncedRepo?.openPrs ?? repo.openPrs ?? 0,
      openIssues: syncedRepo?.openIssues ?? 0,
      failedRuns: syncedRepo?.failedRuns ?? repo.failedRuns ?? 0,
      branches: Number.isFinite(branchCount) ? branchCount : 0,
      defaultBranch: syncedRepo?.defaultBranch || "main",
      syncError: syncedRepo?.syncError || "",
    };
  });
}

export function isLeaseActive(item) {
  if (!item?.leaseExpiresAt) {
    return false;
  }

  const expiresAt = Date.parse(item.leaseExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function isAgentWorkInMotion(item) {
  return item?.status === "claimed" || item?.status === "in_progress";
}

export function isAgentRunVisible(item) {
  return item?.agentRunHealth?.state
    ? item.agentRunHealth.state !== "idle"
    : isAgentWorkInMotion(item);
}

export function leaseSummary(item) {
  if (!item?.leaseExpiresAt) {
    return { label: "not recorded", tone: "missing" };
  }

  const expiresAt = Date.parse(item.leaseExpiresAt);

  if (!Number.isFinite(expiresAt)) {
    return { label: "invalid lease", tone: "missing" };
  }

  if (expiresAt > Date.now()) {
    return { label: `expires ${formatRelativeTime(item.leaseExpiresAt)}`, tone: "active" };
  }

  return { label: `expired ${formatRelativeTime(item.leaseExpiresAt)}`, tone: "stale" };
}

export function githubMatchCount(item) {
  const links = item?.githubLinks;

  if (!links) {
    return 0;
  }

  return (
    (links.pullRequests || []).length +
    (links.branches || []).length +
    (links.issues || []).length +
    (links.workflowRuns || []).length
  );
}

export function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function manageOrigin() {
  return typeof window === "undefined" ? "http://127.0.0.1:5186" : window.location.origin;
}

export function agentTaskMarkdownUrl(item) {
  return `${manageOrigin()}/agent/${encodeURIComponent(item.key)}.md`;
}

export function agentTaskJsonUrl(item) {
  return `${manageOrigin()}/api/agent/tasks/${encodeURIComponent(item.key)}`;
}

export function tokenHintForMode(mode) {
  return mode === "local" ? "manage-local-agent" : "$MANAGE_AUTH_TOKEN";
}

export function formatStorageKind(kind) {
  if (kind === "firestore") {
    return "Firestore";
  }

  if (kind === "file") {
    return "File store";
  }

  return kind || "Unknown";
}

export function formatProviderState(enabled, label) {
  return enabled ? `${label} on` : `${label} off`;
}

export function githubFreshnessFromState(syncState, source = "") {
  if (syncState === "current" || (!syncState && ["mock", "seed"].includes(source))) {
    return "fresh";
  }

  if (syncState === "stale" || syncState === "partially_degraded" || syncState === "degraded") {
    return "stale";
  }

  return "unknown";
}

export function formatGithubSyncValue(githubSync) {
  const source = githubSync?.source || "checking";
  const freshness = githubSync?.freshness || githubFreshnessFromState(githubSync?.syncState, source);

  if (freshness === "fresh") {
    return `Fresh · ${source}`;
  }

  if (freshness === "stale") {
    return `Stale · ${source}`;
  }

  return source;
}

export function githubSyncTone(githubSync) {
  const freshness = githubSync?.freshness || githubFreshnessFromState(githubSync?.syncState, githubSync?.source);
  if (freshness === "fresh") {
    return "ready";
  }
  if (freshness === "stale") {
    return "stale";
  }
  return "info";
}

export function formatRepoSyncFreshness(repo, cache) {
  const freshness = githubFreshnessFromState(repo?.syncState, cache?.source);
  if (freshness === "fresh") {
    return "Fresh";
  }
  if (repo?.syncState === "degraded") {
    return "Degraded";
  }
  if (freshness === "stale") {
    return "Stale";
  }
  return "Not synced";
}

export const initiativeStatusLabels = { planned: "Planned", active: "Active", paused: "Paused", complete: "Complete" };
export const initiativeHealthLabels = { on_track: "On track", watch: "Watch", blocked: "Blocked" };

export function initiativeRollup(initiative, items) {
  const packetKeys = new Set(initiative.packetKeys || []);
  const packets = items.filter((item) => packetKeys.has(item.key));
  const done = packets.filter((item) => item.status === "done").length;
  const pullRequests = new Set(packets.map((item) => item.githubPrUrl).filter(Boolean));
  return { packets, done, pullRequests: [...pullRequests], progress: packets.length ? Math.round((done / packets.length) * 100) : 0 };
}

export function formatAttentionAge(minutes) {
  if (!Number.isFinite(minutes)) {
    return "Age unavailable";
  }

  if (minutes < 1) {
    return "Just now";
  }

  if (minutes < 60) {
    return `${Math.floor(minutes)}m old`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h old`;
  }

  return `${Math.floor(hours / 24)}d old`;
}

export function attentionActionKey(item) {
  if (item.action.kind === "agent_recovery") {
    return `${item.packetKey}:${item.action.recovery}`;
  }

  if (item.action.kind === "link_merge") {
    return `link:${item.pullRequest.id}`;
  }

  if (item.action.kind === "create_follow_up") {
    return `follow_up:${item.pullRequest.id}`;
  }

  return "";
}

export function agentInitials(agent) {
  return agent
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

export function linesToText(value) {
  return Array.isArray(value) ? value.join("\n") : String(value || "");
}

export function itemToDraft(item) {
  return {
    title: item.title || "",
    status: item.status || "draft",
    priority: item.priority || "medium",
    project: item.project || "",
    repo: item.repo || "web-app",
    suggestedBranch: item.suggestedBranch || "",
    summary: item.summary || "",
    desiredOutcome: item.desiredOutcome || "",
    acceptanceCriteria: linesToText(item.acceptanceCriteria),
    relevantFiles: linesToText(item.relevantFiles),
    relevantUrls: linesToText(item.relevantUrls),
    implementationNotes: linesToText(item.implementationNotes),
    testCommands: linesToText(item.testCommands),
    labels: labelsToText(item.labels),
    deployNotes: item.deployNotes || "",
    blockedBy: item.blockedBy || "",
    agent: item.agent || "",
    githubBranch: item.githubBranch || "",
    githubPrUrl: item.githubPrUrl || "",
    githubIssueUrl: item.githubIssueUrl || "",
    githubIssueNumber: item.githubIssueNumber || "",
    githubIssueTitle: item.githubIssueTitle || "",
  };
}

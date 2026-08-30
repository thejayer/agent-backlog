import { reviewCompletionEvidence } from "./reviewEvidence.mjs";

export const attentionInboxFilters = [
  { id: "all", label: "All" },
  { id: "review", label: "Review" },
  { id: "agent", label: "Agent" },
  { id: "github", label: "GitHub" },
  { id: "handoff", label: "Handoff" },
];

const minuteMs = 60_000;
const agingReviewMinutes = 24 * 60;
const severityRank = {
  critical: 4,
  high: 3,
  warning: 2,
  info: 1,
};

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function ageMinutes(value, now) {
  const occurredAt = timestamp(value);

  if (occurredAt == null) {
    return null;
  }

  return Math.max(0, Math.floor((now.getTime() - occurredAt) / minuteMs));
}

function ageTimestamp(item) {
  return item?.lastAgentUpdate?.at || item?.updatedAt || item?.claimedAt || item?.createdAt || "";
}

function agentAttentionItem(item, now) {
  const health = item?.agentRunHealth;

  if (!health || !["failed", "stale", "incomplete", "expiring"].includes(health.state)) {
    return null;
  }

  const recoveryId = health.state === "expiring" ? "extend" : "reclaim";
  const recoveryAction = (health.actions || []).find((action) => action.id === recoveryId);
  const occurredAt = health.context?.lastActivityAt || ageTimestamp(item);
  const categories = health.state === "incomplete" ? ["agent", "handoff"] : ["agent"];

  return {
    id: `agent:${item.key}:${health.state}`,
    primaryCategory: "agent",
    categories,
    severity: health.severity === "critical" ? "critical" : health.state === "expiring" ? "warning" : "high",
    title: health.label || "Agent run needs attention",
    reason: health.summary || "This agent run needs an operator decision.",
    packetKey: item.key,
    repo: item.repo || "Unknown repo",
    occurredAt,
    ageMinutes: health.freshness?.ageMinutes ?? ageMinutes(occurredAt, now),
    action: recoveryAction
      ? { kind: "agent_recovery", recovery: recoveryId, label: recoveryAction.label }
      : { kind: "open_packet", label: "Open packet" },
  };
}

function reviewAttentionItem(item, now) {
  if (item?.status !== "needs_review") {
    return null;
  }

  const evidence = reviewCompletionEvidence(item);
  const handoffMissing = evidence.missing.filter((requirement) => requirement.id !== "merged_pull_request");
  const occurredAt = ageTimestamp(item);
  const age = ageMinutes(occurredAt, now);

  if (handoffMissing.length > 0) {
    return {
      id: `handoff:${item.key}`,
      primaryCategory: "handoff",
      categories: ["handoff", "review"],
      severity: "high",
      title: "Review handoff is incomplete",
      reason: `Missing ${handoffMissing.map((requirement) => requirement.label.toLowerCase()).join(", ")}.`,
      packetKey: item.key,
      repo: item.repo || "Unknown repo",
      occurredAt,
      ageMinutes: age,
      action: { kind: "open_packet", label: "Complete handoff" },
    };
  }

  if (age == null || age < agingReviewMinutes) {
    return null;
  }

  return {
    id: `review:${item.key}`,
    primaryCategory: "review",
    categories: ["review"],
    severity: "warning",
    title: "Review is aging",
    reason: "The delivery handoff is complete, but reviewer action has been waiting for more than 24 hours.",
    packetKey: item.key,
    repo: item.repo || "Unknown repo",
    occurredAt,
    ageMinutes: age,
    action: { kind: "open_review", label: "Open review" },
  };
}

function githubAttentionItem(pullRequest, now) {
  const suggestedPacket = pullRequest?.suggestedPacket;
  const canLinkSafely = suggestedPacket?.confidence === "high" && suggestedPacket?.key;
  const occurredAt = pullRequest?.mergedAt || "";

  return {
    id: `github:${pullRequest.id || pullRequest.url}`,
    primaryCategory: "github",
    categories: ["github"],
    severity: canLinkSafely ? "high" : "warning",
    title: "Merged PR is not linked",
    reason: canLinkSafely
      ? `${suggestedPacket.reason}. Confirm the suggested packet link.`
      : "No high-confidence packet match was found for this merged pull request.",
    packetKey: canLinkSafely ? suggestedPacket.key : "",
    repo: pullRequest.repoId || pullRequest.repoName || "Unknown repo",
    pullRequest,
    reference: `#${pullRequest.number} ${pullRequest.title}`,
    occurredAt,
    ageMinutes: ageMinutes(occurredAt, now),
    action: canLinkSafely
      ? { kind: "link_merge", label: `Link ${suggestedPacket.key}` }
      : { kind: "create_follow_up", label: "Create follow-up" },
  };
}

function priorityScore(item) {
  const severity = severityRank[item.severity] || 0;
  const stateBonus = item.id.includes(":failed") ? 30 : item.id.startsWith("handoff:") ? 20 : 0;
  const ageBonus = Math.min(Math.floor((item.ageMinutes || 0) / 60), 20);
  return severity * 100 + stateBonus + ageBonus;
}

export function buildAttentionInbox({ workItems = [], reconciliation = {}, now = new Date() } = {}) {
  const evaluatedAt = now instanceof Date ? now : new Date(now);
  const agentItems = workItems.map((item) => agentAttentionItem(item, evaluatedAt)).filter(Boolean);
  const reviewItems = workItems.map((item) => reviewAttentionItem(item, evaluatedAt)).filter(Boolean);
  const unmatchedMergedPullRequests = Array.isArray(reconciliation?.unmatchedMergedPullRequests)
    ? reconciliation.unmatchedMergedPullRequests
    : [];
  const githubItems = unmatchedMergedPullRequests
    .filter(Boolean)
    .map((pullRequest) => githubAttentionItem(pullRequest, evaluatedAt));

  return [...agentItems, ...reviewItems, ...githubItems]
    .map((item) => ({ ...item, priorityScore: priorityScore(item) }))
    .sort((left, right) => (
      right.priorityScore - left.priorityScore
      || (right.ageMinutes || 0) - (left.ageMinutes || 0)
      || left.id.localeCompare(right.id)
    ));
}

export function attentionCount(items, filterId) {
  if (filterId === "all") {
    return items.length;
  }

  return items.filter((item) => item.categories.includes(filterId)).length;
}

export function attentionDestination(item) {
  if (item?.primaryCategory === "github") {
    return "repos";
  }

  if (item?.primaryCategory === "agent") {
    return "agents";
  }

  if (item?.primaryCategory === "review" || item?.primaryCategory === "handoff") {
    return "review";
  }

  return "backlog";
}

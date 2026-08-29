import { configuredRepositorySlug } from "../src/data/workItems.mjs";
import {
  AGENT_RUN_DEFAULT_LEASE_MINUTES,
  AGENT_RUN_EXTEND_LEASE_MINUTES,
} from "../src/lib/agentRunContract.mjs";

const MIN_LEASE_MINUTES = 5;
const MAX_LEASE_MINUTES = 8 * 60;
const EXPIRING_LEASE_MINUTES = 15;
const EXPIRING_LEASE_RATIO = 0.2;
const FRESH_ACTIVITY_MINUTES = 15;
const STALE_ACTIVITY_MINUTES = 60;
const minuteMs = 60_000;
const leasedStatuses = new Set(["claimed", "in_progress"]);

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function nowTimestamp(now) {
  if (now instanceof Date) return now.getTime();
  const parsed = Number(now);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function latestAgentActivityAt(item) {
  const candidates = [
    item?.lastAgentUpdate?.at,
    ...(item?.agentEvents || []).map((event) => event?.at),
    item?.claimedAt,
  ]
    .map(timestamp)
    .filter(Number.isFinite);

  if (candidates.length > 0) {
    return new Date(Math.max(...candidates)).toISOString();
  }

  return timestamp(item?.updatedAt) == null ? "" : new Date(timestamp(item.updatedAt)).toISOString();
}

function githubContextUrl(item) {
  const pullRequestUrl = safeHttpUrl(item?.githubPrUrl);

  if (pullRequestUrl) {
    return pullRequestUrl;
  }

  const branch = String(item?.githubBranch || "").trim();
  const repoSlug = configuredRepositorySlug(item?.githubLinks?.repoSlug || item?.repo);

  if (!branch || !repoSlug) {
    return "";
  }

  const encodedBranch = branch.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${repoSlug}/tree/${encodedBranch}`;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function action(id, label, tone = "secondary") {
  return { id, label, tone };
}

function recoveryActions(state, contextUrl) {
  const actions = [];

  if (state === "healthy" || state === "expiring") {
    actions.push(
      action("extend", `Extend ${AGENT_RUN_EXTEND_LEASE_MINUTES}m`),
      action("release", "Release", "danger"),
    );
  }

  if (state === "stale" || state === "incomplete" || state === "failed") {
    actions.push(action("reclaim", "Reclaim"), action("release", "Release", "danger"));
  }

  if (contextUrl) {
    actions.push(action("open_context", "Open run context"));
  }

  return actions;
}

export function isLeasedStatus(status) {
  return leasedStatuses.has(status);
}

export function normalizeLeaseMinutes(value) {
  const minutes = Number(value);

  if (!Number.isFinite(minutes) || minutes <= 0) {
    return AGENT_RUN_DEFAULT_LEASE_MINUTES;
  }

  return Math.min(Math.max(Math.round(minutes), MIN_LEASE_MINUTES), MAX_LEASE_MINUTES);
}

export function isLeaseActive(item, now = new Date()) {
  if (!isLeasedStatus(item?.status) || !item?.leaseExpiresAt) {
    return false;
  }

  const expiresAt = timestamp(item.leaseExpiresAt);
  return expiresAt != null && expiresAt > nowTimestamp(now);
}

export function deriveAgentRunHealth(item, now = new Date()) {
  const evaluatedAtMs = nowTimestamp(now);
  const evaluatedAt = new Date(evaluatedAtMs).toISOString();
  const status = String(item?.status || "").trim();
  const activeStatus = isLeasedStatus(status);
  const failedStatus = status === "blocked" && Boolean(item?.agentRunId || item?.claimedBy || item?.lastAgentUpdate);
  const claimedAtMs = timestamp(item?.claimedAt);
  const leaseExpiresAtMs = timestamp(item?.leaseExpiresAt);
  const lastActivityAt = latestAgentActivityAt(item);
  const lastActivityAtMs = timestamp(lastActivityAt);
  const activityAgeMinutes = lastActivityAtMs == null
    ? null
    : Math.max(0, Math.floor((evaluatedAtMs - lastActivityAtMs) / minuteMs));
  const freshnessState = activityAgeMinutes == null
    ? "missing"
    : activityAgeMinutes <= FRESH_ACTIVITY_MINUTES
      ? "fresh"
      : activityAgeMinutes <= STALE_ACTIVITY_MINUTES
        ? "aging"
        : "stale";
  const missingSignals = [];

  if (activeStatus) {
    if (!String(item?.claimedBy || "").trim()) missingSignals.push("claim owner");
    if (claimedAtMs == null) missingSignals.push("claim timestamp");
    if (!String(item?.agentRunId || "").trim()) missingSignals.push("run ID");
    if (leaseExpiresAtMs == null) missingSignals.push("lease");
    if (status === "in_progress" && !String(item?.githubBranch || item?.githubPrUrl || "").trim()) {
      missingSignals.push("branch or PR");
    }
  }

  const leaseActive = activeStatus && leaseExpiresAtMs != null && leaseExpiresAtMs > evaluatedAtMs;
  const leaseRemainingMs = leaseExpiresAtMs == null ? null : Math.max(0, leaseExpiresAtMs - evaluatedAtMs);
  const leaseTotalMs = claimedAtMs == null || leaseExpiresAtMs == null || leaseExpiresAtMs <= claimedAtMs
    ? null
    : leaseExpiresAtMs - claimedAtMs;
  const leasePercentRemaining = leaseRemainingMs == null || leaseTotalMs == null
    ? null
    : Math.max(0, Math.min(100, Math.round((leaseRemainingMs / leaseTotalMs) * 100)));
  const expiringWindowMs = Math.max(
    EXPIRING_LEASE_MINUTES * minuteMs,
    leaseTotalMs == null ? 0 : leaseTotalMs * EXPIRING_LEASE_RATIO,
  );
  const contextUrl = githubContextUrl(item);
  let state = "idle";
  let severity = "none";
  let label = "No active run";
  let summary = "This packet does not have an active or failed agent run.";

  if (failedStatus) {
    state = "failed";
    severity = "critical";
    label = "Failed run";
    summary = String(item?.blockedBy || item?.lastAgentUpdate?.note || "The agent run was blocked and needs an operator decision.").trim();
  } else if (activeStatus && missingSignals.length > 0) {
    state = "incomplete";
    severity = "high";
    label = "Incomplete context";
    summary = `Missing ${missingSignals.join(", ")}.`;
  } else if (activeStatus && (!leaseActive || freshnessState === "stale")) {
    state = "stale";
    severity = "high";
    label = "Stale run";
    summary = !leaseActive
      ? "The recorded lease has expired."
      : `No agent activity has been recorded for ${activityAgeMinutes} minutes.`;
  } else if (activeStatus && leaseRemainingMs <= expiringWindowMs) {
    state = "expiring";
    severity = "warning";
    label = "Lease expiring";
    summary = `The lease has ${Math.max(1, Math.ceil(leaseRemainingMs / minuteMs))} minutes remaining.`;
  } else if (activeStatus) {
    state = "healthy";
    severity = "success";
    label = "Healthy run";
    summary = "Claim, run context, lease, and recent activity are present.";
  }

  return {
    state,
    severity,
    label,
    summary,
    evaluatedAt,
    missingSignals,
    freshness: {
      state: freshnessState,
      lastActivityAt,
      ageMinutes: activityAgeMinutes,
    },
    lease: {
      active: leaseActive,
      expiresAt: item?.leaseExpiresAt || "",
      remainingMinutes: leaseRemainingMs == null ? null : Math.ceil(leaseRemainingMs / minuteMs),
      percentRemaining: leasePercentRemaining,
    },
    context: {
      runId: String(item?.agentRunId || "").trim(),
      claimedBy: String(item?.claimedBy || item?.agent || "").trim(),
      claimedAt: item?.claimedAt || "",
      leaseExpiresAt: item?.leaseExpiresAt || "",
      branch: String(item?.githubBranch || "").trim(),
      pullRequestUrl: String(item?.githubPrUrl || "").trim(),
      contextUrl,
      lastActivityAt,
    },
    actions: recoveryActions(state, contextUrl),
  };
}

import React, { useEffect, useMemo, useState } from "react";
import {
  buildAgentClaimCommand,
  buildAgentClaimPowerShellCommand,
  buildAgentPickupCommand,
  buildAgentPostMergeCloseoutPowerShellCommand,
  buildAgentPrReadyPowerShellCommand,
  buildAgentPrompt,
  buildAgentReviewPollPowerShellCommand,
  buildAgentRepoHandoffCommand,
  buildAgentRunbook,
  buildAgentStatusCommand,
  buildAgentStatusPowerShellCommand,
  buildAgentTokenBootstrapCommand,
  buildAgentVisualQaFallbackCommand,
  findNextWorkItem,
  readinessScore,
} from "./lib/agentPrompt.mjs";
import { labelOptions, priorityOptions, repositories, statusOptions, workItems as seedWorkItems } from "./data/workItems.mjs";
import {
  claimWorkItem as claimWorkItemRequest,
  createBackup as createBackupRequest,
  createGithubIssue as createGithubIssueRequest,
  createWorkItem as createWorkItemRequest,
  fetchBackups,
  fetchWorkItems,
  fetchGithubSync,
  fetchSession,
  fetchSystemStatus,
  importGithubIssues as importGithubIssuesRequest,
  linkAllGithubWorkItems,
  linkGithubWorkItem,
  login as loginRequest,
  logout as logoutRequest,
  restoreBackup as restoreBackupRequest,
  resetWorkItems as resetWorkItemsRequest,
  syncGithub,
  updateWorkItem,
} from "./lib/manageApi.mjs";

const navItems = [
  { id: "today", label: "Today", icon: "dashboard" },
  { id: "backlog", label: "Backlog", icon: "queue" },
  { id: "repos", label: "Repos", icon: "repo" },
  { id: "agents", label: "Agents", icon: "agent" },
  { id: "review", label: "Review", icon: "review" },
];

const viewCopy = {
  today: {
    eyebrow: "Console",
    title: "Today",
    description: "Start with the next packet, current backlog pressure, and active agent work.",
  },
  backlog: {
    eyebrow: "Workspace",
    title: "AI-ready backlog",
    description: "Create work packets that coding agents can pick up without another context handoff.",
  },
  repos: {
    eyebrow: "Operations",
    title: "Repository health",
    description: "Review GitHub sync state, repo activity, and backlog snapshots across the app family.",
  },
  agents: {
    eyebrow: "Operations",
    title: "Agent activity",
    description: "Track active claims, leases, and recent handoffs before starting more work.",
  },
  review: {
    eyebrow: "Workspace",
    title: "Review queue",
    description: "Inspect packets that agents have written back for reviewer sign-off.",
  },
};

const themeOptions = ["light", "dark"];
const densityOptions = [
  { id: "compact", label: "Compact" },
  { id: "regular", label: "Regular" },
  { id: "comfortable", label: "Comfortable" },
];

function readShellPreference(key, fallback, allowedValues) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const value = window.sessionStorage?.getItem(key);
    return allowedValues.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeShellPreference(key, value) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage?.setItem(key, value);
  } catch {
    // Session storage can be unavailable in locked-down browser contexts.
  }
}

const repoOptions = repositories.map((repo) => repo.id);
const agentSecretConfig = {
  secretName: "MANAGE_AUTH_TOKEN",
};

const packetTemplates = [
  {
    id: "web-bug",
    label: "Web app bug fix",
    title: "Fix a web app bug with regression coverage",
    repo: "web-app",
    priority: "high",
    project: "Web app",
    agent: "Codex",
    labels: "bug, ui",
    summary: "A web app behavior is broken or inconsistent and needs a focused fix with a regression test.",
    desiredOutcome: "The behavior is correct, covered by a test, and easy for the reviewer to validate.",
    acceptanceCriteria:
      "The failing behavior is reproduced and covered by a regression test.\nThe UI reports a clear success or error state.\nExisting tests and build still pass.",
    relevantFiles: "web-app/src/components\nweb-app/src/lib",
    relevantUrls: "https://github.com/your-org/web-app",
    implementationNotes:
      "Keep the change local to the affected component.\nPrefer shared helpers when logic is reused.",
    testCommands: "npm test\nnpm run build",
    deployNotes: "Deploy with the next web-app batch after tests pass.",
  },
  {
    id: "api-validation",
    label: "API hardening",
    title: "Harden an API endpoint",
    repo: "api-service",
    priority: "high",
    project: "API",
    agent: "Codex",
    labels: "api, auth",
    summary: "An API endpoint needs a scoped validation or auth hardening pass.",
    desiredOutcome: "The endpoint validates input, handles the expected auth state, and has a clear verification path.",
    acceptanceCriteria:
      "The target behavior is covered by a test.\nUnauthorized or invalid requests return the expected response.\nThe API build still passes.",
    relevantFiles: "api-service/src/routes\napi-service/src/middleware",
    relevantUrls: "https://github.com/your-org/api-service",
    implementationNotes: "Reuse existing auth/validation helpers instead of inventing a second path.",
    testCommands: "npm test\nnpm run build",
    deployNotes: "Deploy after API tests pass.",
  },
  {
    id: "docs-smoke",
    label: "Docs smoke coverage",
    title: "Backfill docs smoke coverage",
    repo: "docs-site",
    priority: "medium",
    project: "Docs",
    agent: "Codex",
    labels: "smoke-test, docs",
    summary: "A docs route needs clearer smoke coverage so regressions are caught before deploy.",
    desiredOutcome: "The docs route has an explicit expected state and a repeatable smoke check.",
    acceptanceCriteria:
      "Smoke coverage asserts the expected route status.\nFailure output identifies route or data issues.\nExisting docs tests still pass.",
    relevantFiles: "docs-site/src\ndocs-site/tests",
    relevantUrls: "https://github.com/your-org/docs-site",
    implementationNotes: "Record the expected route behavior in the packet before agent pickup.",
    testCommands: "npm test",
    deployNotes: "Run docs smoke after deploy.",
  },
  {
    id: "worker-visibility",
    label: "Worker check visibility",
    title: "Surface a failed worker check",
    repo: "worker-service",
    priority: "medium",
    project: "Workers",
    agent: "Codex",
    labels: "ci, github-sync",
    summary: "A failed worker job or check needs a focused cleanup or visibility pass.",
    desiredOutcome: "Worker state is easier to triage and has a clear reviewer handoff.",
    acceptanceCriteria:
      "The relevant failed check or job state is visible.\nThe agent handoff includes branch, PR, or run context.\nWorker tests or build still pass.",
    relevantFiles: "worker-service/src\nworker-service/jobs",
    relevantUrls: "https://github.com/your-org/worker-service/actions",
    implementationNotes: "Avoid broad refactors; keep the packet scoped to the failed check.",
    testCommands: "npm test\nnpm run build",
    deployNotes: "No deploy dependency unless worker source changes.",
  },
  {
    id: "data-export",
    label: "Data export refresh",
    title: "Refresh analytics export job",
    repo: "data-pipeline",
    priority: "medium",
    project: "Data",
    agent: "Claude Code",
    labels: "template, reporting",
    summary: "An export, dataset, or report QA flow needs a structured refresh.",
    desiredOutcome: "The export/report update is reproducible and includes source, generated artifact, and validation context.",
    acceptanceCriteria:
      "Source data, builder script, generated artifact, and validation command are recorded.\nThe generated report or QA output is checked.\nData tests or build still pass.",
    relevantFiles: "data-pipeline/scripts/export.py\ndata-pipeline/src/report-qa.js",
    relevantUrls: "https://github.com/your-org/data-pipeline",
    implementationNotes: "Separate data refresh work from UI changes in the final agent note.",
    testCommands: "npm test\nnpm run build",
    deployNotes: "Follows the normal static build path.",
  },
  {
    id: "marketing-page",
    label: "Marketing page polish",
    title: "Polish a marketing page or lead capture path",
    repo: "marketing-site",
    priority: "medium",
    project: "Marketing",
    agent: "Codex",
    labels: "ui",
    summary: "A marketing site flow needs a focused implementation or hardening pass.",
    desiredOutcome: "The page is clear to verify and safe to ship.",
    acceptanceCriteria:
      "The target route or component has a clear expected state.\nLead capture behavior is covered where practical.\nThe site build still passes.",
    relevantFiles: "marketing-site/src\nmarketing-site/app",
    relevantUrls: "https://github.com/your-org/marketing-site",
    implementationNotes: "Keep the change scoped to the named route or form path.",
    testCommands: "npm test\nnpm run build",
    deployNotes: "Deploy with the next marketing batch after build passes.",
  },
];

function formatStatus(statusId) {
  return statusOptions.find((status) => status.id === statusId)?.label || statusId;
}

function formatPriority(priorityId) {
  return priorityOptions.find((priority) => priority.id === priorityId)?.label || priorityId;
}

function normalizeLabel(value) {
  return String(value || "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function itemLabels(item) {
  const labels = Array.isArray(item?.labels) ? item.labels : String(item?.labels || "").split(/[,\n]/);
  return [...new Set(labels.map(normalizeLabel).filter(Boolean))];
}

function labelsToText(value) {
  return itemLabels({ labels: value }).join(", ");
}

function formatLabel(labelId) {
  return labelOptions.find((label) => label.id === labelId)?.label || labelId;
}

function getStatusTone(statusId) {
  return statusOptions.find((status) => status.id === statusId)?.tone || "muted";
}

function getRepo(repoId) {
  return repositories.find((repo) => repo.id === repoId);
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

function formatRelativeTime(value) {
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

function linesFromValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasStructuredAgentUpdate(update) {
  return ["githubBranch", "githubPrUrl", "testsRun", "filesChanged", "blockers", "nextSteps"].some((field) => {
    const value = update?.[field];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
}

function formatEventType(type) {
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

  return type || "Event";
}

function formatAgentEventLabel(event) {
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

  return formatEventType(event?.type);
}

function buildActivityFeed(items, limit = 5) {
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

function activityTone(type, status) {
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

function activityIcon(type, status) {
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

function leaseProgress(item) {
  const claimedAt = Date.parse(item?.claimedAt || "");
  const expiresAt = Date.parse(item?.leaseExpiresAt || "");

  if (!Number.isFinite(claimedAt) || !Number.isFinite(expiresAt) || expiresAt <= claimedAt) {
    return null;
  }

  const remaining = Math.max(0, expiresAt - Date.now());
  const total = expiresAt - claimedAt;
  return Math.max(0, Math.min(100, Math.round((remaining / total) * 100)));
}

function repoHealthStatus(repo) {
  if (repo.health === "ready") {
    return "ready_for_agent";
  }

  if (repo.health === "blocked") {
    return "blocked";
  }

  return "needs_review";
}

function buildMiniRepoHealth(githubCache) {
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

function isLeaseActive(item) {
  if (!item?.leaseExpiresAt) {
    return false;
  }

  const expiresAt = Date.parse(item.leaseExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function isAgentWorkInMotion(item) {
  return item?.status === "claimed" || item?.status === "in_progress";
}

function leaseSummary(item) {
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

function githubMatchCount(item) {
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

function manageOrigin() {
  return typeof window === "undefined" ? "http://127.0.0.1:5186" : window.location.origin;
}

function agentTaskMarkdownUrl(item) {
  return `${manageOrigin()}/agent/${encodeURIComponent(item.key)}.md`;
}

function agentTaskJsonUrl(item) {
  return `${manageOrigin()}/api/agent/tasks/${encodeURIComponent(item.key)}`;
}

function tokenHintForMode(mode) {
  return mode === "local" ? "manage-local" : "$MANAGE_AUTH_TOKEN";
}

function formatStorageKind(kind) {
  if (kind === "firestore") {
    return "Firestore";
  }

  if (kind === "file") {
    return "File store";
  }

  return kind || "Unknown";
}

function formatProviderState(enabled, label) {
  return enabled ? `${label} on` : `${label} off`;
}

function authErrorFromUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  const message = new URLSearchParams(window.location.search).get("auth_error");
  return message ? decodeURIComponent(message) : "";
}

export default function App() {
  const [sessionState, setSessionState] = useState("checking");
  const [sessionMode, setSessionMode] = useState("local");
  const [sessionInfo, setSessionInfo] = useState(null);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let canceled = false;

    async function loadSession() {
      try {
        const session = await fetchSession();

        if (!canceled) {
          setSessionState(session.authenticated ? "authenticated" : "anonymous");
          setSessionMode(session.mode || "local");
          setSessionInfo(session);
          setAuthError(session.authenticated ? "" : authErrorFromUrl());
        }
      } catch (error) {
        if (!canceled) {
          setAuthError(error.message);
          setSessionState("anonymous");
        }
      }
    }

    loadSession();

    return () => {
      canceled = true;
    };
  }, []);

  async function handleLogin(token) {
    setAuthError("");

    try {
      await loginRequest(token);
      const session = await fetchSession();
      setSessionInfo(session);
      setSessionState("authenticated");
      setSessionMode(session.mode || (token === "manage-local" ? "local" : "configured"));
    } catch (error) {
      setAuthError(error.message);
      setSessionState("anonymous");
    }
  }

  async function handleLogout() {
    await logoutRequest().catch(() => undefined);
    setSessionInfo((current) => ({
      ...current,
      authenticated: false,
      user: null,
    }));
    setSessionState("anonymous");
  }

  if (sessionState === "checking") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand-mark">A</div>
          <h1>Agent Backlog</h1>
          <p>Checking access...</p>
        </div>
      </div>
    );
  }

  if (sessionState !== "authenticated") {
    return <LoginScreen error={authError} onLogin={handleLogin} sessionInfo={sessionInfo} />;
  }

  return <ManageApp onLogout={handleLogout} sessionMode={sessionMode} sessionUser={sessionInfo?.user} />;
}

function ManageApp({ onLogout, sessionMode, sessionUser }) {
  const [activeNav, setActiveNav] = useState("backlog");
  const [items, setItems] = useState(seedWorkItems);
  const [selectedKey, setSelectedKey] = useState("TASK-101");
  const [repoFilter, setRepoFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [labelFilter, setLabelFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [copyState, setCopyState] = useState("idle");
  const [copyMessage, setCopyMessage] = useState("");
  const [loadState, setLoadState] = useState("loading");
  const [syncState, setSyncState] = useState("synced");
  const [syncMessage, setSyncMessage] = useState("Store synced");
  const [githubCache, setGithubCache] = useState(null);
  const [githubState, setGithubState] = useState("idle");
  const [githubMessage, setGithubMessage] = useState("GitHub cache not synced");
  const [claimState, setClaimState] = useState("idle");
  const [linkState, setLinkState] = useState("idle");
  const [issueState, setIssueState] = useState("idle");
  const [issueImportState, setIssueImportState] = useState("idle");
  const [systemStatus, setSystemStatus] = useState(null);
  const [systemState, setSystemState] = useState("loading");
  const [systemMessage, setSystemMessage] = useState("Checking system");
  const [backups, setBackups] = useState([]);
  const [backupState, setBackupState] = useState("loading");
  const [backupMessage, setBackupMessage] = useState("Checking backups");
  const [themeMode, setThemeMode] = useState(() => readShellPreference("manage-theme", "light", themeOptions));
  const [densityMode, setDensityMode] = useState(() =>
    readShellPreference(
      "manage-density",
      "regular",
      densityOptions.map((option) => option.id),
    ),
  );

  useEffect(() => {
    let canceled = false;

    async function loadInitialData() {
      try {
        const [workPayload, githubPayload, backupPayload] = await Promise.all([fetchWorkItems(), fetchGithubSync(), fetchBackups()]);

        if (!canceled) {
          setItems(workPayload.workItems);
          setGithubCache(githubPayload.github);
          setBackups(backupPayload.backups || []);
          setGithubMessage(githubPayload.github?.source === "gh" ? "GitHub live cache" : "GitHub cache ready");
          setBackupState("idle");
          setBackupMessage((backupPayload.backups || []).length > 0 ? "Backups ready" : "No snapshots yet");
          setLoadState("ready");
          setSyncState("synced");
          setSyncMessage("Store synced");
        }
      } catch (error) {
        if (!canceled) {
          setLoadState("ready");
          setSyncState("failed");
          setBackupState("failed");
          setSyncMessage(error.message);
          setBackupMessage(error.message);
        }
      }
    }

    loadInitialData();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    refreshSystemStatus();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.dataset.manageTheme = themeMode;
    writeShellPreference("manage-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.dataset.density = densityMode;
    document.documentElement.dataset.manageDensity = densityMode;
    writeShellPreference("manage-density", densityMode);
  }, [densityMode]);

  useEffect(() => {
    if (items.length > 0 && !items.some((item) => item.key === selectedKey)) {
      setSelectedKey(items[0].key);
    }
  }, [items, selectedKey]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return items
      .filter((item) => (repoFilter === "all" ? true : item.repo === repoFilter))
      .filter((item) => (statusFilter === "all" ? true : item.status === statusFilter))
      .filter((item) => (labelFilter === "all" ? true : itemLabels(item).includes(labelFilter)))
      .filter((item) => {
        if (!normalizedQuery) {
          return true;
        }

        return `${item.key} ${item.title} ${item.project} ${item.repo} ${item.summary} ${itemLabels(item).join(" ")}`
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) => {
        const priorityA = priorityOptions.find((priority) => priority.id === a.priority)?.rank || 99;
        const priorityB = priorityOptions.find((priority) => priority.id === b.priority)?.rank || 99;

        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }

        return readinessScore(b) - readinessScore(a);
      });
  }, [items, query, repoFilter, statusFilter, labelFilter]);

  const availableLabels = useMemo(() => {
    const labels = new Set(labelOptions.map((label) => label.id));

    for (const item of items) {
      for (const label of itemLabels(item)) {
        labels.add(label);
      }
    }

    return [...labels].sort((a, b) => formatLabel(a).localeCompare(formatLabel(b)));
  }, [items]);

  const selectedItem = useMemo(() => {
    return items.find((item) => item.key === selectedKey) || filteredItems[0] || items[0];
  }, [filteredItems, items, selectedKey]);
  const selectedRepository = useMemo(() => getRepo(selectedItem.repo), [selectedItem.repo]);
  const selectedRepoSlug = useMemo(
    () => `${selectedRepository?.owner || "your-org"}/${selectedRepository?.name || selectedItem.repo || "repo"}`,
    [selectedItem.repo, selectedRepository],
  );

  const selectedPrompt = useMemo(() => buildAgentPrompt(selectedItem), [selectedItem]);
  const selectedTaskUrl = useMemo(() => agentTaskMarkdownUrl(selectedItem), [selectedItem]);
  const selectedTaskJsonUrl = useMemo(() => agentTaskJsonUrl(selectedItem), [selectedItem]);
  const agentCommandContext = useMemo(
    () => ({
      baseUrl: manageOrigin(),
      repo: selectedItem.repo,
      repository: selectedRepository,
      tokenHint: tokenHintForMode(sessionMode),
      ...agentSecretConfig,
    }),
    [selectedItem.repo, selectedRepository, sessionMode],
  );
  const tokenBootstrapCommand = useMemo(() => buildAgentTokenBootstrapCommand(agentSecretConfig), []);
  const codexPickupCommand = useMemo(
    () => buildAgentPickupCommand({ ...agentCommandContext, agent: "Codex" }),
    [agentCommandContext],
  );
  const claudePickupCommand = useMemo(
    () => buildAgentPickupCommand({ ...agentCommandContext, agent: "Claude Code" }),
    [agentCommandContext],
  );
  const claimCommand = useMemo(
    () =>
      buildAgentClaimCommand({
        baseUrl: agentCommandContext.baseUrl,
        workItem: selectedItem,
        agent: selectedItem.agent || "Codex",
        tokenHint: agentCommandContext.tokenHint,
      }),
    [agentCommandContext.baseUrl, agentCommandContext.tokenHint, selectedItem],
  );
  const claimPowerShellCommand = useMemo(
    () =>
      buildAgentClaimPowerShellCommand({
        ...agentCommandContext,
        workItem: selectedItem,
        agent: selectedItem.agent || "Codex",
      }),
    [agentCommandContext, selectedItem],
  );
  const progressCommand = useMemo(
    () =>
      buildAgentStatusCommand({
        baseUrl: agentCommandContext.baseUrl,
        workItem: selectedItem,
        agent: selectedItem.agent || "Codex",
        tokenHint: agentCommandContext.tokenHint,
        status: "in_progress",
      }),
    [agentCommandContext.baseUrl, agentCommandContext.tokenHint, selectedItem],
  );
  const progressPowerShellCommand = useMemo(
    () =>
      buildAgentStatusPowerShellCommand({
        ...agentCommandContext,
        workItem: selectedItem,
        agent: selectedItem.agent || "Codex",
        status: "in_progress",
      }),
    [agentCommandContext, selectedItem],
  );
  const reviewCommand = useMemo(
    () =>
      buildAgentStatusCommand({
        baseUrl: agentCommandContext.baseUrl,
        workItem: selectedItem,
        agent: selectedItem.agent || "Codex",
        tokenHint: agentCommandContext.tokenHint,
        status: "needs_review",
      }),
    [agentCommandContext.baseUrl, agentCommandContext.tokenHint, selectedItem],
  );
  const reviewPowerShellCommand = useMemo(
    () =>
      buildAgentStatusPowerShellCommand({
        ...agentCommandContext,
        workItem: selectedItem,
        agent: selectedItem.agent || "Codex",
        status: "needs_review",
      }),
    [agentCommandContext, selectedItem],
  );
  const donePowerShellCommand = useMemo(
    () =>
      buildAgentStatusPowerShellCommand({
        ...agentCommandContext,
        workItem: selectedItem,
        agent: selectedItem.agent || "Codex",
        status: "done",
      }),
    [agentCommandContext, selectedItem],
  );
  const prReadyPowerShellCommand = useMemo(
    () => buildAgentPrReadyPowerShellCommand({ workItem: selectedItem, repository: selectedRepository }),
    [selectedItem, selectedRepository],
  );
  const reviewPollPowerShellCommand = useMemo(
    () => buildAgentReviewPollPowerShellCommand({ workItem: selectedItem, repository: selectedRepository }),
    [selectedItem, selectedRepository],
  );
  const visualQaFallbackCommand = useMemo(() => buildAgentVisualQaFallbackCommand(), []);
  const postMergeCloseoutCommand = useMemo(
    () =>
      buildAgentPostMergeCloseoutPowerShellCommand({
        ...agentCommandContext,
        workItem: selectedItem,
        agent: selectedItem.agent || "Codex",
        repository: selectedRepository,
      }),
    [agentCommandContext, selectedItem, selectedRepository],
  );
  const repoHandoffCommand = useMemo(
    () => buildAgentRepoHandoffCommand({ workItem: selectedItem, repository: selectedRepository }),
    [selectedItem, selectedRepository],
  );
  const agentRunbook = useMemo(
    () =>
      buildAgentRunbook({
        ...agentCommandContext,
        workItem: selectedItem,
        agent: selectedItem.agent || "Codex",
      }),
    [agentCommandContext, selectedItem],
  );
  const nextItem = useMemo(
    () =>
      findNextWorkItem(items, {
        ...(repoFilter === "all" ? {} : { repo: repoFilter }),
        ...(labelFilter === "all" ? {} : { label: labelFilter }),
      }),
    [items, repoFilter, labelFilter],
  );

  const stats = useMemo(() => {
    const totalCount = items.length;
    const readyCount = items.filter((item) => item.status === "ready_for_agent").length;
    const inProgressCount = items.filter((item) => item.status === "claimed" || item.status === "in_progress").length;
    const reviewCount = items.filter((item) => item.status === "needs_review").length;
    const blockedCount = items.filter((item) => item.status === "blocked").length;
    const avgReadiness = items.length > 0 ? Math.round(items.reduce((sum, item) => sum + readinessScore(item), 0) / items.length) : 0;

    return { totalCount, readyCount, inProgressCount, reviewCount, blockedCount, avgReadiness };
  }, [items]);

  const activeClaims = useMemo(() => items.filter(isAgentWorkInMotion), [items]);

  const repoAlertCount = useMemo(() => {
    const githubByRepo = new Map((githubCache?.repos || []).map((repo) => [repo.id, repo]));

    return repositories.filter((repo) => {
      const syncedRepo = githubByRepo.get(repo.id);
      const failedRuns = syncedRepo?.failedRuns ?? repo.failedRuns ?? 0;
      return failedRuns > 0 || repo.health === "blocked";
    }).length;
  }, [githubCache]);

  const navCounts = useMemo(
    () => ({
      backlog: stats.totalCount,
      repos: repoAlertCount || null,
      agents: activeClaims.length || null,
      review: stats.reviewCount || null,
    }),
    [activeClaims.length, repoAlertCount, stats.reviewCount, stats.totalCount],
  );
  const recentAgentActivity = useMemo(() => buildActivityFeed(items, 5), [items]);
  const miniRepoHealth = useMemo(() => buildMiniRepoHealth(githubCache), [githubCache]);
  const currentView = viewCopy[activeNav] || viewCopy.backlog;
  const showWorkbench = activeNav === "backlog";
  const reviewItems = useMemo(() => items.filter((item) => item.status === "needs_review"), [items]);
  const nextThemeMode = themeMode === "dark" ? "light" : "dark";

  function selectNav(navId) {
    setActiveNav(navId);

    if (navId === "review") {
      setStatusFilter("needs_review");
      setRepoFilter("all");
      setLabelFilter("all");
      const firstReviewItem = items.find((item) => item.status === "needs_review");

      if (firstReviewItem) {
        setSelectedKey(firstReviewItem.key);
      }
    }

    if (navId === "backlog") {
      setStatusFilter("all");
      setLabelFilter("all");
    }
  }

  function openPacket(key) {
    if (!key) {
      return;
    }

    setSelectedKey(key);
    setActiveNav("backlog");
  }

  function replaceWorkItem(workItem) {
    setItems((currentItems) => currentItems.map((item) => (item.key === workItem.key ? workItem : item)));
    setSelectedKey(workItem.key);
  }

  async function refreshSystemStatus() {
    setSystemState("loading");
    setSystemMessage("Checking system");

    try {
      const payload = await fetchSystemStatus();
      setSystemStatus(payload);
      setSystemState("ready");
      setSystemMessage("System status current");
    } catch (error) {
      setSystemState("failed");
      setSystemMessage(error.message);
    }
  }

  async function refreshBackups() {
    setBackupState("loading");
    setBackupMessage("Checking backups");

    try {
      const payload = await fetchBackups();
      setBackups(payload.backups || []);
      setBackupState("idle");
      setBackupMessage((payload.backups || []).length > 0 ? "Backups ready" : "No snapshots yet");
    } catch (error) {
      setBackupState("failed");
      setBackupMessage(error.message);
    }
  }

  async function createBackupNow() {
    setBackupState("saving");
    setBackupMessage("Creating snapshot");

    try {
      const payload = await createBackupRequest({ reason: "manual" });
      setBackups(payload.backups || []);
      setBackupState("idle");
      setBackupMessage(`Snapshot saved ${payload.snapshot.id}`);
      await refreshSystemStatus();
    } catch (error) {
      setBackupState("failed");
      setBackupMessage(error.message);
    }
  }

  async function restoreBackupSnapshot(snapshot) {
    const shouldRestore = window.confirm(`Restore Manage from backup ${snapshot.id}? Current state will be snapshotted first.`);

    if (!shouldRestore) {
      return;
    }

    setBackupState("restoring");
    setBackupMessage(`Restoring ${snapshot.id}`);

    try {
      const payload = await restoreBackupRequest(snapshot.id);
      setItems(payload.workItems);
      setGithubCache(payload.github);
      setBackups(payload.backups || []);

      if (payload.workItems.length > 0) {
        setSelectedKey(payload.workItems[0].key);
      }

      setBackupState("idle");
      setBackupMessage(`Restored ${payload.restored.join(", ")}`);
      setSyncState("synced");
      setSyncMessage("Store restored");
      await refreshSystemStatus();
    } catch (error) {
      setBackupState("failed");
      setBackupMessage(error.message);
    }
  }

  async function updatePacket(key, updates) {
    const targetItem = items.find((item) => item.key === key);

    if (!targetItem) {
      return false;
    }

    const previousItems = items;
    const optimisticItem = { ...targetItem, ...updates, updatedAt: new Date().toISOString() };

    setItems((currentItems) => currentItems.map((item) => (item.key === key ? optimisticItem : item)));
    setSyncState("saving");
    setSyncMessage("Saving store");

    try {
      const payload = await updateWorkItem(key, updates);
      setItems(payload.workItems);
      setSyncState("synced");
      setSyncMessage("Store synced");
      return true;
    } catch (error) {
      setItems(previousItems);
      setSyncState("failed");
      setSyncMessage(error.message);
      return false;
    }
  }

  async function updateSelected(updates) {
    return updatePacket(selectedItem.key, updates);
  }

  async function claimPacket(item) {
    if (!item) {
      return;
    }

    setClaimState("claiming");
    setSyncState("saving");
    setSyncMessage("Claiming work packet");

    try {
      const payload = await claimWorkItemRequest(item.key, {
        agent: item.agent || "Codex",
        leaseMinutes: 90,
      });
      replaceWorkItem(payload.workItem);
      setClaimState("idle");
      setSyncState("synced");
      setSyncMessage(`Claimed ${payload.workItem.key}`);
    } catch (error) {
      setClaimState("failed");
      setSyncState("failed");
      setSyncMessage(error.message);
    }
  }

  async function claimSelected() {
    await claimPacket(selectedItem);
  }

  async function linkSelectedGithub() {
    setLinkState("linking");
    setGithubState("syncing");
    setGithubMessage(`Linking GitHub activity for ${selectedItem.key}`);

    try {
      const payload = await linkGithubWorkItem(selectedItem.key);
      setItems(payload.workItems);
      setSelectedKey(payload.workItem.key);
      setLinkState("idle");
      setGithubState("idle");
      setGithubMessage(
        githubMatchCount(payload.workItem) > 0
          ? `Linked ${githubMatchCount(payload.workItem)} GitHub matches for ${payload.workItem.key}`
          : `No GitHub matches found for ${payload.workItem.key}`,
      );
    } catch (error) {
      setLinkState("failed");
      setGithubState("failed");
      setGithubMessage(error.message);
    }
  }

  async function createSelectedGithubIssue() {
    setIssueState("creating");
    setGithubState("syncing");
    setGithubMessage(`Creating GitHub issue for ${selectedItem.key}`);

    try {
      const payload = await createGithubIssueRequest(selectedItem.key);
      setItems(payload.workItems);
      setSelectedKey(payload.workItem.key);
      setIssueState("idle");
      setGithubState("idle");
      setGithubMessage(
        payload.created
          ? `Created GitHub issue #${payload.issue.number} for ${payload.workItem.key}`
          : `GitHub issue already linked for ${payload.workItem.key}`,
      );
    } catch (error) {
      setIssueState("failed");
      setGithubState("failed");
      setGithubMessage(error.message);
    }
  }

  async function copyText(value, message) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
      setCopyMessage(message);
      window.setTimeout(() => setCopyState("idle"), 1400);
    } catch {
      setCopyState("failed");
      setCopyMessage("");
      window.setTimeout(() => setCopyState("idle"), 1400);
    }
  }

  function copyPrompt() {
    return copyText(selectedPrompt, "Prompt copied");
  }

  async function createWorkItem(payload) {
    setSyncState("saving");
    setSyncMessage("Creating work packet");

    try {
      const result = await createWorkItemRequest(payload);
      setItems(result.workItems);
      setSelectedKey(result.workItem.key);
      setShowComposer(false);
      setSyncState("synced");
      setSyncMessage("Store synced");
    } catch (error) {
      setSyncState("failed");
      setSyncMessage(error.message);
    }
  }

  async function duplicateSelected() {
    setSyncState("saving");
    setSyncMessage("Duplicating work packet");

    try {
      const result = await createWorkItemRequest({
        ...selectedItem,
        title: `Copy of ${selectedItem.title}`,
        status: "draft",
        ready: false,
        branch: "",
        githubBranch: "",
        githubPrUrl: "",
        githubIssueUrl: "",
        githubIssueNumber: null,
        githubIssueTitle: "",
        claimedBy: "",
        claimedAt: "",
        agentRunId: "",
        leaseExpiresAt: "",
        lastAgentUpdate: null,
      });
      setItems(result.workItems);
      setSelectedKey(result.workItem.key);
      setSyncState("synced");
      setSyncMessage(`Duplicated ${selectedItem.key} as ${result.workItem.key}`);
    } catch (error) {
      setSyncState("failed");
      setSyncMessage(error.message);
    }
  }

  async function resetStore() {
    setSyncState("saving");
    setSyncMessage("Resetting store");

    try {
      const payload = await resetWorkItemsRequest();
      setItems(payload.workItems);
      setSelectedKey("TASK-101");
      setSyncState("synced");
      setSyncMessage("Seed backlog restored");
    } catch (error) {
      setSyncState("failed");
      setSyncMessage(error.message);
    }
  }

  async function runGithubSync({ mock = false } = {}) {
    setGithubState("syncing");
    setGithubMessage(mock ? "Refreshing mock GitHub cache" : "Syncing GitHub with gh");

    try {
      const payload = await syncGithub({ mock });
      setGithubCache(payload.github);
      setGithubState("idle");
      setGithubMessage(payload.github.source === "gh" ? "GitHub sync complete" : "Mock GitHub cache refreshed");
    } catch (error) {
      setGithubState("failed");
      setGithubMessage(error.message);
    }
  }

  async function linkAllGithub() {
    setLinkState("linking");
    setGithubState("syncing");
    setGithubMessage("Linking work packets from GitHub cache");

    try {
      const payload = await linkAllGithubWorkItems();
      setItems(payload.workItems);
      setLinkState("idle");
      setGithubState("idle");
      setGithubMessage(
        payload.linked.length > 0
          ? `Linked ${payload.linked.length} work packets from GitHub cache`
          : "No work packets matched cached GitHub activity",
      );
    } catch (error) {
      setLinkState("failed");
      setGithubState("failed");
      setGithubMessage(error.message);
    }
  }

  async function importGithubIssuesFromCache() {
    setIssueImportState("importing");
    setGithubState("syncing");
    setGithubMessage("Importing GitHub issues from cache");

    try {
      const payload = await importGithubIssuesRequest();
      setItems(payload.workItems);

      if (payload.imported.length > 0) {
        setSelectedKey(payload.imported[0].key);
      }

      setIssueImportState("idle");
      setGithubState("idle");
      setGithubMessage(
        payload.imported.length > 0
          ? `Imported ${payload.imported.length} GitHub issues as draft packets`
          : "No new GitHub issues to import",
      );
    } catch (error) {
      setIssueImportState("failed");
      setGithubState("failed");
      setGithubMessage(error.message);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand-name">Agent Backlog</div>
            <div className="brand-domain">localhost:5186</div>
          </div>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`nav-button ${activeNav === item.id ? "is-active" : ""}`}
              aria-label={item.label}
              onClick={() => selectNav(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {navCounts[item.id] ? <span className="nav-count">{navCounts[item.id]}</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="footer-label">Next ready packet</div>
          <button type="button" className="next-packet" onClick={() => openPacket(nextItem?.key)} disabled={!nextItem}>
            <span>{nextItem?.key || "None"}</span>
            <small>{nextItem ? `${nextItem.repo} / ${nextItem.title}` : "No ready item"}</small>
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{currentView.eyebrow}</span>
            <h1>{currentView.title}</h1>
            <p>{currentView.description}</p>
          </div>
          <div className="topbar-actions">
            <button type="button" className="button primary" onClick={() => setShowComposer(true)}>
              <Icon name="plus" />
              New packet
            </button>
            <div className="topbar-secondary-actions">
              <label className="shell-control">
                <span>Density</span>
                <select
                  aria-label="Density"
                  value={densityMode}
                  onChange={(event) => setDensityMode(event.target.value)}
                >
                  {densityOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button secondary shell-toggle"
                onClick={() => setThemeMode(nextThemeMode)}
                aria-label={`Switch to ${nextThemeMode} theme`}
              >
                <Icon name={themeMode === "dark" ? "sun" : "moon"} />
                {themeMode === "dark" ? "Light" : "Dark"}
              </button>
              <div className="session-chip" title={sessionUser?.login || sessionMode}>
                {sessionMode === "github" ? `GitHub: ${sessionUser?.login || "signed in"}` : "Token session"}
              </div>
              <div className={`sync-chip sync-${syncState}`} title={syncMessage}>
                {loadState === "loading" ? "Loading store" : syncMessage}
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={resetStore}
              >
                Reset store
              </button>
              <button type="button" className="button secondary" onClick={onLogout}>
                Sign out
              </button>
            </div>
          </div>
        </header>

        {activeNav === "today" ? (
          <TodayOverview
            stats={stats}
            nextItem={nextItem}
            activity={recentAgentActivity}
            repoHealthRows={miniRepoHealth}
            onOpenPacket={openPacket}
            onClaimPacket={claimPacket}
            claimState={claimState}
            onNavigate={selectNav}
          />
        ) : null}

        {showWorkbench ? (
          <>
            <section className="metric-strip" aria-label="Backlog metrics">
              <Metric label="Ready for agent" value={stats.readyCount} tone="ready" />
              <Metric label="In progress" value={stats.inProgressCount} tone="info" />
              <Metric label="Needs review" value={stats.reviewCount} tone="review" />
              <Metric label="Blocked" value={stats.blockedCount} tone="blocked" />
            </section>

            <SystemStatusPanel
              systemStatus={systemStatus}
              systemState={systemState}
              systemMessage={systemMessage}
              onRefresh={refreshSystemStatus}
            />

            <section className="content-grid">
          <section className="backlog-panel" aria-label="Backlog">
            <div className="panel-header">
              <div>
                <h2>Backlog</h2>
                <p>{filteredItems.length} work packets across {repositories.length} repos</p>
              </div>
              <div className="filters">
                <label>
                  <span>Repo</span>
                  <select value={repoFilter} onChange={(event) => setRepoFilter(event.target.value)}>
                    <option value="all">All repos</option>
                    {repoOptions.map((repo) => (
                      <option key={repo} value={repo}>
                        {repo}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="all">All statuses</option>
                    {statusOptions.map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Label</span>
                  <select value={labelFilter} onChange={(event) => setLabelFilter(event.target.value)}>
                    <option value="all">All labels</option>
                    {availableLabels.map((label) => (
                      <option key={label} value={label}>
                        {formatLabel(label)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <label className="search-box">
              <Icon name="search" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search packets, labels, projects, repos..."
              />
            </label>

            <div className="work-list">
              {filteredItems.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={`work-row ${selectedItem.key === item.key ? "is-selected" : ""}`}
                  onClick={() => setSelectedKey(item.key)}
                >
                  <div className="row-main">
                    <div className="row-title">
                      <span className="work-key">{item.key}</span>
                      <span className="row-title-text">{item.title}</span>
                    </div>
                    <div className="row-meta">
                      <PriorityFlag priority={item.priority} />
                      <span>{item.repo}</span>
                      <span>{formatRelativeTime(item.updatedAt)}</span>
                    </div>
                    <LabelList labels={itemLabels(item)} compact />
                  </div>
                  <div className="row-side">
                    <StatusPill status={item.status} />
                    <Readiness value={readinessScore(item)} />
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="detail-panel" aria-label="Selected work packet">
            <WorkPacketDetail
              item={selectedItem}
              onUpdate={updateSelected}
              onClaim={claimSelected}
              onLinkGithub={linkSelectedGithub}
              onCreateGithubIssue={createSelectedGithubIssue}
              onDuplicate={duplicateSelected}
              claimState={claimState}
              linkState={linkState}
              issueState={issueState}
            />
          </section>

          <aside className="agent-panel" aria-label="Agent prompt">
            <div className="agent-header">
              <div>
                <h2>Agent prompt</h2>
                <p>{selectedItem.key}.md</p>
              </div>
              <div className="agent-actions">
                <button type="button" className="icon-button" onClick={copyPrompt} aria-label="Copy prompt">
                  <Icon name="copy" />
                </button>
                <a className="icon-button" href={`/agent/${selectedItem.key}.md`} target="_blank" rel="noreferrer" aria-label="Open Markdown">
                  <Icon name="external" />
                </a>
              </div>
            </div>
            <div className="task-url" aria-label="Selected task URL">
              <span>Task URL</span>
              <a href={selectedTaskUrl} target="_blank" rel="noreferrer">
                {selectedTaskUrl}
              </a>
            </div>
            <div className={`copy-state ${copyState !== "idle" ? "is-visible" : ""}`}>
              {copyState === "copied" ? copyMessage || "Copied" : "Copy failed"}
            </div>
            <div className="pickup-actions" aria-label="Agent pickup commands">
              <button type="button" className="button secondary" onClick={() => copyText(selectedTaskUrl, "Task URL copied")}>
                Copy task URL
              </button>
              <button type="button" className="button secondary" onClick={() => copyText(codexPickupCommand, "Codex command copied")}>
                Copy Codex command
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => copyText(claudePickupCommand, "Claude command copied")}
              >
                Copy Claude command
              </button>
              <button type="button" className="button secondary" onClick={() => copyText(claimCommand, "Claim command copied")}>
                Copy claim command
              </button>
              <button type="button" className="button secondary" onClick={() => copyText(progressCommand, "Progress update copied")}>
                Copy progress update
              </button>
              <button type="button" className="button secondary" onClick={() => copyText(reviewCommand, "Review update copied")}>
                Copy review update
              </button>
              <a className="button secondary" href="/agent/instructions.md" target="_blank" rel="noreferrer">
                Instructions
              </a>
            </div>
            <section className="agent-runbook" aria-label="Agent runbook">
              <div className="agent-runbook-head">
                <div>
                  <h3>Agent runbook</h3>
                  <p>Handoff for {selectedItem.key}</p>
                </div>
                <button type="button" className="button secondary" onClick={() => copyText(agentRunbook, "Runbook copied")}>
                  Copy full runbook
                </button>
              </div>
              <div className="runbook-facts">
                <div>
                  <span>Token</span>
                  <strong>Env var</strong>
                  <code>{agentSecretConfig.secretName}</code>
                </div>
                <div>
                  <span>Shell</span>
                  <strong>PowerShell</strong>
                  <code>Invoke-RestMethod</code>
                </div>
                <div>
                  <span>Repo</span>
                  <strong>{selectedItem.repo}</strong>
                  <code>{selectedRepoSlug}</code>
                </div>
              </div>
              <ol className="runbook-checklist">
                <li>Load the token into $env:MANAGE_AUTH_TOKEN.</li>
                <li>Claim the packet before editing code.</li>
                <li>Branch from origin/main or origin/master.</li>
                <li>Run the listed tests and visual QA.</li>
                <li>Write back needs_review with PR and checks.</li>
                <li>Mark the PR ready, poll checks, and record CodeRabbit exactly as reported.</li>
                <li>After merge, run post-merge closeout to verify the PR and write back done with merge/check details.</li>
              </ol>
              <div className="runbook-actions" aria-label="Runbook commands">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => copyText(tokenBootstrapCommand, "Token bootstrap copied")}
                >
                  Token bootstrap
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => copyText(claimPowerShellCommand, "PowerShell claim copied")}
                >
                  PS claim
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => copyText(progressPowerShellCommand, "PowerShell progress copied")}
                >
                  PS progress
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => copyText(reviewPowerShellCommand, "PowerShell review copied")}
                >
                  PS review
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => copyText(repoHandoffCommand, "Repo handoff copied")}
                >
                  Repo handoff
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => copyText(prReadyPowerShellCommand, "PR ready/checks copied")}
                >
                  PR ready/checks
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => copyText(reviewPollPowerShellCommand, "Review poll copied")}
                >
                  Poll review
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => copyText(visualQaFallbackCommand, "Visual QA fallback copied")}
                >
                  QA fallback
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => copyText(postMergeCloseoutCommand, "Post-merge closeout copied")}
                >
                  Post-merge closeout
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => copyText(donePowerShellCommand, "PowerShell done copied")}
                >
                  PS done
                </button>
              </div>
            </section>
            <pre className="prompt-preview">{selectedPrompt}</pre>
            <div className="endpoint-list">
              <Endpoint label="Task URL" value={selectedTaskUrl} />
              <Endpoint label="Instructions" value="/agent/instructions.md" />
              <Endpoint label="Bootstrap" value="/api/agent/bootstrap" />
              <Endpoint label="Markdown" value={`/agent/${selectedItem.key}.md`} />
              <Endpoint label="JSON" value={`/api/agent/tasks/${selectedItem.key}`} />
              <Endpoint label="Task JSON" value={selectedTaskJsonUrl} />
              <Endpoint label="Next" value={`/api/agent/next?repo=${selectedItem.repo}`} />
              <Endpoint label="Next label" value={`/api/agent/next?label=${itemLabels(selectedItem)[0] || "label"}`} />
              <Endpoint label="Next claim" value="POST /api/agent/next/claim" />
              <Endpoint label="Claim" value={`POST /api/agent/tasks/${selectedItem.key}/claim`} />
              <Endpoint label="Status" value={`POST /api/agent/tasks/${selectedItem.key}/status`} />
            </div>
          </aside>
        </section>
          </>
        ) : null}

        {activeNav === "review" ? (
          <ReviewQueue items={reviewItems} onUpdatePacket={updatePacket} onOpenPacket={openPacket} />
        ) : null}

        {activeNav === "repos" ? (
          <>
            <SystemStatusPanel
              systemStatus={systemStatus}
              systemState={systemState}
              systemMessage={systemMessage}
              onRefresh={refreshSystemStatus}
            />

            <RepoHealth
              repositories={repositories}
              githubCache={githubCache}
              githubState={githubState}
              githubMessage={githubMessage}
              onSync={() => runGithubSync()}
              onMockSync={() => runGithubSync({ mock: true })}
              onLinkAll={linkAllGithub}
              onImportIssues={importGithubIssuesFromCache}
              linkState={linkState}
              issueImportState={issueImportState}
            />

            <BackupPanel
              backups={backups}
              backupState={backupState}
              backupMessage={backupMessage}
              onRefresh={refreshBackups}
              onCreate={createBackupNow}
              onRestore={restoreBackupSnapshot}
            />
          </>
        ) : null}

        {activeNav === "agents" ? <AgentsOverview items={items} activeClaims={activeClaims} onOpenPacket={openPacket} /> : null}
      </main>

      {showComposer && <Composer onClose={() => setShowComposer(false)} onCreate={createWorkItem} />}
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <article className={`metric metric-${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </article>
  );
}

function TodayOverview({ stats, nextItem, activity, repoHealthRows, onOpenPacket, onClaimPacket, claimState, onNavigate }) {
  return (
    <>
      <section className="today-hero" aria-label="Today overview">
        <article className="today-next">
          <span className="tn-eyebrow">Next ready packet</span>
          {nextItem ? (
            <>
              <div className="tn-key">{nextItem.key}</div>
              <h2>{nextItem.title}</h2>
              <p>{nextItem.summary}</p>
              <div className="tn-meta">
                <StatusPill status={nextItem.status} />
                <span>{formatPriority(nextItem.priority)}</span>
                <span>{nextItem.repo}</span>
              </div>
              <div className="tn-actions">
                <button type="button" className="button primary" onClick={() => onOpenPacket(nextItem.key)}>
                  Open packet
                </button>
                <button type="button" className="button secondary" onClick={() => onClaimPacket(nextItem)} disabled={claimState === "claiming"}>
                  {claimState === "claiming" ? "Claiming" : "Claim for agent"}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>No ready packet</h2>
              <p>The ready queue is clear. Draft or blocked packets still need scope before agent pickup.</p>
            </>
          )}
        </article>

        <article className="today-pulse">
          <h3>Backlog pulse</h3>
          <PulseRow label="Ready for agent" value={stats.readyCount} />
          <PulseRow label="In progress" value={stats.inProgressCount} />
          <PulseRow label="Needs review" value={stats.reviewCount} />
          <PulseRow label="Blocked" value={stats.blockedCount} />
        </article>
      </section>

      <div className="today-cols">
        <section className="overview-panel" aria-label="Recent agent activity">
          <div className="section-title-row">
            <div>
              <h2>Recent agent activity</h2>
              <p>{activity.length} latest event{activity.length === 1 ? "" : "s"} across packet writebacks.</p>
            </div>
            <button type="button" className="button secondary" onClick={() => onNavigate("agents")}>
              View agents
            </button>
          </div>
          <ActivityFeed events={activity} onOpenPacket={onOpenPacket} />
        </section>

        <section className="overview-panel" aria-label="Mini repo health">
          <div className="section-title-row">
            <div>
              <h2>Mini repo health</h2>
              <p>{repoHealthRows.length} repositories with PR, issue, failed-run, and branch counts.</p>
            </div>
            <button type="button" className="button secondary" onClick={() => onNavigate("repos")}>
              All repos
            </button>
          </div>
          <MiniRepoHealth rows={repoHealthRows} />
        </section>
      </div>
    </>
  );
}

function ActivityFeed({ events, onOpenPacket }) {
  if (events.length === 0) {
    return <div className="overview-empty">No agent events yet.</div>;
  }

  return (
    <div className="activity-feed">
      {events.map((event) => (
        <button
          type="button"
          className="activity-item"
          key={`${event.key}-${event.type}-${event.at}`}
          onClick={() => onOpenPacket(event.key)}
        >
          <span className={`activity-dot ad-${activityTone(event.type, event.status)}`}>
            <Icon name={activityIcon(event.type, event.status)} />
          </span>
          <span className="activity-body">
            <span className="ab-head">
              <span className="ab-key">{event.key}</span>
              <span className="ab-type">{formatAgentEventLabel(event)}</span>
              <span className="ab-time">{formatRelativeTime(event.at)}</span>
            </span>
            <span className="ab-note">{event.note || event.title}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function MiniRepoHealth({ rows }) {
  return (
    <div className="mini-repo">
      {rows.map((repo) => (
        <article className="mini-repo-row" key={repo.id}>
          <div>
            <span className="mr-name">{repo.name}</span>
            <span className="mr-domain">{repo.domain}</span>
            {repo.syncError ? <small>{repo.syncError}</small> : null}
          </div>
          <div className="mr-stat-grid">
            <span>{repo.openPrs} PRs</span>
            <span>{repo.openIssues} issues</span>
            <span className={repo.failedRuns > 0 ? "is-alert" : ""}>{repo.failedRuns} failed</span>
            <span>{repo.branches} branches</span>
          </div>
          <StatusPill status={repoHealthStatus(repo)} />
        </article>
      ))}
    </div>
  );
}

function ReviewQueue({ items, onUpdatePacket, onOpenPacket }) {
  if (items.length === 0) {
    return (
      <section className="overview-panel review-empty" aria-label="Review queue">
        <div className="overview-empty">No packets need review.</div>
      </section>
    );
  }

  return (
    <section className="review-route" aria-label="Review queue">
      <div className="section-title-row">
        <div>
          <h2>Review queue</h2>
          <p>{items.length} packet{items.length === 1 ? "" : "s"} awaiting sign-off.</p>
        </div>
      </div>
      <div className="review-grid">
        {items.map((item) => (
          <ReviewCard key={item.key} item={item} onUpdatePacket={onUpdatePacket} onOpenPacket={onOpenPacket} />
        ))}
      </div>
    </section>
  );
}

function ReviewCard({ item, onUpdatePacket, onOpenPacket }) {
  const update = item.lastAgentUpdate || {};
  const branch = update.githubBranch || item.githubBranch;
  const prUrl = update.githubPrUrl || item.githubPrUrl;
  const testsRun = linesFromValue(update.testsRun);
  const filesChanged = linesFromValue(update.filesChanged);

  return (
    <article className="review-card">
      <div className="review-card-head">
        <div>
          <div className="rc-key">{item.key}</div>
          <h3>{item.title}</h3>
          <div className="rc-repo">
            <Icon name="repo" />
            {item.repo} / claimed by {item.claimedBy || item.agent || "Unassigned"} / updated {formatRelativeTime(item.updatedAt)}
          </div>
        </div>
        <span className="claim-agent">
          <span className="ca-avatar">{agentInitials(item.claimedBy || item.agent || "Agent")}</span>
          {item.claimedBy || item.agent || "Unassigned"}
        </span>
      </div>

      <div className="review-writeback">
        {update.note ? <p className="rw-note">{update.note}</p> : <p className="detail-note">No latest agent note recorded.</p>}
        <div className="review-pr">
          {branch ? <code>{branch}</code> : <span className="detail-note">No branch linked</span>}
          {prUrl ? (
            <a href={prUrl} target="_blank" rel="noreferrer">
              Pull request
            </a>
          ) : (
            <span className="detail-note">No PR linked</span>
          )}
        </div>
        <div className="review-checklist">
          <ReviewList label="Tests run" items={testsRun} />
          <ReviewList label="Files changed" items={filesChanged} />
        </div>
      </div>

      <div className="review-foot">
        <button type="button" className="button primary" onClick={() => onUpdatePacket(item.key, { status: "done" })}>
          <Icon name="check" />
          Mark done
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => onUpdatePacket(item.key, { status: "ready_for_agent", blockedBy: "" })}
        >
          Needs changes
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => onUpdatePacket(item.key, { status: "blocked", blockedBy: item.blockedBy || "Blocked from review queue." })}
        >
          Blocked
        </button>
        <button type="button" className="button secondary rf-spacer" onClick={() => onOpenPacket(item.key)}>
          Open packet
        </button>
      </div>
    </article>
  );
}

function ReviewList({ label, items }) {
  return (
    <div>
      <span>{label}</span>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="detail-note">Not recorded</p>
      )}
    </div>
  );
}

function AgentsOverview({ items, activeClaims, onOpenPacket }) {
  const roster = ["Codex", "Claude Code"].map((agent) => ({
    agent,
    active: activeClaims.filter((item) => item.claimedBy === agent || (item.agent === agent && item.status !== "done")).length,
    assigned: items.filter((item) => item.agent === agent).length,
  }));
  const activity = buildActivityFeed(items, 6);

  return (
    <section className="agents-route" aria-label="Agent activity">
      <div className="overview-panel agents-main">
        <div className="section-title-row">
          <div>
            <h2>Active claims</h2>
            <p>{activeClaims.length} running or claimed packet{activeClaims.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        {activeClaims.length === 0 ? (
          <div className="overview-empty">No active claims. Claimed packets and leases will appear here.</div>
        ) : (
          <div className="agent-claims">
            {activeClaims.map((item) => (
              <AgentClaimCard key={item.key} item={item} onOpenPacket={onOpenPacket} />
            ))}
          </div>
        )}
      </div>

      <aside className="agents-side">
        <section className="overview-panel">
          <div className="section-title-row">
            <div>
              <h2>Roster</h2>
              <p>Assigned and active work by agent.</p>
            </div>
          </div>
          <div className="roster-list">
            {roster.map((entry) => (
              <article className="roster-row" key={entry.agent}>
                <div className="roster-avatar">{agentInitials(entry.agent)}</div>
                <div>
                  <strong>{entry.agent}</strong>
                  <span>{entry.assigned} assigned / {entry.active} running</span>
                </div>
                <b>{entry.active}</b>
              </article>
            ))}
          </div>
        </section>

        <section className="overview-panel" aria-label="Agent recent activity">
          <div className="section-title-row">
            <div>
              <h2>Recent activity</h2>
              <p>{activity.length} latest lifecycle event{activity.length === 1 ? "" : "s"}.</p>
            </div>
          </div>
          <ActivityFeed events={activity} onOpenPacket={onOpenPacket} />
        </section>
      </aside>
    </section>
  );
}

function AgentClaimCard({ item, onOpenPacket }) {
  const leasePct = leaseProgress(item);
  const lease = leaseSummary(item);

  return (
    <article className="claim-card">
      <div className="claim-head">
        <div>
          <div className="claim-row-key">{item.key}</div>
          <h3>{item.title}</h3>
        </div>
        <span className="claim-agent">
          <span className="ca-avatar">{agentInitials(item.claimedBy || item.agent || "Agent")}</span>
          {item.claimedBy || item.agent || "Unassigned"}
        </span>
      </div>

      <div className="claim-meta">
        <div>
          <span>Repo</span>
          <strong>{item.repo}</strong>
        </div>
        <div>
          <span>Run ID</span>
          <code>{item.agentRunId || "Not recorded"}</code>
        </div>
        <div>
          <span>Claimed</span>
          <strong>{formatRelativeTime(item.claimedAt)}</strong>
        </div>
        <div>
          <span>Status</span>
          <StatusPill status={item.status} />
        </div>
      </div>

      <div className={`lease-row lease-${lease.tone}`}>
        <div className="lr-head">
          <span>Lease</span>
          <span>{lease.label}</span>
        </div>
        <div className="lease-bar" style={{ "--lease": `${leasePct ?? 0}%` }} />
      </div>

      {item.lastAgentUpdate?.note ? <p className="agent-note">{item.lastAgentUpdate.note}</p> : null}

      <div className="claim-foot">
        {item.githubBranch ? <code>{item.githubBranch}</code> : <span className="detail-note">No branch linked</span>}
        <button type="button" className="button secondary" onClick={() => onOpenPacket(item.key)}>
          Open packet
        </button>
      </div>
    </article>
  );
}

function ClaimList({ items, onOpenPacket }) {
  if (items.length === 0) {
    return <div className="overview-empty">No active claims.</div>;
  }

  return (
    <div className="claim-list">
      {items.map((item) => (
        <article className="claim-row" key={item.key}>
          <div>
            <div className="claim-row-key">{item.key}</div>
            <h3>{item.title}</h3>
            <p>{item.claimedBy || item.agent || "Unassigned"} / {item.repo}</p>
          </div>
          <div className="claim-row-side">
            <StatusPill status={item.status} />
            <button type="button" className="button secondary" onClick={() => onOpenPacket(item.key)}>
              Open packet
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function PulseRow({ label, value }) {
  return (
    <div className="pulse-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function agentInitials(agent) {
  return agent
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

function linesToText(value) {
  return Array.isArray(value) ? value.join("\n") : String(value || "");
}

function itemToDraft(item) {
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

function WorkPacketDetail({
  item,
  onUpdate,
  onClaim,
  onLinkGithub,
  onCreateGithubIssue,
  onDuplicate,
  claimState,
  linkState,
  issueState,
}) {
  const repo = getRepo(item.repo);
  const activeLease = isLeaseActive(item);
  const matchCount = githubMatchCount(item);
  const agentEvents = Array.isArray(item.agentEvents) ? item.agentEvents : [];
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(() => itemToDraft(item));
  const [saveState, setSaveState] = useState("idle");

  useEffect(() => {
    setDraft(itemToDraft(item));
    setIsEditing(false);
    setSaveState("idle");
  }, [item.key]);

  function updateDraft(field, value) {
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }));
  }

  async function saveEdit(event) {
    event.preventDefault();
    setSaveState("saving");
    const saved = await onUpdate(draft);
    setSaveState(saved ? "idle" : "failed");

    if (saved) {
      setIsEditing(false);
    }
  }

  return (
    <>
      <div className="detail-top">
        <div>
          <div className="detail-key">{item.key}</div>
          <h2>{item.title}</h2>
        </div>
        <StatusPill status={item.status} />
      </div>

      <div className="field-grid">
        <label className="field-card">
          <span>Status</span>
          <select value={item.status} onChange={(event) => onUpdate({ status: event.target.value })}>
            {statusOptions.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-card">
          <span>Priority</span>
          <select value={item.priority} onChange={(event) => onUpdate({ priority: event.target.value })}>
            {priorityOptions.map((priority) => (
              <option key={priority.id} value={priority.id}>
                {priority.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-card">
          <span>Agent</span>
          <select value={item.agent || ""} onChange={(event) => onUpdate({ agent: event.target.value })}>
            <option value="">Any agent</option>
            <option value="Codex">Codex</option>
            <option value="Claude Code">Claude Code</option>
          </select>
        </label>
      </div>

      <div className="detail-actions">
        <button
          type="button"
          className="button secondary"
          onClick={onClaim}
          disabled={claimState === "claiming" || activeLease}
        >
          {claimState === "claiming" ? "Claiming" : activeLease ? "Lease active" : "Claim packet"}
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={onLinkGithub}
          disabled={linkState === "linking"}
        >
          {linkState === "linking" ? "Linking GitHub" : "Link GitHub"}
        </button>
        {item.githubIssueUrl ? (
          <a className="button secondary" href={item.githubIssueUrl} target="_blank" rel="noreferrer">
            Open issue
          </a>
        ) : (
          <button
            type="button"
            className="button secondary"
            onClick={onCreateGithubIssue}
            disabled={issueState === "creating"}
          >
            {issueState === "creating" ? "Creating issue" : "Create issue"}
          </button>
        )}
        <button type="button" className="button secondary" onClick={() => onUpdate({ status: "needs_review" })}>
          Mark review
        </button>
        <button type="button" className="button secondary" onClick={() => setIsEditing((current) => !current)}>
          {isEditing ? "Close edit" : "Edit packet"}
        </button>
        <button type="button" className="button secondary" onClick={onDuplicate}>
          Duplicate
        </button>
      </div>

      {isEditing ? (
        <PacketEditForm
          draft={draft}
          onChange={updateDraft}
          onSubmit={saveEdit}
          onCancel={() => {
            setDraft(itemToDraft(item));
            setIsEditing(false);
          }}
          saveState={saveState}
        />
      ) : (
        <div className="context-stack">
        <Section title="Labels">
          <LabelList labels={itemLabels(item)} />
        </Section>

        <Section title="Repo">
          <div className="repo-card">
            <div>
              <strong>{repo?.name || item.repo}</strong>
              <span>{repo?.description || "Repo metadata not recorded."}</span>
            </div>
            <small>{repo?.domain || "Workspace"}</small>
          </div>
          <div className="branch-line">
            <Icon name="branch" />
            <code>{item.suggestedBranch}</code>
          </div>
          <div className="handoff-grid">
            <div>
              <span>Matched branch</span>
              <code>{item.githubBranch || "Not linked"}</code>
            </div>
            <div>
              <span>Matched PR</span>
              {item.githubPrUrl ? (
                <a href={item.githubPrUrl} target="_blank" rel="noreferrer">
                  {item.githubPrUrl}
                </a>
              ) : (
                <code>Not linked</code>
              )}
            </div>
            <div>
              <span>GitHub issue</span>
              {item.githubIssueUrl ? (
                <a href={item.githubIssueUrl} target="_blank" rel="noreferrer">
                  {item.githubIssueTitle || item.githubIssueUrl}
                </a>
              ) : (
                <code>Not linked</code>
              )}
            </div>
          </div>
        </Section>

        {item.claimedBy || item.agentRunId || item.leaseExpiresAt ? (
          <Section title="Agent run">
            <div className="run-card">
              <div>
                <span>Claimed by</span>
                <strong>{item.claimedBy || "Not claimed"}</strong>
              </div>
              <div>
                <span>Run ID</span>
                <code>{item.agentRunId || "Not recorded"}</code>
              </div>
              <div>
                <span>Claimed at</span>
                <strong>{formatDateTime(item.claimedAt)}</strong>
              </div>
              <div>
                <span>Lease expires</span>
                <strong>{formatDateTime(item.leaseExpiresAt)}</strong>
              </div>
            </div>
          </Section>
        ) : null}

        {agentEvents.length > 0 ? (
          <Section title="Agent timeline">
            <AgentTimeline events={agentEvents} />
          </Section>
        ) : null}

        <Section title="GitHub activity">
          {matchCount > 0 ? (
            <div className="github-match-list">
              {(item.githubLinks?.pullRequests || []).map((pullRequest) => (
                <a key={pullRequest.url} href={pullRequest.url} target="_blank" rel="noreferrer">
                  PR #{pullRequest.number}: {pullRequest.title}
                </a>
              ))}
              {(item.githubLinks?.branches || []).map((branch) => (
                <code key={branch.name}>{branch.name}</code>
              ))}
              {(item.githubLinks?.issues || []).map((issue) => (
                <a key={issue.url} href={issue.url} target="_blank" rel="noreferrer">
                  Issue #{issue.number}: {issue.title}
                </a>
              ))}
              {(item.githubLinks?.workflowRuns || []).map((run) => (
                <a key={run.url} href={run.url} target="_blank" rel="noreferrer">
                  {run.name}: {run.branch}
                </a>
              ))}
            </div>
          ) : (
            <p>No cached GitHub matches recorded.</p>
          )}
        </Section>

        {item.status === "needs_review" ? (
          <Section title="Review queue">
            <ReviewSummary item={item} update={item.lastAgentUpdate} />
            <div className="review-actions">
              <button type="button" className="button secondary" onClick={() => onUpdate({ status: "done" })}>
                Mark done
              </button>
              <button type="button" className="button secondary" onClick={() => onUpdate({ status: "ready_for_agent" })}>
                Needs changes
              </button>
              <button type="button" className="button secondary" onClick={() => onUpdate({ status: "blocked" })}>
                Blocked
              </button>
            </div>
          </Section>
        ) : null}

        <Section title="Outcome">
          <p>{item.desiredOutcome}</p>
        </Section>

        <Section title="Acceptance criteria">
          <CheckList items={item.acceptanceCriteria} />
        </Section>

        <Section title="Relevant files">
          <CodeList items={item.relevantFiles} />
        </Section>

        <Section title="Test commands">
          <CodeList items={item.testCommands} />
        </Section>

        {item.blockedBy ? (
          <Section title="Blocked by">
            <p>{item.blockedBy}</p>
          </Section>
        ) : null}

        {item.lastAgentUpdate?.note ? (
          <Section title="Latest agent note">
            <p>{item.lastAgentUpdate.note}</p>
          </Section>
        ) : null}
        </div>
      )}
    </>
  );
}

function ReviewSummary({ item, update }) {
  const reviewUpdate = update || {};
  const branch = reviewUpdate.githubBranch || item.githubBranch;
  const prUrl = reviewUpdate.githubPrUrl || item.githubPrUrl;

  if (!reviewUpdate.note && !branch && !prUrl && !hasStructuredAgentUpdate(reviewUpdate)) {
    return <p className="detail-note">No structured review writeback recorded yet.</p>;
  }

  return (
    <div className="review-summary">
      <div className="review-summary-grid">
        <div>
          <span>Branch</span>
          <code>{branch || "Not recorded"}</code>
        </div>
        <div>
          <span>Pull request</span>
          {prUrl ? (
            <a href={prUrl} target="_blank" rel="noreferrer">
              {prUrl}
            </a>
          ) : (
            <code>Not recorded</code>
          )}
        </div>
      </div>
      {reviewUpdate.note ? <p>{reviewUpdate.note}</p> : null}
      <StructuredAgentUpdate update={reviewUpdate} />
    </div>
  );
}

function AgentTimeline({ events }) {
  return (
    <div className="agent-timeline">
      {[...events].reverse().map((event, index) => (
        <AgentEventCard key={`${event.at || "event"}-${event.type || "agent"}-${index}`} event={event} />
      ))}
    </div>
  );
}

function AgentEventCard({ event }) {
  return (
    <article className="agent-event-card">
      <div className="agent-event-head">
        <div>
          <strong>{formatEventType(event.type)}</strong>
          <span>
            {event.agent || "Agent"} - {formatDateTime(event.at)}
          </span>
        </div>
        {event.status ? <StatusPill status={event.status} /> : null}
      </div>
      {event.agentRunId ? <code>{event.agentRunId}</code> : null}
      {event.note ? <p>{event.note}</p> : null}
      {event.leaseExpiresAt ? <p className="detail-note">Lease expires {formatDateTime(event.leaseExpiresAt)}.</p> : null}
      <StructuredAgentUpdate update={event} />
    </article>
  );
}

function StructuredAgentUpdate({ update }) {
  const testsRun = linesFromValue(update?.testsRun);
  const filesChanged = linesFromValue(update?.filesChanged);
  const blockers = linesFromValue(update?.blockers);
  const nextSteps = linesFromValue(update?.nextSteps);
  const branch = update?.githubBranch;
  const prUrl = update?.githubPrUrl;

  if (!branch && !prUrl && testsRun.length === 0 && filesChanged.length === 0 && blockers.length === 0 && nextSteps.length === 0) {
    return null;
  }

  return (
    <div className="agent-update-grid">
      {branch ? (
        <div>
          <span>Branch</span>
          <code>{branch}</code>
        </div>
      ) : null}
      {prUrl ? (
        <div>
          <span>Pull request</span>
          <a href={prUrl} target="_blank" rel="noreferrer">
            {prUrl}
          </a>
        </div>
      ) : null}
      <AgentUpdateList label="Tests run" items={testsRun} />
      <AgentUpdateList label="Files changed" items={filesChanged} />
      <AgentUpdateList label="Blockers" items={blockers} />
      <AgentUpdateList label="Next steps" items={nextSteps} />
    </div>
  );
}

function AgentUpdateList({ label, items }) {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div>
      <span>{label}</span>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function PacketEditForm({ draft, onChange, onSubmit, onCancel, saveState }) {
  return (
    <form className="packet-editor" onSubmit={onSubmit}>
      <div className="editor-grid">
        <label className="span-2">
          <span>Title</span>
          <input value={draft.title} onChange={(event) => onChange("title", event.target.value)} required />
        </label>
        <label>
          <span>Status</span>
          <select value={draft.status} onChange={(event) => onChange("status", event.target.value)}>
            {statusOptions.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Priority</span>
          <select value={draft.priority} onChange={(event) => onChange("priority", event.target.value)}>
            {priorityOptions.map((priority) => (
              <option key={priority.id} value={priority.id}>
                {priority.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Repo</span>
          <select value={draft.repo} onChange={(event) => onChange("repo", event.target.value)}>
            {repoOptions.map((repo) => (
              <option key={repo} value={repo}>
                {repo}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Agent</span>
          <select value={draft.agent} onChange={(event) => onChange("agent", event.target.value)}>
            <option value="">Any agent</option>
            <option value="Codex">Codex</option>
            <option value="Claude Code">Claude Code</option>
          </select>
        </label>
        <label>
          <span>Project</span>
          <input value={draft.project} onChange={(event) => onChange("project", event.target.value)} />
        </label>
        <label className="span-2">
          <span>Suggested branch</span>
          <input value={draft.suggestedBranch} onChange={(event) => onChange("suggestedBranch", event.target.value)} />
        </label>
        <label className="span-2">
          <span>Labels</span>
          <input value={draft.labels} onChange={(event) => onChange("labels", event.target.value)} placeholder="bug, ui, qa" />
        </label>
        <label className="span-2">
          <span>Problem statement</span>
          <textarea value={draft.summary} onChange={(event) => onChange("summary", event.target.value)} rows="4" />
        </label>
        <label className="span-2">
          <span>Desired outcome</span>
          <textarea value={draft.desiredOutcome} onChange={(event) => onChange("desiredOutcome", event.target.value)} rows="4" />
        </label>
        <label>
          <span>Acceptance criteria</span>
          <textarea value={draft.acceptanceCriteria} onChange={(event) => onChange("acceptanceCriteria", event.target.value)} rows="8" />
        </label>
        <label>
          <span>Relevant files</span>
          <textarea value={draft.relevantFiles} onChange={(event) => onChange("relevantFiles", event.target.value)} rows="8" />
        </label>
        <label>
          <span>Relevant URLs</span>
          <textarea value={draft.relevantUrls} onChange={(event) => onChange("relevantUrls", event.target.value)} rows="5" />
        </label>
        <label>
          <span>Implementation notes</span>
          <textarea value={draft.implementationNotes} onChange={(event) => onChange("implementationNotes", event.target.value)} rows="5" />
        </label>
        <label>
          <span>Test commands</span>
          <textarea value={draft.testCommands} onChange={(event) => onChange("testCommands", event.target.value)} rows="4" />
        </label>
        <label>
          <span>Blocked by</span>
          <textarea value={draft.blockedBy} onChange={(event) => onChange("blockedBy", event.target.value)} rows="4" />
        </label>
        <label>
          <span>GitHub branch</span>
          <input value={draft.githubBranch} onChange={(event) => onChange("githubBranch", event.target.value)} />
        </label>
        <label>
          <span>GitHub PR URL</span>
          <input value={draft.githubPrUrl} onChange={(event) => onChange("githubPrUrl", event.target.value)} />
        </label>
        <label>
          <span>GitHub issue URL</span>
          <input value={draft.githubIssueUrl} onChange={(event) => onChange("githubIssueUrl", event.target.value)} />
        </label>
        <label>
          <span>GitHub issue title</span>
          <input value={draft.githubIssueTitle} onChange={(event) => onChange("githubIssueTitle", event.target.value)} />
        </label>
        <label className="span-2">
          <span>Deploy notes</span>
          <textarea value={draft.deployNotes} onChange={(event) => onChange("deployNotes", event.target.value)} rows="4" />
        </label>
      </div>
      <div className="editor-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button primary" disabled={saveState === "saving"}>
          {saveState === "saving" ? "Saving" : "Save edits"}
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function CheckList({ items }) {
  return (
    <ul className="check-list">
      {items.map((item) => (
        <li key={item}>
          <Icon name="check" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function CodeList({ items }) {
  return (
    <div className="code-list">
      {items.map((item) => (
        <code key={item}>{item}</code>
      ))}
    </div>
  );
}

function LabelList({ labels, compact = false }) {
  const normalizedLabels = [...new Set((labels || []).map(normalizeLabel).filter(Boolean))];

  if (normalizedLabels.length === 0) {
    return compact ? null : <p className="empty-labels">No labels recorded.</p>;
  }

  return (
    <div className={`label-list ${compact ? "is-compact" : ""}`}>
      {normalizedLabels.map((label) => (
        <span key={label} className="label-chip">
          #{label}
        </span>
      ))}
    </div>
  );
}

function PriorityFlag({ priority }) {
  const tone = priority === "urgent" || priority === "high" ? "high" : priority === "low" ? "low" : "medium";

  return (
    <span className={`priority-flag pf-${tone}`}>
      <span className="pf-dot" />
      {formatPriority(priority)}
    </span>
  );
}

function StatusPill({ status }) {
  return <span className={`status-pill status-${getStatusTone(status)}`}>{formatStatus(status)}</span>;
}

function Readiness({ value }) {
  return (
    <span className="readiness" style={{ "--readiness": `${value}%` }}>
      <span />
      {value}%
    </span>
  );
}

function Endpoint({ label, value }) {
  return (
    <div className="endpoint">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  );
}

function SystemStatusPanel({ systemStatus, systemState, systemMessage, onRefresh }) {
  const storageKind = systemStatus?.storage?.kind;
  const baseUrl = systemStatus?.baseUrl || manageOrigin();
  const githubLoginEnabled = Boolean(systemStatus?.auth?.providers?.github);
  const tokenLoginEnabled = Boolean(systemStatus?.auth?.providers?.token);
  const githubSyncSource = systemStatus?.githubSync?.source || "checking";
  const backupRetention = systemStatus?.storage?.backups?.retention;
  const backupsEnabled = Boolean(systemStatus?.storage?.backups?.enabled);

  return (
    <section className="system-status" aria-label="System status">
      <div className="system-status-main">
        <div>
          <h2>System status</h2>
          <p>{systemMessage}</p>
        </div>
        <div className="system-status-grid">
          <SystemStatusItem label="Base URL" value={baseUrl} />
          <SystemStatusItem label="Storage" value={formatStorageKind(storageKind)} tone={storageKind === "firestore" ? "ready" : "info"} />
          <SystemStatusItem label="Auth" value={formatProviderState(githubLoginEnabled, "GitHub")} tone={githubLoginEnabled ? "ready" : "info"} />
          <SystemStatusItem label="Agent token" value={formatProviderState(tokenLoginEnabled, "Bearer")} tone={tokenLoginEnabled ? "ready" : "blocked"} />
          <SystemStatusItem label="GitHub sync" value={githubSyncSource} tone={githubSyncSource === "github-token" ? "ready" : "info"} />
          <SystemStatusItem
            label="Backups"
            value={backupsEnabled ? `Last ${backupRetention}` : "Off"}
            tone={backupsEnabled ? "ready" : "blocked"}
          />
        </div>
      </div>
      <button type="button" className="button secondary" onClick={onRefresh} disabled={systemState === "loading"}>
        {systemState === "loading" ? "Checking" : "Refresh status"}
      </button>
    </section>
  );
}

function SystemStatusItem({ label, value, tone = "info" }) {
  return (
    <div className={`system-status-item status-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BackupPanel({ backups, backupState, backupMessage, onRefresh, onCreate, onRestore }) {
  const latestBackup = backups[0];

  return (
    <section className="backup-panel" aria-label="Backups">
      <div className="section-title-row">
        <div>
          <h2>Backups</h2>
          <p>
            {latestBackup
              ? `${backupMessage}. Latest ${formatDateTime(latestBackup.createdAt)}.`
              : backupMessage}
          </p>
        </div>
        <div className="backup-actions">
          <a className="button secondary" href="/api/backups/export" target="_blank" rel="noreferrer">
            Export backlog
          </a>
          <button type="button" className="button secondary" onClick={onRefresh} disabled={backupState === "loading"}>
            {backupState === "loading" ? "Refreshing" : "Refresh"}
          </button>
          <button type="button" className="button primary" onClick={onCreate} disabled={backupState === "saving"}>
            {backupState === "saving" ? "Saving" : "Create snapshot"}
          </button>
        </div>
      </div>

      <div className="backup-table">
        {backups.length === 0 ? (
          <div className="backup-empty">No backup snapshots recorded</div>
        ) : (
          backups.slice(0, 6).map((snapshot) => (
            <article key={snapshot.id} className="backup-row">
              <div>
                <strong>{snapshot.reason || "manual"}</strong>
                <span>{snapshot.id}</span>
              </div>
              <span>{formatDateTime(snapshot.createdAt)}</span>
              <span>{snapshot.stats?.workItems ?? 0} packets</span>
              <span>{snapshot.stats?.githubRepos ?? 0} repos</span>
              <span>{snapshot.automatic ? "Auto" : "Manual"}</span>
              <button
                type="button"
                className="button secondary"
                onClick={() => onRestore(snapshot)}
                disabled={backupState === "restoring"}
              >
                {backupState === "restoring" ? "Restoring" : "Restore"}
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function RepoHealth({
  repositories,
  githubCache,
  githubState,
  githubMessage,
  onSync,
  onMockSync,
  onLinkAll,
  onImportIssues,
  linkState,
  issueImportState,
}) {
  const githubByRepo = new Map((githubCache?.repos || []).map((repo) => [repo.id, repo]));

  return (
    <section className="repo-health" aria-label="Repository health">
      <div className="section-title-row">
        <div>
          <h2>Repo health</h2>
          <p>
            {githubCache?.syncedAt
              ? `${githubMessage}. Last sync ${new Date(githubCache.syncedAt).toLocaleString()}.`
              : githubMessage}
          </p>
        </div>
        <div className="repo-actions">
          <button type="button" className="button secondary" onClick={onMockSync}>
            Mock sync
          </button>
          <button type="button" className="button secondary" onClick={onLinkAll} disabled={linkState === "linking"}>
            {linkState === "linking" ? "Linking" : "Link packets"}
          </button>
          <button type="button" className="button secondary" onClick={onImportIssues} disabled={issueImportState === "importing"}>
            {issueImportState === "importing" ? "Importing" : "Import issues"}
          </button>
          <button type="button" className="button primary" onClick={onSync} disabled={githubState === "syncing"}>
            {githubState === "syncing" ? "Syncing" : "Sync GitHub"}
          </button>
        </div>
      </div>
      <div className="repo-sync-note">
        <span className="dot" />
        {githubCache?.syncedAt ? `Last sync ${formatDateTime(githubCache.syncedAt)}` : githubMessage}
      </div>
      <div className="repo-grid">
        {repositories.map((repo) => {
          const syncedRepo = githubByRepo.get(repo.id);
          const branchValue = syncedRepo?.branches;
          const branchCount = Array.isArray(branchValue) ? branchValue.length : Number(branchValue || 0);
          const repoStats = {
            openPrs: syncedRepo?.openPrs ?? repo.openPrs ?? 0,
            openIssues: syncedRepo?.openIssues ?? 0,
            failedRuns: syncedRepo?.failedRuns ?? repo.failedRuns ?? 0,
            branches: Number.isFinite(branchCount) ? branchCount : 0,
            defaultBranch: syncedRepo?.defaultBranch || "main",
            syncError: syncedRepo?.syncError || "",
          };
          const repoUrl = `https://github.com/${repo.owner || "your-org"}/${repo.name}`;

          return (
            <article key={repo.id} className="repo-tile">
              <div className="repo-tile-head">
                <div>
                  <div className="rt-name">{repo.name}</div>
                  <div className="rt-domain">{repo.domain || repo.id}</div>
                </div>
                <StatusPill status={repoHealthStatus(repo)} />
              </div>
              <p>{repo.description}</p>
              {repoStats.syncError ? <small className="repo-sync-error">{repoStats.syncError}</small> : null}
              <div className="repo-stats">
                <RepoStat label="PRs" value={repoStats.openPrs} />
                <RepoStat label="Issues" value={repoStats.openIssues} />
                <RepoStat label="Failed" value={repoStats.failedRuns} alert={repoStats.failedRuns > 0} />
                <RepoStat label="Branches" value={repoStats.branches} />
              </div>
              <div className="repo-tile-foot">
                <span className="rf-branch">
                  <Icon name="branch" />
                  {repoStats.defaultBranch}
                </span>
                <a className="button secondary" href={repoUrl} target="_blank" rel="noreferrer">
                  Open repo
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RepoStat({ label, value, alert = false }) {
  return (
    <div className={`repo-stat ${alert ? "is-alert" : ""}`}>
      <div className="rs-value">{value}</div>
      <div className="rs-label">{label}</div>
    </div>
  );
}

function LoginScreen({ error, onLogin, sessionInfo }) {
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const githubLoginUrl = sessionInfo?.providers?.github ? sessionInfo.loginUrls?.github : "";

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    await onLogin(token);
    setSubmitting(false);
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand-mark">M</div>
        <h1>Manage</h1>
        <p>Open the backlog console with your access token or an allowed GitHub account.</p>
        {githubLoginUrl ? (
          <>
            <a className="button secondary github-login" href={githubLoginUrl}>
              Continue with GitHub
            </a>
            <div className="auth-divider">
              <span>or</span>
            </div>
          </>
        ) : null}
        <label>
          <span>Access token</span>
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="manage-local"
            type="password"
            autoFocus
          />
        </label>
        {error ? <div className="auth-error">{error}</div> : null}
        <button type="submit" className="button primary" disabled={submitting}>
          {submitting ? "Checking" : "Open Manage"}
        </button>
      </form>
    </div>
  );
}

function Composer({ onClose, onCreate }) {
  const [form, setForm] = useState({
    templateId: "",
    title: "",
    repo: "web-app",
    priority: "medium",
    project: "Manage",
    branch: "",
    agent: "Codex",
    labels: "",
    summary: "",
    desiredOutcome: "",
    acceptanceCriteria: "",
    relevantFiles: "",
    relevantUrls: "",
    implementationNotes: "",
    testCommands: "npm.cmd test",
    deployNotes: "",
    ready: false,
  });

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function applyTemplate(templateId) {
    const template = packetTemplates.find((candidate) => candidate.id === templateId);

    if (!template) {
      update("templateId", "");
      return;
    }

    setForm((current) => ({
      ...current,
      ...template,
      templateId,
      branch: "",
      ready: false,
    }));
  }

  function submit(event) {
    event.preventDefault();
    onCreate(form);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="composer" onSubmit={submit}>
        <div className="composer-header">
          <div>
            <h2>New work packet</h2>
            <p>Capture enough context for a coding agent to start cleanly.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="composer-grid">
          <label className="span-2">
            <span>Template</span>
            <select data-testid="composer-template" value={form.templateId} onChange={(event) => applyTemplate(event.target.value)}>
              <option value="">Blank packet</option>
              {packetTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            <span>Title</span>
            <input value={form.title} onChange={(event) => update("title", event.target.value)} required />
          </label>
          <label>
            <span>Repo</span>
            <select data-testid="composer-repo" value={form.repo} onChange={(event) => update("repo", event.target.value)}>
              {repoOptions.map((repo) => (
                <option key={repo} value={repo}>
                  {repo}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Priority</span>
            <select value={form.priority} onChange={(event) => update("priority", event.target.value)}>
              {priorityOptions.map((priority) => (
                <option key={priority.id} value={priority.id}>
                  {priority.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Project</span>
            <input value={form.project} onChange={(event) => update("project", event.target.value)} />
          </label>
          <label>
            <span>Agent</span>
            <select value={form.agent} onChange={(event) => update("agent", event.target.value)}>
              <option value="">Any agent</option>
              <option value="Codex">Codex</option>
              <option value="Claude Code">Claude Code</option>
            </select>
          </label>
          <label className="span-2">
            <span>Suggested branch</span>
            <input value={form.branch} onChange={(event) => update("branch", event.target.value)} placeholder="Auto-generated if blank" />
          </label>
          <label className="span-2">
            <span>Labels</span>
            <input value={form.labels} onChange={(event) => update("labels", event.target.value)} placeholder="bug, ui, qa" />
          </label>
          <label className="span-2">
            <span>Problem statement</span>
            <textarea value={form.summary} onChange={(event) => update("summary", event.target.value)} rows="3" required />
          </label>
          <label className="span-2">
            <span>Desired outcome</span>
            <textarea value={form.desiredOutcome} onChange={(event) => update("desiredOutcome", event.target.value)} rows="3" required />
          </label>
          <label>
            <span>Acceptance criteria</span>
            <textarea value={form.acceptanceCriteria} onChange={(event) => update("acceptanceCriteria", event.target.value)} rows="7" placeholder="One per line" />
          </label>
          <label>
            <span>Relevant files</span>
            <textarea value={form.relevantFiles} onChange={(event) => update("relevantFiles", event.target.value)} rows="7" placeholder="One per line" />
          </label>
          <label>
            <span>Relevant URLs</span>
            <textarea value={form.relevantUrls} onChange={(event) => update("relevantUrls", event.target.value)} rows="5" placeholder="One per line" />
          </label>
          <label>
            <span>Implementation notes</span>
            <textarea value={form.implementationNotes} onChange={(event) => update("implementationNotes", event.target.value)} rows="5" placeholder="One per line" />
          </label>
          <label>
            <span>Test commands</span>
            <textarea value={form.testCommands} onChange={(event) => update("testCommands", event.target.value)} rows="4" placeholder="One per line" />
          </label>
          <label>
            <span>Deploy notes</span>
            <textarea value={form.deployNotes} onChange={(event) => update("deployNotes", event.target.value)} rows="4" />
          </label>
        </div>

        <label className="ready-toggle">
          <input type="checkbox" checked={form.ready} onChange={(event) => update("ready", event.target.checked)} />
          <span>Mark ready for agent</span>
        </label>

        <div className="composer-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Create packet
          </button>
        </div>
      </form>
    </div>
  );
}

function Icon({ name }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": "true",
  };

  const paths = {
    dashboard: (
      <>
        <path d="M4 13h6v7H4v-7Z" />
        <path d="M14 4h6v16h-6V4Z" />
        <path d="M4 4h6v5H4V4Z" />
      </>
    ),
    queue: (
      <>
        <path d="M5 6h14" />
        <path d="M5 12h14" />
        <path d="M5 18h9" />
      </>
    ),
    repo: (
      <>
        <path d="M7 5h8l4 4v10H7V5Z" />
        <path d="M15 5v4h4" />
        <path d="M10 14h6" />
      </>
    ),
    agent: (
      <>
        <path d="M12 3v3" />
        <path d="M7 8h10a3 3 0 0 1 3 3v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-5a3 3 0 0 1 3-3Z" />
        <path d="M9 13h.01" />
        <path d="M15 13h.01" />
        <path d="M9 17h6" />
      </>
    ),
    review: (
      <>
        <path d="M5 4h14v16H5V4Z" />
        <path d="m8 12 2 2 5-5" />
        <path d="M8 18h8" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    search: (
      <>
        <path d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />
        <path d="m16 16 4 4" />
      </>
    ),
    copy: (
      <>
        <path d="M9 9h10v10H9V9Z" />
        <path d="M5 15H4V4h11v1" />
      </>
    ),
    external: (
      <>
        <path d="M10 5H5v14h14v-5" />
        <path d="M14 5h5v5" />
        <path d="m13 11 6-6" />
      </>
    ),
    branch: (
      <>
        <path d="M7 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
        <path d="M17 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
        <path d="M7 9v3a4 4 0 0 0 4 4h4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    moon: (
      <>
        <path d="M20 14.8A8.5 8.5 0 0 1 9.2 4a7.2 7.2 0 1 0 10.8 10.8Z" />
      </>
    ),
    sun: (
      <>
        <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </>
    ),
    close: (
      <>
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </>
    ),
  };

  return (
    <svg {...common} className="icon">
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {paths[name]}
      </g>
    </svg>
  );
}

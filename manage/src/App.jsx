import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { repositories, workItems as seedWorkItems } from "./data/workItems.mjs";
import { blockedRepoIds } from "./lib/repoHealth.mjs";
import {
  attentionCount,
  attentionDestination,
  buildAttentionInbox,
} from "./lib/attentionInbox.mjs";
import {
  claimWorkItem as claimWorkItemRequest,
  createBackup as createBackupRequest,
  createGithubIssue as createGithubIssueRequest,
  createInitiative as createInitiativeRequest,
  createSavedView as createSavedViewRequest,
  createWorkItem as createWorkItemRequest,
  deleteSavedView as deleteSavedViewRequest,
  fetchBackups,
  fetchInitiatives,
  fetchSavedViews,
  fetchWorkItems,
  fetchGithubReconciliation,
  fetchGithubSync,
  fetchSession,
  fetchSystemStatus,
  importGithubIssues as importGithubIssuesRequest,
  linkAllGithubWorkItems,
  linkGithubWorkItem,
  login as loginRequest,
  logout as logoutRequest,
  restoreBackup as restoreBackupRequest,
  recoverAgentRun as recoverAgentRunRequest,
  resetWorkItems as resetWorkItemsRequest,
  resolveGithubReconciliation,
  syncGithub,
  updateInitiative as updateInitiativeRequest,
  updateSavedView as updateSavedViewRequest,
  updateWorkItem,
} from "./lib/manageApi.mjs";
import {
  defaultManageViewState,
  manageViewRelativeUrl,
  parseManageViewState,
  savedBacklogState,
  viewStateFromSavedBacklog,
} from "./lib/manageViewState.mjs";
import {
  agentTaskJsonUrl,
  agentTaskMarkdownUrl,
  buildActivityFeed,
  buildMiniRepoHealth,
  formatRelativeTime,
  getRepo,
  isAgentRunVisible,
  manageOrigin,
  tokenHintForMode,
} from "./lib/manageFormat.mjs";
import { ManageShell, densityOptions } from "./components/ManageShell.jsx";
import { Icon } from "./components/Icon.jsx";
import { Metric } from "./components/workUi.jsx";
import { Composer } from "./components/Composer.jsx";
import { DestructiveActionDialog } from "./components/DestructiveActionDialog.jsx";
import { LoginScreen } from "./components/LoginScreen.jsx";
import { SavedViewControls } from "./components/SavedViewControls.jsx";
import {
  readShellPreference,
  resolveThemeAndAppearance,
  writeShellPreference,
} from "./lib/shellPreferences.mjs";
import { useManageNavigation } from "./components/useManageNavigation.mjs";
import { BacklogRoute } from "./features/backlog/BacklogRoute.jsx";
import { useBacklogController } from "./features/backlog/useBacklogController.mjs";
import { TodayOverview } from "./features/today/TodayRoute.jsx";
import { InitiativeComposer, InitiativesOverview } from "./features/initiatives/InitiativesRoute.jsx";
import { ShippedOverview } from "./features/shipped/ShippedRoute.jsx";
import { ReviewQueue } from "./features/review/ReviewRoute.jsx";
import { AgentsOverview } from "./features/agents/AgentsRoute.jsx";
import { ReposRoute, SystemStatusPanel } from "./features/repos/ReposRoute.jsx";
import { WorkPacketDetail } from "./features/packet/WorkPacketDetail.jsx";
import { AgentPromptPanel } from "./features/packet/AgentPromptPanel.jsx";

const agentSecretConfig = {
  secretName: "MANAGE_AUTH_TOKEN",
};

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
  const [themeMode, setThemeMode] = useState(() => resolveThemeAndAppearance().theme);
  const [appearanceMode, setAppearanceMode] = useState(() => resolveThemeAndAppearance().appearance);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.dataset.manageTheme = themeMode;
    document.documentElement.dataset.manageAppearance = appearanceMode;
    writeShellPreference("manage-theme", themeMode);
    writeShellPreference("manage-appearance", appearanceMode);
  }, [themeMode, appearanceMode]);

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

  return (
    <ManageApp
      onLogout={handleLogout}
      sessionMode={sessionMode}
      sessionUser={sessionInfo?.user}
      themeMode={themeMode}
      appearanceMode={appearanceMode}
      onThemeModeChange={setThemeMode}
      onAppearanceModeChange={setAppearanceMode}
    />
  );
}

function readInitialViewState() {
  if (typeof window === "undefined") {
    return defaultManageViewState;
  }

  return parseManageViewState(window.location.search);
}

function ManageApp({
  onLogout,
  sessionMode,
  sessionUser,
  themeMode,
  appearanceMode,
  onThemeModeChange,
  onAppearanceModeChange,
}) {
  const initialView = readInitialViewState();
  const historyIntentRef = useRef("replace");
  const skipUrlWriteRef = useRef(false);
  const [items, setItems] = useState(seedWorkItems);
  const [initiatives, setInitiatives] = useState([]);
  const [selectedInitiativeId, setSelectedInitiativeId] = useState("");
  const [savedViews, setSavedViews] = useState([]);
  const [savedViewWarnings, setSavedViewWarnings] = useState([]);
  const [savedViewState, setSavedViewState] = useState("idle");
  const [savedViewMessage, setSavedViewMessage] = useState("Saved views ready");
  const [appliedSavedViewId, setAppliedSavedViewId] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [showInitiativeComposer, setShowInitiativeComposer] = useState(false);
  const [destructiveAction, setDestructiveAction] = useState(null);
  const [copyState, setCopyState] = useState("idle");
  const [copyMessage, setCopyMessage] = useState("");
  const [loadState, setLoadState] = useState("loading");
  const [syncState, setSyncState] = useState("synced");
  const [syncMessage, setSyncMessage] = useState("Store synced");
  const [githubCache, setGithubCache] = useState(null);
  const [githubState, setGithubState] = useState("idle");
  const [githubMessage, setGithubMessage] = useState("GitHub cache not synced");
  const [reconciliation, setReconciliation] = useState({
    totalMergedPullRequests: 0,
    linkedMergedPullRequests: 0,
    unmatchedMergedPullRequests: [],
  });
  const [reconciliationSyncState, setReconciliationSyncState] = useState("idle");
  const [reconciliationActionState, setReconciliationActionState] = useState("idle");
  const [reconciliationMessage, setReconciliationMessage] = useState("Reconciliation ready");
  const [reconciliationAction, setReconciliationAction] = useState("");
  const [claimState, setClaimState] = useState("idle");
  const [agentRecoveryAction, setAgentRecoveryAction] = useState("");
  const [agentRecoveryMessage, setAgentRecoveryMessage] = useState("");
  const [linkState, setLinkState] = useState("idle");
  const [issueState, setIssueState] = useState("idle");
  const [issueImportState, setIssueImportState] = useState("idle");
  const [systemStatus, setSystemStatus] = useState(null);
  const [systemState, setSystemState] = useState("loading");
  const [systemMessage, setSystemMessage] = useState("Checking system");
  const [backups, setBackups] = useState([]);
  const [backupState, setBackupState] = useState("loading");
  const [backupMessage, setBackupMessage] = useState("Checking backups");
  const [densityMode, setDensityMode] = useState(() =>
    readShellPreference(
      "manage-density",
      "regular",
      densityOptions.map((option) => option.id),
    ),
  );

  const onHistoryIntent = useCallback((intent = "replace") => {
    if (intent && intent !== "silent" && intent !== "none") {
      historyIntentRef.current = intent === "push" ? "push" : "replace";
    }
  }, []);

  const backlog = useBacklogController(items, {
    initialState: initialView,
    hydrated: loadState === "ready",
    onHistoryIntent,
  });
  const { activeNav, selectNav, openPacket, openReviewPacket, applyNavigationState } = useManageNavigation({
    items,
    setSelectedKey: backlog.setSelectedKey,
    setRepoFilter: backlog.setRepoFilter,
    setStatusFilter: backlog.setStatusFilter,
    setLabelFilter: backlog.setLabelFilter,
    setQuery: backlog.setQuery,
    initialState: initialView,
    onHistoryIntent,
  });
  const {
    selectedKey,
    setSelectedKey,
    repoFilter,
    statusFilter,
    labelFilter,
    query,
    selectedItem,
    applyBacklogState,
  } = backlog;

  useEffect(() => {
    let canceled = false;

    async function loadInitialData() {
      try {
        const [workPayload, initiativePayload, githubPayload, backupPayload] = await Promise.all([
          fetchWorkItems(),
          fetchInitiatives(),
          fetchGithubSync(),
          fetchBackups(),
        ]);

        if (!canceled) {
          setItems(workPayload.workItems);
          setInitiatives(initiativePayload.initiatives || []);
          setSelectedInitiativeId(initiativePayload.initiatives?.[0]?.id || "");
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

    async function loadInitialReconciliation() {
      setReconciliationSyncState("loading");

      try {
        const reconciliationPayload = await fetchGithubReconciliation();

        if (!canceled && reconciliationPayload?.reconciliation) {
          setReconciliation(reconciliationPayload.reconciliation);
          setReconciliationSyncState("idle");
          setReconciliationMessage("Reconciliation ready");
        }
      } catch (error) {
        if (!canceled) {
          setReconciliationSyncState("failed");
          setReconciliationMessage(error.message);
        }
      }
    }

    loadInitialData();
    loadInitialReconciliation();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    refreshSystemStatus();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.density = densityMode;
    document.documentElement.dataset.manageDensity = densityMode;
    writeShellPreference("manage-density", densityMode);
  }, [densityMode]);

  const viewState = useMemo(
    () => ({
      activeNav,
      repoFilter,
      statusFilter,
      labelFilter,
      query,
      selectedKey,
    }),
    [activeNav, labelFilter, query, repoFilter, selectedKey, statusFilter],
  );

  useEffect(() => {
    if (typeof window === "undefined" || skipUrlWriteRef.current) {
      skipUrlWriteRef.current = false;
      return;
    }

    const nextUrl = manageViewRelativeUrl(window.location, viewState);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (nextUrl === currentUrl) {
      return;
    }

    if (historyIntentRef.current === "push") {
      window.history.pushState(viewState, "", nextUrl);
    } else {
      window.history.replaceState(viewState, "", nextUrl);
    }

    historyIntentRef.current = "replace";
  }, [viewState]);

  useEffect(() => {
    function onPopState() {
      const next = parseManageViewState(window.location.search);
      skipUrlWriteRef.current = true;
      applyNavigationState(next.activeNav, { history: "silent" });
      applyBacklogState({
        ...next,
        selectedKey: next.selectedKey || undefined,
      }, { history: "silent" });
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!["admin", "operator"].includes(sessionUser?.role)) {
      return undefined;
    }

    let canceled = false;

    async function loadSavedViews() {
      setSavedViewState("loading");
      setSavedViewMessage("Loading saved views");

      try {
        const payload = await fetchSavedViews();
        if (!canceled) {
          setSavedViews(payload.savedViews || []);
          setSavedViewWarnings(payload.warnings || []);
          setSavedViewState("idle");
          setSavedViewMessage((payload.savedViews || []).length > 0 ? "Saved views ready" : "No saved views yet");
        }
      } catch (error) {
        if (!canceled) {
          setSavedViewState("failed");
          setSavedViewMessage(error.message);
        }
      }
    }

    loadSavedViews();
    return () => {
      canceled = true;
    };
  }, [sessionUser?.role]);

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
  const blockedRepos = useMemo(() => blockedRepoIds(repositories, githubCache), [githubCache]);
  const nextItem = useMemo(
    () =>
      findNextWorkItem(items, {
        ...(repoFilter === "all" ? {} : { repo: repoFilter }),
        ...(labelFilter === "all" ? {} : { label: labelFilter }),
        blockedRepoIds: blockedRepos,
      }),
    [items, repoFilter, labelFilter, blockedRepos],
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

  const activeClaims = useMemo(() => items.filter(isAgentRunVisible), [items]);

  const repoAlertCount = useMemo(() => {
    const githubByRepo = new Map((githubCache?.repos || []).map((repo) => [repo.id, repo]));

    return repositories.filter((repo) => {
      const syncedRepo = githubByRepo.get(repo.id);
      const failedRuns = syncedRepo?.failedRuns ?? repo.failedRuns ?? 0;
      return failedRuns > 0 || repo.health === "blocked";
    }).length;
  }, [githubCache]);

  const attentionItems = useMemo(
    () => buildAttentionInbox({ workItems: items, reconciliation }),
    [items, reconciliation],
  );
  const doneCount = useMemo(() => items.filter((item) => item.status === "done").length, [items]);
  const navCounts = useMemo(
    () => ({
      today: attentionItems.length || null,
      backlog: stats.totalCount,
      initiatives: initiatives.filter((initiative) => initiative.status !== "complete").length || null,
      shipped: doneCount || null,
      repos: repoAlertCount || null,
      agents: activeClaims.length || null,
      review: stats.reviewCount || null,
    }),
    [activeClaims.length, attentionItems.length, doneCount, initiatives, repoAlertCount, stats.reviewCount, stats.totalCount],
  );
  const recentAgentActivity = useMemo(() => buildActivityFeed(items, 5), [items]);
  const miniRepoHealth = useMemo(() => buildMiniRepoHealth(githubCache), [githubCache]);
  const showWorkbench = activeNav === "backlog";
  const reviewItems = useMemo(() => items.filter((item) => item.status === "needs_review"), [items]);

  function applyViewState(next, { history = "replace" } = {}) {
    applyNavigationState(next.activeNav, { history: "silent" });
    applyBacklogState(next, { history });
  }

  const canManageSavedViews = ["admin", "operator"].includes(sessionUser?.role);
  const currentSavedState = savedBacklogState(viewState);
  const matchingSavedView = savedViews.find((view) =>
    view.state.repo === currentSavedState.repo
    && view.state.status === currentSavedState.status
    && view.state.label === currentSavedState.label
    && view.state.query === currentSavedState.query,
  );
  const activeSavedViewId = matchingSavedView?.id || "";
  const updateTargetId = appliedSavedViewId && savedViews.some((view) => view.id === appliedSavedViewId)
    ? appliedSavedViewId
    : activeSavedViewId;

  function applySavedView(id) {
    const view = savedViews.find((candidate) => candidate.id === id);

    if (!view) {
      setAppliedSavedViewId("");
      return;
    }

    applyViewState(viewStateFromSavedBacklog(view.state, viewState), { history: "push" });
    setAppliedSavedViewId(view.id);
  }

  async function refreshSavedViews(nextViews, warnings = []) {
    setSavedViews(nextViews);
    setSavedViewWarnings(warnings);
    setSavedViewState("idle");
    setSavedViewMessage(nextViews.length > 0 ? "Saved views ready" : "No saved views yet");
  }

  async function handleCreateSavedView(name) {
    setSavedViewState("saving");
    setSavedViewMessage("Saving view");

    try {
      const payload = await createSavedViewRequest(
        { name, state: currentSavedState },
        { idempotencyKey: globalThis.crypto?.randomUUID?.() },
      );
      const listed = await fetchSavedViews();
      await refreshSavedViews(listed.savedViews || [payload.savedView], listed.warnings || []);
      setAppliedSavedViewId(payload.savedView.id);
      setSavedViewMessage(`Saved “${payload.savedView.name}”`);
      return true;
    } catch (error) {
      setSavedViewState("failed");
      setSavedViewMessage(error.message);
      return false;
    }
  }

  async function handleUpdateSavedView(id) {
    const target = savedViews.find((view) => view.id === id);

    if (!target) {
      return false;
    }

    setSavedViewState("saving");
    setSavedViewMessage("Updating view");

    try {
      await updateSavedViewRequest(id, { state: currentSavedState, expectedRevision: target.revision });
      const listed = await fetchSavedViews();
      await refreshSavedViews(listed.savedViews || [], listed.warnings || []);
      setAppliedSavedViewId(id);
      setSavedViewMessage(`Updated “${target.name}”`);
      return true;
    } catch (error) {
      setSavedViewState("failed");
      setSavedViewMessage(error.message);
      return false;
    }
  }

  async function handleRenameSavedView(id, name) {
    const target = savedViews.find((view) => view.id === id);

    if (!target) {
      return false;
    }

    setSavedViewState("saving");
    setSavedViewMessage("Renaming view");

    try {
      await updateSavedViewRequest(id, { name, expectedRevision: target.revision });
      const listed = await fetchSavedViews();
      await refreshSavedViews(listed.savedViews || [], listed.warnings || []);
      setAppliedSavedViewId(id);
      setSavedViewMessage(`Renamed to “${name.trim()}”`);
      return true;
    } catch (error) {
      setSavedViewState("failed");
      setSavedViewMessage(error.message);
      return false;
    }
  }

  async function handleDeleteSavedView(id) {
    const target = savedViews.find((view) => view.id === id);

    if (!target) {
      return false;
    }

    setSavedViewState("saving");
    setSavedViewMessage("Deleting view");

    try {
      await deleteSavedViewRequest(id, target.revision);
      const listed = await fetchSavedViews();
      await refreshSavedViews(listed.savedViews || [], listed.warnings || []);
      if (appliedSavedViewId === id) {
        setAppliedSavedViewId("");
      }
      setSavedViewMessage(`Deleted “${target.name}”`);
      return true;
    } catch (error) {
      setSavedViewState("failed");
      setSavedViewMessage(error.message);
      return false;
    }
  }

  function openAttentionDestination(attention) {
    const destination = attentionDestination(attention);

    if (destination === "review") {
      openReviewPacket(attention.packetKey);
      return;
    }

    if (destination === "agents") {
      selectNav("agents");
      return;
    }

    if (destination === "repos") {
      selectNav("repos");
      return;
    }

    openPacket(attention.packetKey);
  }

  async function actOnAttention(attention) {
    const workItem = items.find((item) => item.key === attention.packetKey);

    if (attention.action.kind === "agent_recovery" && workItem) {
      await recoverRun(workItem, attention.action.recovery);
      return;
    }

    if (attention.action.kind === "link_merge") {
      await reconcileMergedPull("link", attention.pullRequest, attention.packetKey);
      return;
    }

    if (attention.action.kind === "create_follow_up") {
      await reconcileMergedPull("follow_up", attention.pullRequest);
      return;
    }

    if (attention.action.kind === "open_review" || attention.primaryCategory === "handoff" || attention.primaryCategory === "review") {
      openReviewPacket(attention.packetKey);
      return;
    }

    openAttentionDestination(attention);
  }

  function replaceWorkItem(workItem) {
    setItems((currentItems) => currentItems.map((item) => (item.key === workItem.key ? workItem : item)));
    setSelectedKey(workItem.key);
  }

  function upsertWorkItem(workItem) {
    setItems((currentItems) => {
      const exists = currentItems.some((item) => item.key === workItem.key);
      return exists
        ? currentItems.map((item) => (item.key === workItem.key ? workItem : item))
        : [workItem, ...currentItems];
    });
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
    const shouldRestore = window.confirm(`Restore Agent Backlog from backup ${snapshot.id}? Current state will be snapshotted first.`);

    if (!shouldRestore) {
      return;
    }

    setBackupState("restoring");
    setBackupMessage(`Restoring ${snapshot.id}`);

    try {
      const payload = await restoreBackupRequest(snapshot.id);
      setItems(payload.workItems);
      setInitiatives(payload.initiatives || []);
      setSelectedInitiativeId(payload.initiatives?.[0]?.id || "");
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
      const payload = await updateWorkItem(key, {
        ...updates,
        expectedRevision: targetItem.revision,
      });
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
        expectedRevision: item.revision,
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

  async function recoverRun(item, action) {
    if (!item || action === "open_context") {
      return;
    }

    const actionKey = `${item.key}:${action}`;
    const pastTense = action === "extend" ? "Extended" : `${action[0].toUpperCase()}${action.slice(1)}d`;
    setAgentRecoveryAction(actionKey);
    setAgentRecoveryMessage(`${action[0].toUpperCase()}${action.slice(1)} ${item.key}`);
    setSyncState("saving");
    setSyncMessage(`${action[0].toUpperCase()}${action.slice(1)} ${item.key}`);

    try {
      const payload = await recoverAgentRunRequest(item.key, {
        action,
        agent: item.claimedBy || item.agent || "Codex",
        agentRunId: item.agentRunId || "",
        expectedRevision: item.revision,
      });
      if (payload.workItems) {
        setItems(payload.workItems);
      } else {
        replaceWorkItem(payload.workItem);
      }
      setSyncState("synced");
      setSyncMessage(`${pastTense} ${payload.workItem.key}`);
      setAgentRecoveryMessage(
        action === "extend"
          ? `Extended ${item.key}`
          : action === "reclaim"
            ? `Reclaimed ${item.key}`
            : `Released ${item.key} to the ready queue`,
      );
    } catch (error) {
      setSyncState("failed");
      setSyncMessage(error.message);
      setAgentRecoveryMessage(error.message);
    } finally {
      setAgentRecoveryAction("");
    }
  }

  async function refreshReviewEvidence(key) {
    setLinkState("linking");
    setGithubState("syncing");
    setGithubMessage(`Refreshing delivery evidence for ${key}`);

    try {
      const syncPayload = await syncGithub();
      setGithubCache(syncPayload.github);
      const payload = await linkGithubWorkItem(key, {
        expectedRevision: items.find((item) => item.key === key)?.revision,
      });
      setItems(payload.workItems);
      setLinkState("idle");
      setGithubState("idle");
      setGithubMessage(
        githubMatchCount(payload.workItem) > 0
          ? `Delivery evidence refreshed for ${key}`
          : `No GitHub delivery evidence found for ${key}`,
      );
      return true;
    } catch (error) {
      setLinkState("failed");
      setGithubState("failed");
      setGithubMessage(error.message);
      return false;
    }
  }

  async function linkSelectedGithub() {
    setLinkState("linking");
    setGithubState("syncing");
    setGithubMessage(`Linking GitHub activity for ${selectedItem.key}`);

    try {
      const payload = await linkGithubWorkItem(selectedItem.key, {
        expectedRevision: selectedItem.revision,
      });
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
      const payload = await createGithubIssueRequest(selectedItem.key, {
        expectedRevision: selectedItem.revision,
      });
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
      return true;
    } catch (error) {
      setSyncState("failed");
      setSyncMessage(error.message);
      return false;
    }
  }

  async function createInitiative(payload) {
    setSyncState("saving");
    setSyncMessage("Creating initiative");

    try {
      const result = await createInitiativeRequest(payload);
      setInitiatives(result.initiatives);
      setSelectedInitiativeId(result.initiative.id);
      setShowInitiativeComposer(false);
      setSyncState("synced");
      setSyncMessage("Store synced");
      return true;
    } catch (error) {
      setSyncState("failed");
      setSyncMessage(error.message);
      return false;
    }
  }

  async function updateInitiative(id, updates) {
    const previous = initiatives;
    setInitiatives((current) => current.map((initiative) => (
      initiative.id === id ? { ...initiative, ...updates, updatedAt: new Date().toISOString() } : initiative
    )));
    setSyncState("saving");
    setSyncMessage("Saving initiative");

    try {
      const result = await updateInitiativeRequest(id, updates);
      setInitiatives(result.initiatives);
      setSyncState("synced");
      setSyncMessage("Store synced");
      return true;
    } catch (error) {
      setInitiatives(previous);
      setSyncState("failed");
      setSyncMessage(error.message);
      return false;
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

  function requestResetStore() {
    setDestructiveAction({
      id: "reset-store",
      title: "Reset backlog store",
      description: "This restores the seed demo packets and clears operator-created work.",
      confirmation: "RESET MANAGE",
      actionLabel: "Reset store",
    });
  }

  async function confirmDestructiveAction(confirmation) {
    setSyncState("saving");
    setSyncMessage("Resetting store");

    try {
      const payload = await resetWorkItemsRequest(confirmation);
      setItems(payload.workItems);
      setInitiatives(payload.initiatives || []);
      setSelectedInitiativeId("");
      setSelectedKey("TASK-101");
      setDestructiveAction(null);
      setSyncState("synced");
      setSyncMessage("Seed backlog restored");
      return true;
    } catch (error) {
      setSyncState("failed");
      setSyncMessage(error.message);
      return false;
    }
  }

  async function runGithubSync({ mock = false } = {}) {
    setGithubState("syncing");
    setReconciliationSyncState("loading");
    setReconciliationActionState("idle");
    setGithubMessage(mock ? "Refreshing mock GitHub cache" : "Syncing GitHub with gh");

    try {
      const payload = await syncGithub({ mock });
      const reconciliationPayload = await fetchGithubReconciliation();
      setGithubCache(payload.github);
      setReconciliation(reconciliationPayload.reconciliation);
      setGithubState("idle");
      setReconciliationSyncState("idle");
      setReconciliationMessage("Reconciliation refreshed");
      const freshness = payload.github.syncState === "current" || payload.github.source === "mock"
        ? "fresh"
        : "stale";
      setGithubMessage(
        payload.github.source === "gh"
          ? `GitHub sync ${freshness}`
          : payload.github.source === "github-token"
            ? `GitHub sync ${freshness}`
            : `Mock GitHub cache ${freshness}`,
      );
      await refreshSystemStatus();
    } catch (error) {
      setGithubState("failed");
      setReconciliationSyncState("failed");
      setReconciliationMessage(error.message);
      setGithubMessage(error.message);
    }
  }

  async function reconcileMergedPull(action, pullRequest, workItemKey = "") {
    const actionKey = `${action}:${pullRequest.id}`;
    setReconciliationAction(actionKey);
    setReconciliationActionState("saving");
    setReconciliationMessage(action === "link" ? `Linking ${workItemKey}` : "Creating follow-up packet");
    const currentItem = workItemKey ? items.find((item) => item.key === workItemKey) : null;

    if (workItemKey && !Number.isFinite(currentItem?.revision)) {
      setReconciliationActionState("failed");
      setReconciliationMessage(`Refresh ${workItemKey} before linking the pull request.`);
      setReconciliationAction("");
      return;
    }

    try {
      const payload = await resolveGithubReconciliation({
        action,
        pullRequestUrl: pullRequest.url,
        ...(workItemKey ? { workItemKey, expectedRevision: currentItem.revision } : {}),
        idempotencyKey: `reconcile:${action}:${pullRequest.id}:${currentItem?.revision ?? "create"}`,
      });
      upsertWorkItem(payload.workItem);
      setReconciliation(payload.reconciliation);
      setReconciliationActionState("idle");
      setReconciliationMessage(
        action === "link"
          ? `Linked ${payload.workItem.key} to ${pullRequest.repoId} #${pullRequest.number}`
          : payload.created
            ? `Created ${payload.workItem.key} for ${pullRequest.repoId} #${pullRequest.number}`
            : `${pullRequest.repoId} #${pullRequest.number} was already reconciled`,
      );
    } catch (error) {
      setReconciliationActionState("failed");
      setReconciliationMessage(error.message);
    } finally {
      setReconciliationAction("");
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
    <ManageShell
      activeNav={activeNav}
      navCounts={navCounts}
      nextItem={nextItem}
      densityMode={densityMode}
      themeMode={themeMode}
      appearanceMode={appearanceMode}
      sessionMode={sessionMode}
      sessionUser={sessionUser}
      syncState={syncState}
      syncMessage={syncMessage}
      loadState={loadState}
      packets={items}
      onNavigate={selectNav}
      onOpenPacket={openPacket}
      onCreate={() => (activeNav === "initiatives" ? setShowInitiativeComposer(true) : setShowComposer(true))}
      onCreatePacket={() => setShowComposer(true)}
      onCreateInitiative={() => setShowInitiativeComposer(true)}
      onDensityModeChange={setDensityMode}
      onThemeModeChange={onThemeModeChange}
      onAppearanceModeChange={onAppearanceModeChange}
      onReset={requestResetStore}
      onLogout={onLogout}
      IconComponent={Icon}
      overlays={(
        <>
          {showComposer ? <Composer onClose={() => setShowComposer(false)} onCreate={createWorkItem} /> : null}
          {showInitiativeComposer ? (
            <InitiativeComposer onClose={() => setShowInitiativeComposer(false)} onCreate={createInitiative} items={items} />
          ) : null}
          {destructiveAction ? (
            <DestructiveActionDialog
              action={destructiveAction}
              onClose={() => setDestructiveAction(null)}
              onConfirm={confirmDestructiveAction}
            />
          ) : null}
        </>
      )}
    >
        {activeNav === "today" ? (
          <TodayOverview
            stats={stats}
            nextItem={nextItem}
            activity={recentAgentActivity}
            repoHealthRows={miniRepoHealth}
            activeClaims={activeClaims}
            attentionItems={attentionItems}
            loadState={loadState}
            reconciliationSyncState={reconciliationSyncState}
            reconciliationActionState={reconciliationActionState}
            reconciliationMessage={reconciliationMessage}
            reconciliationAction={reconciliationAction}
            agentRecoveryAction={agentRecoveryAction}
            agentRecoveryMessage={agentRecoveryMessage}
            onAttentionAction={actOnAttention}
            onOpenAttention={openAttentionDestination}
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

            <BacklogRoute
              items={items}
              controller={backlog}
              IconComponent={Icon}
              formatRelativeTime={formatRelativeTime}
              savedViewControls={canManageSavedViews ? (
                <SavedViewControls
                  savedViews={savedViews}
                  activeId={activeSavedViewId}
                  updateTargetId={updateTargetId}
                  state={savedViewState}
                  message={[savedViewMessage, ...savedViewWarnings].filter(Boolean).join(" ")}
                  onApply={applySavedView}
                  onCreate={handleCreateSavedView}
                  onUpdate={handleUpdateSavedView}
                  onRename={handleRenameSavedView}
                  onDelete={handleDeleteSavedView}
                  onRetry={() => {
                    setSavedViewState("loading");
                    fetchSavedViews()
                      .then((payload) => refreshSavedViews(payload.savedViews || [], payload.warnings || []))
                      .catch((error) => {
                        setSavedViewState("failed");
                        setSavedViewMessage(error.message);
                      });
                  }}
                />
              ) : null}
              detail={(
          <section className="detail-panel packet-workspace-shell" aria-label="Selected work packet">
            <WorkPacketDetail
              item={selectedItem}
              selectedPrompt={selectedPrompt}
              selectedTaskUrl={selectedTaskUrl}
              selectedTaskJsonUrl={selectedTaskJsonUrl}
              onCopyPrompt={copyPrompt}
              onCopyText={copyText}
              onUpdate={updateSelected}
              onClaim={claimSelected}
              onLinkGithub={linkSelectedGithub}
              onCreateGithubIssue={createSelectedGithubIssue}
              onDuplicate={duplicateSelected}
              onRefreshEvidence={() => refreshReviewEvidence(selectedItem.key)}
              claimState={claimState}
              linkState={linkState}
              issueState={issueState}
              githubState={githubState}
            />
          </section>
              )}
              agent={(
          <AgentPromptPanel
            selectedItem={selectedItem}
            selectedPrompt={selectedPrompt}
            selectedTaskUrl={selectedTaskUrl}
            selectedTaskJsonUrl={selectedTaskJsonUrl}
            selectedRepoSlug={selectedRepoSlug}
            secretName={agentSecretConfig.secretName}
            copyState={copyState}
            copyMessage={copyMessage}
            onCopyPrompt={copyPrompt}
            onCopyText={copyText}
            codexPickupCommand={codexPickupCommand}
            claudePickupCommand={claudePickupCommand}
            claimCommand={claimCommand}
            progressCommand={progressCommand}
            reviewCommand={reviewCommand}
            agentRunbook={agentRunbook}
            tokenBootstrapCommand={tokenBootstrapCommand}
            claimPowerShellCommand={claimPowerShellCommand}
            progressPowerShellCommand={progressPowerShellCommand}
            reviewPowerShellCommand={reviewPowerShellCommand}
            repoHandoffCommand={repoHandoffCommand}
            prReadyPowerShellCommand={prReadyPowerShellCommand}
            reviewPollPowerShellCommand={reviewPollPowerShellCommand}
            visualQaFallbackCommand={visualQaFallbackCommand}
            postMergeCloseoutCommand={postMergeCloseoutCommand}
            donePowerShellCommand={donePowerShellCommand}
          />
              )}
            />
          </>
        ) : null}

        {activeNav === "review" ? (
          <ReviewQueue
            items={reviewItems}
            selectedKey={selectedKey}
            onSelectPacket={(key) => setSelectedKey(key, { history: "replace" })}
            onUpdatePacket={updatePacket}
            onOpenPacket={openPacket}
            onRefreshEvidence={refreshReviewEvidence}
            githubState={githubState}
          />
        ) : null}

        {activeNav === "initiatives" ? (
          <InitiativesOverview
            initiatives={initiatives}
            items={items}
            githubCache={githubCache}
            githubState={githubState}
            githubMessage={githubMessage}
            selectedId={selectedInitiativeId}
            onSelect={setSelectedInitiativeId}
            onUpdate={updateInitiative}
            onOpenPacket={openPacket}
            onSync={() => runGithubSync()}
          />
        ) : null}

        {activeNav === "shipped" ? (
          <ShippedOverview
            items={items}
            githubCache={githubCache}
            githubState={githubState}
            githubMessage={githubMessage}
            onOpenPacket={openPacket}
            onSync={() => runGithubSync()}
            onMockSync={() => runGithubSync({ mock: true })}
          />
        ) : null}

        {activeNav === "repos" ? (
          <ReposRoute
            systemStatus={systemStatus}
            systemState={systemState}
            systemMessage={systemMessage}
            onRefreshStatus={refreshSystemStatus}
            repositories={repositories}
            githubCache={githubCache}
            githubState={githubState}
            githubMessage={githubMessage}
            reconciliation={reconciliation}
            reconciliationSyncState={reconciliationSyncState}
            reconciliationActionState={reconciliationActionState}
            reconciliationMessage={reconciliationMessage}
            reconciliationAction={reconciliationAction}
            onSync={() => runGithubSync()}
            onMockSync={() => runGithubSync({ mock: true })}
            onLinkAll={linkAllGithub}
            onImportIssues={importGithubIssuesFromCache}
            onLinkMerge={(pullRequest, key) => reconcileMergedPull("link", pullRequest, key)}
            onCreateFollowUp={(pullRequest) => reconcileMergedPull("follow_up", pullRequest)}
            onOpenPacket={openPacket}
            linkState={linkState}
            issueImportState={issueImportState}
            backups={backups}
            backupState={backupState}
            backupMessage={backupMessage}
            onRefreshBackups={refreshBackups}
            onCreateBackup={createBackupNow}
            onRestoreBackup={restoreBackupSnapshot}
          />
        ) : null}

        {activeNav === "agents" ? (
          <AgentsOverview items={items} activeClaims={activeClaims} onOpenPacket={openPacket} onRecoverRun={recoverRun} />
        ) : null}
    </ManageShell>
  );
}


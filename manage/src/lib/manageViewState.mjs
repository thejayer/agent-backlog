import { repositories } from "../data/workItems.mjs";

const supportedDestinations = new Set([
  "today",
  "backlog",
  "initiatives",
  "shipped",
  "repos",
  "agents",
  "review",
]);
const supportedRepos = new Set(["all", ...repositories.map((repo) => repo.id)]);
const supportedStatuses = new Set([
  "all",
  "draft",
  "ready_for_agent",
  "claimed",
  "in_progress",
  "needs_review",
  "done",
  "blocked",
]);

export const defaultManageViewState = Object.freeze({
  activeNav: "backlog",
  repoFilter: "all",
  statusFilter: "all",
  labelFilter: "all",
  query: "",
  selectedKey: "",
});

export function getPacketKeyPrefix() {
  const cleaned = String(
    (typeof process !== "undefined" && process.env?.MANAGE_PACKET_KEY_PREFIX) || "TASK",
  )
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  return cleaned || "TASK";
}

export function packetKeyPattern(prefix = getPacketKeyPrefix()) {
  return new RegExp(`^${prefix}-\\d+$`);
}

function bounded(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizedLabel(value) {
  const label = bounded(value, 64).toLowerCase();
  return label === "all" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(label) ? label : "all";
}

export function parseManageViewState(search = "", { availableLabels, packetKeyPrefix } = {}) {
  const params = search instanceof URLSearchParams ? new URLSearchParams(search) : new URLSearchParams(String(search || ""));
  const activeNav = bounded(params.get("view"), 40);
  const repoFilter = bounded(params.get("repo"), 80);
  const statusFilter = bounded(params.get("status"), 40);
  const labelFilter = normalizedLabel(params.get("label") || "all");
  const selectedKey = bounded(params.get("packet"), 20).toUpperCase();
  const allowedLabels = availableLabels ? new Set(availableLabels) : null;
  const keyPattern = packetKeyPattern(packetKeyPrefix);

  return {
    activeNav: supportedDestinations.has(activeNav) ? activeNav : defaultManageViewState.activeNav,
    repoFilter: supportedRepos.has(repoFilter) ? repoFilter : defaultManageViewState.repoFilter,
    statusFilter: supportedStatuses.has(statusFilter) ? statusFilter : defaultManageViewState.statusFilter,
    labelFilter: labelFilter !== "all" && allowedLabels && !allowedLabels.has(labelFilter) ? "all" : labelFilter,
    query: bounded(params.get("q"), 240),
    selectedKey: keyPattern.test(selectedKey) ? selectedKey : "",
  };
}

function setOrDelete(params, key, value, fallback = "") {
  if (!value || value === fallback) params.delete(key);
  else params.set(key, value);
}

export function serializeManageViewState(search = "", state = defaultManageViewState) {
  const params = search instanceof URLSearchParams ? new URLSearchParams(search) : new URLSearchParams(String(search || ""));
  setOrDelete(params, "view", state.activeNav, defaultManageViewState.activeNav);
  setOrDelete(params, "repo", state.repoFilter, defaultManageViewState.repoFilter);
  setOrDelete(params, "status", state.statusFilter, defaultManageViewState.statusFilter);
  setOrDelete(params, "label", state.labelFilter, defaultManageViewState.labelFilter);
  setOrDelete(params, "q", state.query, defaultManageViewState.query);
  setOrDelete(params, "packet", state.selectedKey, defaultManageViewState.selectedKey);
  return params;
}

export function manageViewRelativeUrl(locationLike, state) {
  const params = serializeManageViewState(locationLike?.search || "", state);
  const query = params.toString();
  return `${locationLike?.pathname || "/"}${query ? `?${query}` : ""}${locationLike?.hash || ""}`;
}

export function savedBacklogState(state) {
  return {
    version: 1,
    repo: state.repoFilter || "all",
    status: state.statusFilter || "all",
    label: state.labelFilter || "all",
    query: state.query || "",
  };
}

export function viewStateFromSavedBacklog(savedState, currentState = defaultManageViewState) {
  const repoFilter = bounded(savedState?.repo, 80);
  const statusFilter = bounded(savedState?.status, 40);

  return {
    ...currentState,
    activeNav: "backlog",
    repoFilter: supportedRepos.has(repoFilter) ? repoFilter : defaultManageViewState.repoFilter,
    statusFilter: supportedStatuses.has(statusFilter) ? statusFilter : defaultManageViewState.statusFilter,
    labelFilter: normalizedLabel(savedState?.label || defaultManageViewState.labelFilter),
    query: savedState?.query || "",
    selectedKey: "",
  };
}

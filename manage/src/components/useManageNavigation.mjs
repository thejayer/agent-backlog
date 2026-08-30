import { useCallback, useState } from "react";

export function navigationIntent(navId, items = []) {
  if (navId === "review") {
    return {
      activeNav: "review",
      repoFilter: "all",
      statusFilter: "needs_review",
      labelFilter: "all",
      selectedKey: items.find((item) => item.status === "needs_review")?.key,
    };
  }

  if (navId === "backlog") {
    return { activeNav: "backlog", statusFilter: "all", labelFilter: "all" };
  }

  return { activeNav: navId };
}

export function useManageNavigation({
  items,
  setSelectedKey,
  setRepoFilter,
  setStatusFilter,
  setLabelFilter,
  setQuery,
  initialState = {},
  onHistoryIntent = () => {},
}) {
  const [activeNav, setActiveNav] = useState(initialState.activeNav || "backlog");

  function applyIntent(intent, { history = "push" } = {}) {
    if (history !== "silent") onHistoryIntent(history);
    setActiveNav(intent.activeNav);
    if (intent.repoFilter !== undefined) setRepoFilter(intent.repoFilter, { history: "silent" });
    if (intent.statusFilter !== undefined) setStatusFilter(intent.statusFilter, { history: "silent" });
    if (intent.labelFilter !== undefined) setLabelFilter(intent.labelFilter, { history: "silent" });
    if (intent.query !== undefined) setQuery(intent.query, { history: "silent" });
    if (intent.selectedKey !== undefined) setSelectedKey(intent.selectedKey, { history: "silent" });
  }

  function selectNav(navId) {
    applyIntent(navigationIntent(navId, items));
  }

  function openPacket(key) {
    if (!key) return;
    onHistoryIntent("push");
    setRepoFilter("all", { history: "silent" });
    setStatusFilter("all", { history: "silent" });
    setLabelFilter("all", { history: "silent" });
    setQuery("", { history: "silent" });
    setSelectedKey(key, { history: "silent" });
    setActiveNav("backlog");
  }

  function openReviewPacket(key) {
    if (!key) return;
    onHistoryIntent("push");
    setSelectedKey(key, { history: "silent" });
    setStatusFilter("needs_review", { history: "silent" });
    setRepoFilter("all", { history: "silent" });
    setLabelFilter("all", { history: "silent" });
    setQuery("", { history: "silent" });
    setActiveNav("review");
  }

  const applyNavigationState = useCallback((nextActiveNav, { history = "none" } = {}) => {
    if (history !== "silent" && history !== "none") onHistoryIntent(history);
    setActiveNav(nextActiveNav || "backlog");
  }, [onHistoryIntent]);

  return { activeNav, selectNav, openPacket, openReviewPacket, applyNavigationState };
}

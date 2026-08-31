import { useCallback, useEffect, useMemo, useState } from "react";
import { labelOptions, priorityOptions } from "../../data/workItems.mjs";
import { readinessScore } from "../../lib/agentPrompt.mjs";

export function normalizeLabel(value) {
  return String(value || "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function itemLabels(item) {
  const labels = Array.isArray(item?.labels) ? item.labels : String(item?.labels || "").split(/[,\n]/);
  return [...new Set(labels.map(normalizeLabel).filter(Boolean))];
}

export function formatLabel(labelId) {
  return labelOptions.find((label) => label.id === labelId)?.label || labelId;
}

export function filterBacklogItems(items, { query = "", repoFilter = "all", statusFilter = "all", labelFilter = "all" } = {}) {
  const normalizedQuery = query.trim().toLowerCase();

  return items
    .filter((item) => (repoFilter === "all" ? true : item.repo === repoFilter))
    .filter((item) => (statusFilter === "all" ? true : item.status === statusFilter))
    .filter((item) => (labelFilter === "all" ? true : itemLabels(item).includes(labelFilter)))
    .filter((item) => {
      if (!normalizedQuery) return true;
      return `${item.key} ${item.title} ${item.project} ${item.repo} ${item.summary} ${itemLabels(item).join(" ")}`
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .sort((a, b) => {
      const priorityA = priorityOptions.find((priority) => priority.id === a.priority)?.rank || 99;
      const priorityB = priorityOptions.find((priority) => priority.id === b.priority)?.rank || 99;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return readinessScore(b) - readinessScore(a);
    });
}

export function availableBacklogLabels(items) {
  const labels = new Set(labelOptions.map((label) => label.id));
  for (const item of items) {
    for (const label of itemLabels(item)) labels.add(label);
  }
  return [...labels].sort((a, b) => formatLabel(a).localeCompare(formatLabel(b)));
}

export const emptyWorkItem = Object.freeze({
  key: "",
  title: "",
  repo: "",
  status: "draft",
  priority: "medium",
  labels: [],
  acceptanceCriteria: [],
  relevantFiles: [],
  relevantUrls: [],
  implementationNotes: [],
  testCommands: [],
  agentEvents: [],
});

export function resolveSelectedWorkItem(items, filteredItems, selectedKey) {
  return filteredItems.find((item) => item.key === selectedKey)
    || items.find((item) => item.key === selectedKey)
    || filteredItems[0]
    || emptyWorkItem;
}

export function useBacklogController(items, { initialState = {}, hydrated = true, onHistoryIntent = () => {} } = {}) {
  const [selectedKey, setSelectedKeyState] = useState(initialState.selectedKey || "");
  const [repoFilter, setRepoFilterState] = useState(initialState.repoFilter || "all");
  const [statusFilter, setStatusFilterState] = useState(initialState.statusFilter || "all");
  const [labelFilter, setLabelFilterState] = useState(initialState.labelFilter || "all");
  const [query, setQueryState] = useState(initialState.query || "");

  const filteredItems = useMemo(
    () => filterBacklogItems(items, { query, repoFilter, statusFilter, labelFilter }),
    [items, query, repoFilter, statusFilter, labelFilter],
  );
  const availableLabels = useMemo(() => availableBacklogLabels(items), [items]);

  useEffect(() => {
    if (!hydrated) return;
    const nextSelectedKey = filteredItems.some((item) => item.key === selectedKey)
      ? selectedKey
      : items.some((item) => item.key === selectedKey)
        ? selectedKey
        : filteredItems[0]?.key || items[0]?.key || "";

    if (nextSelectedKey !== selectedKey) {
      onHistoryIntent("replace");
      setSelectedKeyState(nextSelectedKey);
    }
  }, [filteredItems, hydrated, items, onHistoryIntent, selectedKey]);

  const selectedItem = useMemo(
    () => resolveSelectedWorkItem(items, filteredItems, selectedKey),
    [filteredItems, items, selectedKey],
  );

  function setWithHistory(setter, value, history) {
    if (history !== "silent") onHistoryIntent(history);
    setter(value);
  }

  function setSelectedKey(value, { history = "push" } = {}) {
    setWithHistory(setSelectedKeyState, value, history);
  }

  function setRepoFilter(value, { history = "push" } = {}) {
    setWithHistory(setRepoFilterState, value, history);
  }

  function setStatusFilter(value, { history = "push" } = {}) {
    setWithHistory(setStatusFilterState, value, history);
  }

  function setLabelFilter(value, { history = "push" } = {}) {
    setWithHistory(setLabelFilterState, value, history);
  }

  function setQuery(value, { history = "replace" } = {}) {
    setWithHistory(setQueryState, value, history);
  }

  const applyBacklogState = useCallback((state = {}, { history = "replace" } = {}) => {
    if (history !== "silent") onHistoryIntent(history);
    setRepoFilterState(state.repoFilter || "all");
    setStatusFilterState(state.statusFilter || "all");
    setLabelFilterState(state.labelFilter || "all");
    setQueryState(state.query || "");
    if (state.selectedKey !== undefined) {
      setSelectedKeyState(state.selectedKey || "");
    }
  }, [onHistoryIntent]);

  return {
    selectedKey,
    setSelectedKey,
    repoFilter,
    setRepoFilter,
    statusFilter,
    setStatusFilter,
    labelFilter,
    setLabelFilter,
    query,
    setQuery,
    filteredItems,
    availableLabels,
    selectedItem,
    applyBacklogState,
  };
}

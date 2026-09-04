export const navItems = [
  { id: "today", label: "Today", icon: "dashboard" },
  { id: "backlog", label: "Backlog", icon: "queue" },
  { id: "initiatives", label: "Initiatives", icon: "initiative" },
  { id: "shipped", label: "Shipped", icon: "calendar" },
  { id: "repos", label: "Repos", icon: "repo" },
  { id: "agents", label: "Agents", icon: "agent" },
  { id: "review", label: "Review", icon: "review" },
];

export const navGroups = [
  { label: "Focus", items: ["today", "backlog"] },
  { label: "Plan", items: ["initiatives"] },
  { label: "Operate", items: ["agents", "repos"] },
  { label: "Review", items: ["review", "shipped"] },
];

export const commandActions = [
  { id: "new-packet", title: "New packet", meta: "Create a work packet", icon: "plus" },
  { id: "new-initiative", title: "New initiative", meta: "Create an initiative", icon: "initiative" },
];

const TASK_KEY = /^TASK-\d+$/;

function matchesQuery(query, ...parts) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return parts.join(" ").toLowerCase().includes(normalized);
}

export function groupedNavItems(items = navItems, groups = navGroups) {
  return groups.map((group) => ({
    label: group.label,
    items: group.items
      .map((itemId) => items.find((item) => item.id === itemId))
      .filter(Boolean),
  }));
}

export function buildCommandResults({
  query = "",
  views = navItems,
  viewCopy = {},
  packets = [],
  actions = commandActions,
} = {}) {
  const navResults = views
    .filter((item) =>
      matchesQuery(query, item.label, viewCopy[item.id]?.title, viewCopy[item.id]?.description),
    )
    .map((item) => ({
      type: "view",
      id: item.id,
      title: item.label,
      meta: viewCopy[item.id]?.description || "Open view",
      icon: item.icon,
    }));

  const actionResults = actions
    .filter((action) => matchesQuery(query, action.title, action.meta))
    .map((action) => ({
      type: "action",
      id: action.id,
      title: action.title,
      meta: action.meta,
      icon: action.icon || "plus",
    }));

  const packetResults = packets
    .filter((item) => TASK_KEY.test(item.key))
    .filter((item) => matchesQuery(query, item.key, item.title, item.repo))
    .slice(0, 8)
    .map((item) => ({
      type: "packet",
      id: item.key,
      title: item.title,
      meta: `${item.key} · ${item.repo}`,
      icon: "queue",
    }));

  return [...navResults, ...actionResults, ...packetResults].slice(0, 12);
}

export function commandShortcutLabel(userAgent = "") {
  return /Mac|iPhone|iPad/i.test(userAgent) ? "⌘K" : "Ctrl+K";
}

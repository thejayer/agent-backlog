import { describe, expect, it } from "vitest";
import {
  buildCommandResults,
  commandActions,
  commandShortcutLabel,
  groupedNavItems,
  navGroups,
  navItems,
} from "./shellChrome.mjs";

const viewCopy = {
  today: { description: "Packets that need a human now." },
  backlog: { description: "Create work packets for coding agents." },
  review: { description: "Inspect packets waiting for sign-off." },
};

describe("groupedNavItems", () => {
  it("maps existing views onto Focus / Plan / Operate / Review", () => {
    const grouped = groupedNavItems();
    expect(grouped.map((group) => group.label)).toEqual(["Focus", "Plan", "Operate", "Review"]);
    expect(grouped.find((group) => group.label === "Focus").items.map((item) => item.id)).toEqual(["today", "backlog"]);
    expect(grouped.find((group) => group.label === "Plan").items.map((item) => item.id)).toEqual(["initiatives"]);
    expect(grouped.find((group) => group.label === "Operate").items.map((item) => item.id)).toEqual(["agents", "repos"]);
    expect(grouped.find((group) => group.label === "Review").items.map((item) => item.id)).toEqual(["review", "shipped"]);
  });

  it("includes every nav item exactly once", () => {
    const groupedIds = groupedNavItems().flatMap((group) => group.items.map((item) => item.id));
    expect(groupedIds).toHaveLength(navItems.length);
    expect(new Set(groupedIds).size).toBe(navItems.length);
    expect(navGroups.flatMap((group) => group.items).sort()).toEqual([...navItems.map((item) => item.id)].sort());
  });
});

describe("buildCommandResults", () => {
  const packets = [
    { key: "TASK-101", title: "Fix contact import duplicate handling", repo: "web-app" },
    { key: "TASK-102", title: "Document the deploy path", repo: "docs" },
    { key: "CSC-433", title: "Should never appear", repo: "csc-workspace" },
  ];

  it("returns views, existing actions, and TASK packets", () => {
    const results = buildCommandResults({ query: "", views: navItems, viewCopy, packets });
    expect(results.some((result) => result.type === "view" && result.id === "today")).toBe(true);
    expect(results.some((result) => result.type === "action" && result.id === "new-packet")).toBe(true);
    expect(results.some((result) => result.type === "packet" && result.id === "TASK-101")).toBe(true);
    expect(results.map((result) => result.id)).not.toContain("CSC-433");
  });

  it("filters views and packets by query", () => {
    const review = buildCommandResults({ query: "review", views: navItems, viewCopy, packets });
    expect(review.some((result) => result.id === "review")).toBe(true);
    expect(review.some((result) => result.id === "today")).toBe(false);

    const packet = buildCommandResults({ query: "TASK-101", views: navItems, viewCopy, packets });
    expect(packet).toEqual([
      expect.objectContaining({ type: "packet", id: "TASK-101", meta: "TASK-101 · web-app" }),
    ]);
  });

  it("keeps new-packet and new-initiative as common actions", () => {
    expect(commandActions.map((action) => action.id)).toEqual(["new-packet", "new-initiative"]);
    const results = buildCommandResults({ query: "new initiative", views: navItems, viewCopy, packets });
    expect(results).toEqual([
      expect.objectContaining({ type: "action", id: "new-initiative" }),
    ]);
  });

  it("does not leak Commerce Street language or packet keys", () => {
    const serialized = JSON.stringify([
      navGroups,
      navItems,
      commandActions,
      buildCommandResults({ query: "CSC", views: navItems, viewCopy, packets }),
    ]);
    expect(serialized).not.toMatch(/Commerce Street|csc-workspace|CSC-|COM-|Harbor|RegVault|commercestreet/i);
  });
});

describe("commandShortcutLabel", () => {
  it("shows Ctrl+K on non-Apple agents and ⌘K on Apple agents", () => {
    expect(commandShortcutLabel("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Ctrl+K");
    expect(commandShortcutLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("⌘K");
  });
});

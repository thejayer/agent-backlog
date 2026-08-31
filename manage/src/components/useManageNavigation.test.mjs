import { describe, expect, it } from "vitest";
import { navigationIntent } from "./useManageNavigation.mjs";

describe("navigationIntent", () => {
  it("opens Review on the first needs_review packet and clears other filters", () => {
    const items = [
      { key: "TASK-101", status: "ready_for_agent" },
      { key: "TASK-104", status: "needs_review" },
    ];

    expect(navigationIntent("review", items)).toEqual({
      activeNav: "review",
      repoFilter: "all",
      statusFilter: "needs_review",
      labelFilter: "all",
      selectedKey: "TASK-104",
    });
  });

  it("returns to Backlog with status and label filters cleared", () => {
    expect(navigationIntent("backlog")).toEqual({
      activeNav: "backlog",
      statusFilter: "all",
      labelFilter: "all",
    });
  });

  it("keeps other destinations as a nav change only", () => {
    expect(navigationIntent("today")).toEqual({ activeNav: "today" });
    expect(navigationIntent("agents")).toEqual({ activeNav: "agents" });
  });

  it("does not mention Commerce Street destinations or CSC packet keys", () => {
    const serialized = JSON.stringify([
      navigationIntent("review", [{ key: "TASK-104", status: "needs_review" }]),
      navigationIntent("backlog"),
    ]);
    expect(serialized).not.toMatch(/Commerce Street|CSC-|COM-|Harbor|RegVault/i);
  });
});

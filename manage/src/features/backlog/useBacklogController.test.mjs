import { describe, expect, it } from "vitest";
import {
  emptyWorkItem,
  filterBacklogItems,
  resolveSelectedWorkItem,
} from "./useBacklogController.mjs";

const items = [
  {
    key: "TASK-101",
    title: "Fix contact import",
    repo: "web-app",
    status: "ready_for_agent",
    priority: "urgent",
    labels: ["bug"],
    summary: "Dedupe imports",
    project: "Web app",
  },
  {
    key: "TASK-102",
    title: "Harden login",
    repo: "api-service",
    status: "needs_review",
    priority: "high",
    labels: ["api"],
    summary: "Auth review",
    project: "API",
  },
];

describe("filterBacklogItems", () => {
  it("filters by repo, status, label, and query", () => {
    expect(filterBacklogItems(items, { repoFilter: "api-service" }).map((item) => item.key)).toEqual(["TASK-102"]);
    expect(filterBacklogItems(items, { statusFilter: "needs_review" }).map((item) => item.key)).toEqual(["TASK-102"]);
    expect(filterBacklogItems(items, { labelFilter: "bug" }).map((item) => item.key)).toEqual(["TASK-101"]);
    expect(filterBacklogItems(items, { query: "login" }).map((item) => item.key)).toEqual(["TASK-102"]);
  });

  it("ranks urgent packets ahead of high-priority packets", () => {
    expect(filterBacklogItems(items).map((item) => item.key)).toEqual(["TASK-101", "TASK-102"]);
  });
});

describe("resolveSelectedWorkItem", () => {
  it("keeps the selected packet when it is still visible", () => {
    expect(resolveSelectedWorkItem(items, items, "TASK-102").key).toBe("TASK-102");
  });

  it("falls back to a filtered packet, then a stable empty packet", () => {
    const filtered = filterBacklogItems(items, { repoFilter: "web-app" });
    expect(resolveSelectedWorkItem(items, filtered, "TASK-102").key).toBe("TASK-102");
    expect(resolveSelectedWorkItem(items, filtered, "TASK-999").key).toBe("TASK-101");
    expect(resolveSelectedWorkItem([], [], "TASK-101")).toEqual(emptyWorkItem);
    expect(resolveSelectedWorkItem([], [], "").key).toBe("");
    expect(resolveSelectedWorkItem([], [], "").title).toBe("");
  });

  it("does not leak Commerce Street keys or branded copy", () => {
    const selected = resolveSelectedWorkItem(items, items, "CSC-101");
    expect(selected.key).toBe("TASK-101");
    expect(JSON.stringify(selected)).not.toMatch(/Commerce Street|CSC-|COM-|Harbor|RegVault/i);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import {
  manageViewRelativeUrl,
  parseManageViewState,
  savedBacklogState,
  serializeManageViewState,
  viewStateFromSavedBacklog,
} from "./manageViewState.mjs";

const savedPrefix = process.env.MANAGE_PACKET_KEY_PREFIX;

afterEach(() => {
  if (savedPrefix === undefined) delete process.env.MANAGE_PACKET_KEY_PREFIX;
  else process.env.MANAGE_PACKET_KEY_PREFIX = savedPrefix;
});

describe("URL view state", () => {
  it("round trips supported state while preserving unrelated query parameters", () => {
    const state = parseManageViewState(
      "auth_error=retry&view=review&repo=web-app&status=needs_review&label=bug&q=oauth&packet=task-101",
    );
    const serialized = serializeManageViewState("auth_error=retry", state);

    expect(state).toMatchObject({
      activeNav: "review",
      repoFilter: "web-app",
      statusFilter: "needs_review",
      labelFilter: "bug",
      query: "oauth",
      selectedKey: "TASK-101",
    });
    expect(serialized.get("auth_error")).toBe("retry");
    expect(parseManageViewState(serialized)).toEqual(state);
  });

  it("falls back and canonicalizes invalid or default values", () => {
    const state = parseManageViewState("view=unknown&repo=bad&status=nope&label=%3Cscript%3E&packet=TASK-x&q=test");
    expect(state).toMatchObject({
      activeNav: "backlog",
      repoFilter: "all",
      statusFilter: "all",
      labelFilter: "all",
      selectedKey: "",
      query: "test",
    });
    expect(manageViewRelativeUrl({ pathname: "/", search: "?auth_error=x", hash: "#brief" }, state)).toBe(
      "/?auth_error=x&q=test#brief",
    );
  });

  it("accepts TASK-* packet keys and ignores CSC-* or COM-* keys", () => {
    expect(parseManageViewState("packet=TASK-433").selectedKey).toBe("TASK-433");
    expect(parseManageViewState("packet=CSC-433").selectedKey).toBe("");
    expect(parseManageViewState("packet=COM-12").selectedKey).toBe("");
    expect(parseManageViewState("packet=task-102").selectedKey).toBe("TASK-102");
  });

  it("parameterizes the packet-key prefix from MANAGE_PACKET_KEY_PREFIX", () => {
    process.env.MANAGE_PACKET_KEY_PREFIX = "JOB";
    expect(parseManageViewState("packet=JOB-9").selectedKey).toBe("JOB-9");
    expect(parseManageViewState("packet=TASK-9").selectedKey).toBe("");
  });

  it("canonicalizes labels against the currently available catalog", () => {
    expect(parseManageViewState("label=removed-label", { availableLabels: ["bug"] }).labelFilter).toBe("all");
    expect(parseManageViewState("label=bug", { availableLabels: ["bug"] }).labelFilter).toBe("bug");
  });

  it("keeps named saved views limited to reusable Backlog filters", () => {
    const current = parseManageViewState(
      "view=agents&repo=api-service&status=ready_for_agent&label=api&q=url&packet=TASK-101",
    );
    const saved = savedBacklogState(current);
    expect(saved).toEqual({ version: 1, repo: "api-service", status: "ready_for_agent", label: "api", query: "url" });
    expect(viewStateFromSavedBacklog(saved, current)).toMatchObject({
      activeNav: "backlog",
      selectedKey: "",
      repoFilter: "api-service",
      query: "url",
    });
    expect(viewStateFromSavedBacklog({ ...saved, repo: "removed", status: "removed", label: "<bad>" }, current)).toMatchObject({
      repoFilter: "all",
      statusFilter: "all",
      labelFilter: "all",
    });
  });

  it("does not accept Commerce Street catalog ids or leak branded copy", () => {
    const state = parseManageViewState("repo=csc-workspace&packet=CSC-433&q=imports");
    expect(state.repoFilter).toBe("all");
    expect(state.selectedKey).toBe("");
    expect(`${state.activeNav}${state.repoFilter}${state.selectedKey}`).not.toMatch(/csc-workspace|CSC-/i);
  });
});

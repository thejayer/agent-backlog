import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionCookie } from "./auth.mjs";
import {
  authorizeManageRequest,
  managePermissions,
  manageRoutePolicies,
  permissionForRequest,
  requireBrowserWriteProtection,
  roleHasPermission,
} from "./authorization.mjs";

const ENV_KEYS = [
  "MANAGE_AUTH_SECRET",
  "MANAGE_AUTH_TOKEN",
  "MANAGE_BASE_URL",
  "MANAGE_ALLOWED_ORIGINS",
];
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.MANAGE_AUTH_SECRET = "authorization-test-secret";
  process.env.MANAGE_AUTH_TOKEN = "agent-token";
  process.env.MANAGE_BASE_URL = "https://board.example.test";
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function operatorRequest({
  method = "GET",
  origin,
  csrf,
  role = "operator",
} = {}) {
  const cookie = createSessionCookie({ login: "operator", role }).split(";")[0];
  return {
    method,
    headers: {
      cookie,
      ...(origin ? { origin } : {}),
      ...(csrf ? { "x-csrf-protection": csrf } : {}),
    },
  };
}

function agentRequest(method = "GET") {
  return {
    method,
    headers: { authorization: "Bearer agent-token" },
  };
}

describe("permission matrix", () => {
  it("registers unique policies for every protected route family", () => {
    expect(manageRoutePolicies.map((policy) => policy.id)).toHaveLength(
      new Set(manageRoutePolicies.map((policy) => policy.id)).size,
    );
    expect(manageRoutePolicies.map((policy) => policy.id)).toEqual(expect.arrayContaining([
      "system-status",
      "backups",
      "backup-restore",
      "github-sync",
      "github-reconciliation",
      "work-items",
      "initiatives",
      "initiative",
      "saved-views",
      "saved-view",
      "reset",
      "agent-bootstrap",
      "agent-next-key",
      "agent-task-create",
      "agent-next-claim",
      "agent-task-status",
      "agent-task-recovery",
      "agent-task-events",
      "agent-task-heartbeat",
      "agent-task-notes",
      "packet-events-github",
      "agent-instructions",
    ]));
    expect(manageRoutePolicies.map((policy) => policy.id)).not.toEqual(expect.arrayContaining([
      "audit-events",
    ]));
    expect(permissionForRequest("/api/saved-views", "GET").permission).toBe(managePermissions.manageSavedViews);
    expect(permissionForRequest("/api/saved-views", "POST").permission).toBe(managePermissions.manageSavedViews);
    expect(permissionForRequest("/api/saved-views/saved-view-1", "PATCH").permission).toBe(
      managePermissions.manageSavedViews,
    );
    expect(permissionForRequest("/api/saved-views/saved-view-1", "DELETE").permission).toBe(
      managePermissions.manageSavedViews,
    );
    expect(permissionForRequest("/api/initiatives", "GET").permission).toBe(managePermissions.viewWorkspace);
    expect(permissionForRequest("/api/initiatives", "POST").permission).toBe(managePermissions.updateWorkspace);
    expect(permissionForRequest("/api/initiatives/initiative-1", "PATCH").permission).toBe(
      managePermissions.updateWorkspace,
    );
  });

  it("grants operators all permissions and keeps viewers read-only", () => {
    for (const permission of Object.values(managePermissions)) {
      expect(roleHasPermission("operator", permission), permission).toBe(true);
      expect(roleHasPermission("admin", permission), permission).toBe(true);
    }

    expect(roleHasPermission("viewer", managePermissions.viewWorkspace)).toBe(true);
    expect(roleHasPermission("viewer", managePermissions.updateWorkspace)).toBe(false);
    expect(roleHasPermission("viewer", managePermissions.viewAgentContext)).toBe(false);
    expect(roleHasPermission("viewer", managePermissions.manageSavedViews)).toBe(false);
  });

  it("limits agents to lifecycle and agent-context routes", () => {
    expect(permissionForRequest("/api/agent/bootstrap", "GET").permission).toBe(managePermissions.viewAgentContext);
    expect(permissionForRequest("/api/agent/next-key", "GET").permission).toBe(managePermissions.viewAgentContext);
    expect(permissionForRequest("/api/agent/tasks", "POST").permission).toBe(managePermissions.runAgentLifecycle);
    expect(permissionForRequest("/api/agent/tasks/TASK-101/status", "POST").permission).toBe(
      managePermissions.runAgentLifecycle,
    );
    expect(permissionForRequest("/api/agent/tasks/TASK-101/events", "GET").permission).toBe(
      managePermissions.viewAgentContext,
    );
    expect(permissionForRequest("/api/agent/tasks/TASK-101/heartbeat", "POST").permission).toBe(
      managePermissions.runAgentLifecycle,
    );
    expect(permissionForRequest("/api/agent/tasks/TASK-101/notes", "POST").permission).toBe(
      managePermissions.updateWorkspace,
    );
    expect(permissionForRequest("/api/packet-events/github", "POST").permission).toBe(
      managePermissions.runAgentLifecycle,
    );
    expect(() => authorizeManageRequest(agentRequest("GET"), {
      pathname: "/api/agent/bootstrap",
      method: "GET",
    })).not.toThrow();
    expect(() => authorizeManageRequest(agentRequest("POST"), {
      pathname: "/api/agent/tasks",
      method: "POST",
    })).not.toThrow();
    expect(() => authorizeManageRequest(agentRequest("POST"), {
      pathname: "/api/agent/tasks/TASK-101/status",
      method: "POST",
    })).not.toThrow();
    expect(() => authorizeManageRequest(agentRequest("GET"), {
      pathname: "/api/agent/tasks/TASK-101/events",
      method: "GET",
    })).not.toThrow();
    expect(() => authorizeManageRequest(agentRequest("POST"), {
      pathname: "/api/agent/tasks/TASK-101/heartbeat",
      method: "POST",
    })).not.toThrow();
    expect(() => authorizeManageRequest(agentRequest("POST"), {
      pathname: "/api/packet-events/github",
      method: "POST",
    })).not.toThrow();

    for (const [method, pathname] of [
      ["POST", "/api/agent/reset"],
      ["POST", "/api/backups"],
      ["POST", "/api/backups/snapshot-1/restore"],
      ["POST", "/api/github/sync"],
      ["GET", "/api/github/reconciliation"],
      ["POST", "/api/github/reconciliation"],
      ["POST", "/api/agent/tasks/TASK-101/recovery"],
      ["POST", "/api/agent/tasks/TASK-101/notes"],
      ["GET", "/api/work-items"],
      ["GET", "/api/initiatives"],
      ["POST", "/api/initiatives"],
      ["PATCH", "/api/initiatives/initiative-1"],
      ["GET", "/api/saved-views"],
      ["POST", "/api/saved-views"],
      ["PATCH", "/api/saved-views/saved-view-1"],
      ["DELETE", "/api/saved-views/saved-view-1"],
    ]) {
      expect(
        () => authorizeManageRequest(agentRequest(method), { pathname, method }),
        `${method} ${pathname}`,
      ).toThrow(/Permission denied|legacy operator endpoint/);
    }
  });

  it.each([
    ["POST", "/api/work-items"],
    ["POST", "/api/work-items/TASK-101/github-issue"],
    ["POST", "/api/work-items/TASK-101/link-github"],
    ["PATCH", "/api/work-items/TASK-101"],
  ])("identifies a stale agent client that calls legacy %s %s", (method, pathname) => {
    let error;

    try {
      authorizeManageRequest(agentRequest(method), {
        pathname,
        method,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      statusCode: 403,
      code: "MANAGE_AGENT_CLIENT_OUTDATED",
      details: {
        legacyEndpoint: pathname,
        replacementEndpoint: method === "POST" && pathname === "/api/work-items"
          ? "/api/agent/tasks"
          : "/api/agent",
      },
    });
    expect(error.message).toMatch(/agent authenticated.*legacy operator endpoint.*\/api\/agent/is);
    expect(error.message).not.toMatch(/commercestreet|csc-workspace|origin\/master/i);
  });

  it("fails closed when a protected route has no registered policy", () => {
    expect(() => authorizeManageRequest(agentRequest(), {
      pathname: "/api/future-unregistered-route",
      method: "GET",
    })).toThrow(/No permission policy/);
  });

  it("fails closed when a known path receives an unregistered method", () => {
    expect(() => authorizeManageRequest(operatorRequest({ method: "DELETE", csrf: "1" }), {
      pathname: "/api/work-items",
      method: "DELETE",
    })).toThrow(/Method not allowed by the permission matrix/);
  });
});

describe("browser write protection", () => {
  it("requires the canonical header or an allowed exact Origin for cookie writes", () => {
    expect(() => requireBrowserWriteProtection(operatorRequest({ method: "POST" }), {
      baseUrl: "https://board.example.test",
    })).toThrow(/Browser write rejected/);
    expect(() => requireBrowserWriteProtection(operatorRequest({
      method: "POST",
      origin: "https://evil.example",
    }), {
      baseUrl: "https://board.example.test",
    })).toThrow(/Browser write rejected/);

    expect(() => requireBrowserWriteProtection(operatorRequest({
      method: "POST",
      csrf: "1",
    }), {
      baseUrl: "https://board.example.test",
    })).not.toThrow();
    expect(() => requireBrowserWriteProtection(operatorRequest({
      method: "PATCH",
      origin: "https://board.example.test",
    }), {
      baseUrl: "https://board.example.test",
    })).not.toThrow();
  });

  it("does not apply browser CSRF controls to bearer automation or safe reads", () => {
    expect(() => requireBrowserWriteProtection(agentRequest("POST"))).not.toThrow();
    expect(() => requireBrowserWriteProtection(operatorRequest({ method: "GET" }))).not.toThrow();
  });
});

import { getSession } from "./auth.mjs";

export const managePermissions = Object.freeze({
  viewWorkspace: "workspace:view",
  viewAgentContext: "agent:read",
  runAgentLifecycle: "agent:lifecycle",
  updateWorkspace: "workspace:update",
  administerGithub: "github:admin",
  administerBackups: "backups:admin",
  performDestructiveAction: "workspace:destructive",
  viewSystem: "system:view",
});

const allPermissions = new Set(Object.values(managePermissions));
const rolePermissions = new Map([
  ["admin", allPermissions],
  ["operator", allPermissions],
  ["viewer", new Set([managePermissions.viewWorkspace])],
  [
    "agent",
    new Set([
      managePermissions.viewAgentContext,
      managePermissions.runAgentLifecycle,
    ]),
  ],
]);

function exact(pathname) {
  return (candidate) => candidate === pathname;
}

export const manageRoutePolicies = Object.freeze([
  {
    id: "system-status",
    match: exact("/api/system/status"),
    methods: { GET: managePermissions.viewSystem },
  },
  {
    id: "backups",
    match: exact("/api/backups"),
    methods: {
      GET: managePermissions.administerBackups,
      POST: managePermissions.administerBackups,
    },
  },
  {
    id: "backup-export",
    match: exact("/api/backups/export"),
    methods: { GET: managePermissions.administerBackups },
  },
  {
    id: "backup-restore",
    match: (pathname) => /^\/api\/backups\/[^/]+\/restore$/.test(pathname),
    methods: { POST: managePermissions.performDestructiveAction },
  },
  {
    id: "github-sync",
    match: exact("/api/github/sync"),
    methods: {
      GET: managePermissions.viewWorkspace,
      POST: managePermissions.administerGithub,
    },
  },
  {
    id: "github-reconciliation",
    match: exact("/api/github/reconciliation"),
    methods: {
      GET: managePermissions.viewWorkspace,
      POST: managePermissions.administerGithub,
    },
  },
  {
    id: "github-link",
    match: exact("/api/github/link"),
    methods: { POST: managePermissions.administerGithub },
  },
  {
    id: "github-issue-import",
    match: exact("/api/github/issues/import"),
    methods: { POST: managePermissions.administerGithub },
  },
  {
    id: "work-items",
    match: exact("/api/work-items"),
    methods: {
      GET: managePermissions.viewWorkspace,
      POST: managePermissions.updateWorkspace,
    },
  },
  {
    id: "initiatives",
    match: exact("/api/initiatives"),
    methods: {
      GET: managePermissions.viewWorkspace,
      POST: managePermissions.updateWorkspace,
    },
  },
  {
    id: "initiative",
    match: (pathname) => /^\/api\/initiatives\/[^/]+$/.test(pathname),
    methods: { PATCH: managePermissions.updateWorkspace },
  },
  {
    id: "work-item-github-issue",
    match: (pathname) => /^\/api\/work-items\/[^/]+\/github-issue$/.test(pathname),
    methods: { POST: managePermissions.administerGithub },
  },
  {
    id: "work-item-github-link",
    match: (pathname) => /^\/api\/work-items\/[^/]+\/link-github$/.test(pathname),
    methods: { POST: managePermissions.administerGithub },
  },
  {
    id: "work-item",
    match: (pathname) => /^\/api\/work-items\/[^/]+$/.test(pathname),
    methods: { PATCH: managePermissions.updateWorkspace },
  },
  {
    id: "reset",
    match: exact("/api/agent/reset"),
    methods: { POST: managePermissions.performDestructiveAction },
  },
  {
    id: "agent-bootstrap",
    match: exact("/api/agent/bootstrap"),
    methods: { GET: managePermissions.viewAgentContext },
  },
  {
    id: "agent-next-key",
    match: exact("/api/agent/next-key"),
    methods: { GET: managePermissions.viewAgentContext },
  },
  {
    id: "agent-task-create",
    match: exact("/api/agent/tasks"),
    methods: { POST: managePermissions.runAgentLifecycle },
  },
  {
    id: "agent-next-claim",
    match: exact("/api/agent/next/claim"),
    methods: { POST: managePermissions.runAgentLifecycle },
  },
  {
    id: "agent-next",
    match: exact("/api/agent/next"),
    methods: { GET: managePermissions.viewAgentContext },
  },
  {
    id: "agent-task-status",
    match: (pathname) => /^\/api\/agent\/tasks\/[^/]+\/status$/.test(pathname),
    methods: { POST: managePermissions.runAgentLifecycle },
  },
  {
    id: "agent-task-claim",
    match: (pathname) => /^\/api\/agent\/tasks\/[^/]+\/claim$/.test(pathname),
    methods: { POST: managePermissions.runAgentLifecycle },
  },
  {
    id: "agent-task-recovery",
    match: (pathname) => /^\/api\/agent\/tasks\/[^/]+\/recovery$/.test(pathname),
    methods: { POST: managePermissions.updateWorkspace },
  },
  {
    id: "agent-task",
    match: (pathname) => /^\/api\/agent\/tasks\/[^/]+$/.test(pathname),
    methods: { GET: managePermissions.viewAgentContext },
  },
  {
    id: "agent-instructions",
    match: exact("/agent/instructions.md"),
    methods: { GET: managePermissions.viewAgentContext },
  },
  {
    id: "agent-markdown",
    match: (pathname) => /^\/agent\/[^/]+\.md$/.test(pathname),
    methods: { GET: managePermissions.viewAgentContext },
  },
]);

const browserWriteMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const browserSessionModes = new Set(["cookie", "github"]);
const legacyAgentPolicyIds = new Set([
  "work-items",
  "work-item-github-issue",
  "work-item-github-link",
  "work-item",
]);

function statusError(message, statusCode, metadata = {}) {
  return Object.assign(new Error(message), { statusCode, ...metadata });
}

function normalizedOrigin(value) {
  try {
    return new URL(String(value || "")).origin;
  } catch {
    return "";
  }
}

function allowedBrowserOrigins(baseUrl) {
  const values = [
    baseUrl,
    process.env.MANAGE_BASE_URL,
    ...String(process.env.MANAGE_ALLOWED_ORIGINS || "").split(","),
  ];
  return new Set(values.map(normalizedOrigin).filter(Boolean));
}

export function permissionForRequest(pathname, method = "GET") {
  const policy = manageRoutePolicies.find((candidate) => candidate.match(pathname));

  if (!policy) {
    return { knownPath: false, permission: "", policyId: "" };
  }

  return {
    knownPath: true,
    permission: policy.methods[String(method || "GET").toUpperCase()] || "",
    policyId: policy.id,
  };
}

export function roleHasPermission(role, permission) {
  return Boolean(permission && rolePermissions.get(String(role || "").toLowerCase())?.has(permission));
}

export function requireBrowserWriteProtection(req, { session = getSession(req), baseUrl = "" } = {}) {
  const method = String(req.method || "GET").toUpperCase();

  if (!browserWriteMethods.has(method) || !browserSessionModes.has(session?.mode)) {
    return;
  }

  if (String(req.headers["x-csrf-protection"] || "").trim() === "1") {
    return;
  }

  const requestOrigin = normalizedOrigin(req.headers.origin);

  if (requestOrigin && allowedBrowserOrigins(baseUrl).has(requestOrigin)) {
    return;
  }

  throw statusError("Browser write rejected: valid Origin or x-csrf-protection header required", 403);
}

export function authorizeManageRequest(req, { pathname, method = req.method || "GET", baseUrl = "" } = {}) {
  const session = getSession(req);

  if (!session?.user) {
    throw statusError("Authentication required", 401);
  }

  const route = permissionForRequest(pathname, method);

  if (!route.knownPath) {
    throw statusError("No permission policy is registered for this route", 403);
  }

  if (!route.permission) {
    throw statusError("Method not allowed by the permission matrix", 405);
  }

  if (!roleHasPermission(session.user.role, route.permission)) {
    if (session.user.role === "agent" && legacyAgentPolicyIds.has(route.policyId)) {
      throw statusError(
        "Agent authenticated, but this is a legacy operator endpoint. "
          + "Use the /api/agent lifecycle endpoints instead (POST /api/agent/tasks to create packets).",
        403,
        {
          code: "MANAGE_AGENT_CLIENT_OUTDATED",
          details: {
            legacyEndpoint: pathname,
            replacementEndpoint: method === "POST" && pathname === "/api/work-items"
              ? "/api/agent/tasks"
              : "/api/agent",
          },
        },
      );
    }

    throw statusError(`Permission denied: ${route.permission}`, 403);
  }

  requireBrowserWriteProtection(req, { session, baseUrl });
  return { session, permission: route.permission, policyId: route.policyId };
}

import crypto from "node:crypto";

const SESSION_COOKIE = "manage_session";
const OAUTH_STATE_COOKIE = "manage_oauth_state";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const LOCAL_AGENT_TOKEN = "manage-local-agent";
const LOCAL_OPERATOR_TOKEN = "manage-local";

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function getAuthSecret() {
  return process.env.MANAGE_AUTH_SECRET || (isProduction() ? "" : process.env.MANAGE_AUTH_TOKEN || process.env.MANAGE_ADMIN_TOKEN || "manage-local-dev-secret");
}

function hasConfiguredSecret() {
  return Boolean(process.env.MANAGE_AUTH_SECRET);
}

function configuredAgentToken() {
  if (process.env.MANAGE_AUTH_TOKEN) {
    return process.env.MANAGE_AUTH_TOKEN;
  }

  if (isProduction()) {
    return "";
  }

  return LOCAL_AGENT_TOKEN;
}

function configuredOperatorToken() {
  if (process.env.MANAGE_OPERATOR_TOKEN) {
    return process.env.MANAGE_OPERATOR_TOKEN;
  }

  if (isProduction()) {
    return "";
  }

  return process.env.MANAGE_ADMIN_TOKEN || LOCAL_OPERATOR_TOKEN;
}

function hasConflictingAccessTokens() {
  const agentToken = configuredAgentToken();
  const operatorToken = configuredOperatorToken();
  return Boolean(agentToken && operatorToken && agentToken === operatorToken);
}

export function getMissingProductionAuthConfig() {
  if (!isProduction()) {
    return [];
  }

  const invalid = ["MANAGE_AUTH_SECRET", "MANAGE_AUTH_TOKEN"].filter((key) => !process.env[key]);

  if (hasConflictingAccessTokens()) {
    invalid.push("MANAGE_OPERATOR_TOKEN (must differ from MANAGE_AUTH_TOKEN)");
  }

  return invalid;
}

export function assertProductionAuthConfig() {
  const invalid = getMissingProductionAuthConfig();

  if (invalid.length > 0) {
    throw new Error(`Production auth is not configured; invalid or missing ${invalid.join(", ")}`);
  }
}

export function getAccessToken() {
  return configuredAgentToken();
}

export function getOperatorAccessToken() {
  if (hasConflictingAccessTokens()) {
    return "";
  }

  return configuredOperatorToken();
}

function sign(value) {
  return crypto.createHmac("sha256", getAuthSecret()).update(value).digest("base64url");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function safeEqual(left, right) {
  const supplied = Buffer.from(String(left || ""));
  const expected = Buffer.from(String(right || ""));

  if (supplied.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(supplied, expected);
}

export function hasValidLoginToken(token) {
  const expected = getOperatorAccessToken();

  return Boolean(expected) && safeEqual(token, expected);
}

function signedPayload(payload) {
  return `${payload}.${sign(payload)}`;
}

function parseSignedPayload(token) {
  const [payload, signature] = String(token || "").split(".");

  if (!payload || !signature || !safeEqual(signature, sign(payload))) {
    return null;
  }

  try {
    return JSON.parse(fromBase64url(payload));
  } catch {
    return null;
  }
}

function secureCookieAttribute() {
  if (process.env.MANAGE_COOKIE_SECURE) {
    return process.env.MANAGE_COOKIE_SECURE === "true" ? "; Secure" : "";
  }

  return String(process.env.MANAGE_BASE_URL || "").startsWith("https://") ? "; Secure" : "";
}

export function createSessionCookie(user = {}) {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const role = String(user.role || "operator").trim() || "operator";
  const payload = base64url(
    JSON.stringify({
      sub: "operator",
      provider: "token",
      ...user,
      role,
      expiresAt,
    }),
  );
  const token = signedPayload(payload);
  const secure = secureCookieAttribute();

  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function normalizeManageReturnTo(value) {
  const candidate = String(value || "").trim();

  if (!candidate) {
    return "/";
  }

  if (
    candidate.length > 2_048
    || !candidate.startsWith("/")
    || /^\/[\\/]/.test(candidate)
    || /[\\\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return "/";
  }

  try {
    const base = new URL("https://manage.invalid");
    const parsed = new URL(candidate, base);

    if (parsed.origin !== base.origin || parsed.username || parsed.password) {
      return "/";
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export function createOAuthStateCookie(state, returnTo = "/") {
  const expiresAt = Date.now() + OAUTH_STATE_MAX_AGE_SECONDS * 1000;
  const payload = base64url(JSON.stringify({ state, returnTo: normalizeManageReturnTo(returnTo), expiresAt }));
  const token = signedPayload(payload);
  const secure = secureCookieAttribute();

  return `${OAUTH_STATE_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/api/auth/github; Max-Age=${OAUTH_STATE_MAX_AGE_SECONDS}${secure}`;
}

export function clearOAuthStateCookie() {
  return `${OAUTH_STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/auth/github; Max-Age=0`;
}

export function hasValidOAuthState(req, state) {
  return Boolean(readOAuthState(req, state));
}

export function readOAuthState(req, state) {
  const cookies = parseCookies(req);
  const parsed = parseSignedPayload(cookies[OAUTH_STATE_COOKIE]);

  if (!parsed || parsed.state !== state || Number(parsed.expiresAt) <= Date.now()) {
    return null;
  }

  return {
    returnTo: normalizeManageReturnTo(parsed.returnTo),
  };
}

export function getCookieSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];

  if (!token) {
    return null;
  }

  const parsed = parseSignedPayload(token);

  if (!parsed || Number(parsed.expiresAt) <= Date.now()) {
    return null;
  }

  return {
    mode: parsed.provider === "github" ? "github" : "cookie",
    user: {
      sub: parsed.sub || "operator",
      login: parsed.login || "operator",
      name: parsed.name || "",
      avatarUrl: parsed.avatarUrl || "",
      provider: parsed.provider || "token",
      role: parsed.role || "operator",
    },
  };
}

export function hasValidBearer(req) {
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return false;
  }

  const supplied = Buffer.from(match[1]);
  const accessToken = getAccessToken();

  if (!accessToken) {
    return false;
  }

  const expected = Buffer.from(accessToken);

  if (supplied.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(supplied, expected);
}

export function getSession(req) {
  const cookieSession = getCookieSession(req);

  if (cookieSession) {
    return cookieSession;
  }

  if (hasValidBearer(req)) {
    return {
      mode: getAccessToken() === LOCAL_AGENT_TOKEN ? "local" : "token",
      user: {
        sub: "bearer-token",
        login: "Bearer token",
        name: "",
        avatarUrl: "",
        provider: "token",
        role: "agent",
      },
    };
  }

  return null;
}

export function isAuthenticated(req) {
  return Boolean(getSession(req));
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function getGithubOAuthStatus() {
  const missing = [];
  const allowedLogins = parseList(process.env.MANAGE_ALLOWED_GITHUB_LOGINS);

  if (!process.env.GITHUB_CLIENT_ID) {
    missing.push("GITHUB_CLIENT_ID");
  }

  if (!process.env.GITHUB_CLIENT_SECRET) {
    missing.push("GITHUB_CLIENT_SECRET");
  }

  if (!hasConfiguredSecret()) {
    missing.push("MANAGE_AUTH_SECRET");
  }

  if (allowedLogins.length === 0) {
    missing.push("MANAGE_ALLOWED_GITHUB_LOGINS");
  }

  return {
    available: missing.length === 0,
    missing,
    allowedLogins,
  };
}

export function isPublicRoute(pathname) {
  return (
    pathname === "/api/health" ||
    pathname === "/api/auth/session" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/auth/github/start" ||
    pathname === "/api/auth/github/callback"
  );
}

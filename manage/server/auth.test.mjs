import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertProductionAuthConfig,
  clearOAuthStateCookie,
  clearSessionCookie,
  createOAuthStateCookie,
  createSessionCookie,
  getAccessToken,
  getCookieSession,
  getGithubOAuthStatus,
  getMissingProductionAuthConfig,
  getOperatorAccessToken,
  getSession,
  authorizeWorkItemCompletion,
  hasValidBearer,
  hasValidLoginToken,
  hasValidOAuthState,
  normalizeManageReturnTo,
  readOAuthState,
  isAuthenticated,
  isPublicRoute,
} from "./auth.mjs";
import { authorizeGithubUser, getGithubLoginStart } from "./githubOAuth.mjs";

const ENV_KEYS = [
  "MANAGE_AUTH_SECRET",
  "MANAGE_AUTH_TOKEN",
  "MANAGE_ADMIN_TOKEN",
  "MANAGE_OPERATOR_TOKEN",
  "MANAGE_COOKIE_SECURE",
  "MANAGE_BASE_URL",
  "NODE_ENV",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "MANAGE_ALLOWED_GITHUB_LOGINS",
];

let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.MANAGE_AUTH_SECRET = "test-secret";
});

afterEach(() => {
  vi.useRealTimers();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function cookieValue(setCookie, name) {
  const match = setCookie.match(new RegExp(`${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function reqWithCookie(setCookie) {
  const [pair] = setCookie.split(";");
  return { headers: { cookie: pair } };
}

describe("session cookies", () => {
  it("round-trips a signed session through the cookie header", () => {
    const setCookie = createSessionCookie({ login: "operator", name: "Operator" });
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Max-Age=43200");

    const session = getCookieSession(reqWithCookie(setCookie));
    expect(session).toEqual({
      mode: "cookie",
      user: { sub: "operator", login: "operator", name: "Operator", avatarUrl: "", provider: "token", role: "operator" },
    });
  });

  it("reports github mode for github-provider sessions", () => {
    const setCookie = createSessionCookie({ provider: "github", login: "allowed-user" });
    expect(getCookieSession(reqWithCookie(setCookie)).mode).toBe("github");
  });

  it("rejects a tampered token", () => {
    const setCookie = createSessionCookie({ login: "operator" });
    const token = cookieValue(setCookie, "manage_session");
    const [payload, signature] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: "operator", provider: "token", login: "intruder", expiresAt: Date.now() + 60_000 }),
    ).toString("base64url");
    const forged = `manage_session=${encodeURIComponent(`${forgedPayload}.${signature}`)}`;
    expect(getCookieSession({ headers: { cookie: forged } })).toBeNull();
    expect(getCookieSession({ headers: { cookie: `manage_session=${encodeURIComponent(`${payload}.${signature}`)}` } })).not.toBeNull();
  });

  it("rejects a session signed under a different secret", () => {
    const setCookie = createSessionCookie({ login: "operator" });
    process.env.MANAGE_AUTH_SECRET = "rotated-secret";
    expect(getCookieSession(reqWithCookie(setCookie))).toBeNull();
  });

  it("expires sessions after 12 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00Z"));
    const setCookie = createSessionCookie({ login: "operator" });

    vi.setSystemTime(new Date("2026-06-12T23:59:59Z"));
    expect(getCookieSession(reqWithCookie(setCookie))).not.toBeNull();

    vi.setSystemTime(new Date("2026-06-13T00:00:00Z"));
    expect(getCookieSession(reqWithCookie(setCookie))).toBeNull();
  });

  it("returns null with no cookie header and clears via Max-Age=0", () => {
    expect(getCookieSession({ headers: {} })).toBeNull();
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });

  it("adds the Secure attribute for https deployments and explicit override", () => {
    expect(createSessionCookie()).not.toContain("Secure");
    process.env.MANAGE_BASE_URL = "https://board.example.com";
    expect(createSessionCookie()).toContain("; Secure");
    process.env.MANAGE_COOKIE_SECURE = "false";
    expect(createSessionCookie()).not.toContain("Secure");
  });
});

describe("OAuth state cookie", () => {
  it("round-trips and validates the state value", () => {
    const setCookie = createOAuthStateCookie("abc123");
    expect(setCookie).toContain("Path=/api/auth/github");
    expect(hasValidOAuthState(reqWithCookie(setCookie), "abc123")).toBe(true);
    expect(hasValidOAuthState(reqWithCookie(setCookie), "wrong")).toBe(false);
    expect(clearOAuthStateCookie()).toContain("Max-Age=0");
  });

  it("expires after 10 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00Z"));
    const setCookie = createOAuthStateCookie("abc123");
    vi.setSystemTime(new Date("2026-06-12T12:10:01Z"));
    expect(hasValidOAuthState(reqWithCookie(setCookie), "abc123")).toBe(false);
  });

  it("signs a safe relative OAuth return path and rejects redirect-shaped values", () => {
    const setCookie = createOAuthStateCookie("abc123", "/?view=backlog&packet=TASK-101#brief");
    expect(readOAuthState(reqWithCookie(setCookie), "abc123")).toEqual({
      returnTo: "/?view=backlog&packet=TASK-101#brief",
    });
    expect(normalizeManageReturnTo("https://evil.example/path")).toBe("/");
    expect(normalizeManageReturnTo("//evil.example/path")).toBe("/");
    expect(normalizeManageReturnTo("/\\evil.example/path")).toBe("/");
    expect(normalizeManageReturnTo("/safe?view=backlog")).toBe("/safe?view=backlog");
  });
});

describe("bearer tokens", () => {
  it("keeps local operator and agent credentials separate", () => {
    expect(getAccessToken()).toBe("manage-local-agent");
    expect(getOperatorAccessToken()).toBe("manage-local");
    process.env.MANAGE_ADMIN_TOKEN = "admin-tok";
    expect(getAccessToken()).toBe("manage-local-agent");
    expect(getOperatorAccessToken()).toBe("admin-tok");
    process.env.MANAGE_AUTH_TOKEN = "auth-tok";
    expect(getAccessToken()).toBe("auth-tok");
    expect(getOperatorAccessToken()).toBe("admin-tok");
    process.env.MANAGE_OPERATOR_TOKEN = "operator-tok";
    expect(getOperatorAccessToken()).toBe("operator-tok");
  });

  it("keeps local token fallback outside production but fails closed without production token config", () => {
    delete process.env.MANAGE_AUTH_SECRET;
    expect(getMissingProductionAuthConfig()).toEqual([]);
    expect(getAccessToken()).toBe("manage-local-agent");
    expect(getOperatorAccessToken()).toBe("manage-local");
    expect(hasValidLoginToken("manage-local")).toBe(true);

    process.env.NODE_ENV = "production";
    expect(getMissingProductionAuthConfig()).toEqual(["MANAGE_AUTH_SECRET", "MANAGE_AUTH_TOKEN"]);
    expect(getAccessToken()).toBe("");
    expect(getOperatorAccessToken()).toBe("");
    expect(hasValidLoginToken("")).toBe(false);
    expect(hasValidBearer({ headers: { authorization: "Bearer manage-local" } })).toBe(false);
    expect(() => assertProductionAuthConfig()).toThrow(/MANAGE_AUTH_SECRET, MANAGE_AUTH_TOKEN/);

    process.env.MANAGE_AUTH_SECRET = "prod-secret";
    expect(getMissingProductionAuthConfig()).toEqual(["MANAGE_AUTH_TOKEN"]);
    expect(() => assertProductionAuthConfig()).toThrow(/MANAGE_AUTH_TOKEN/);

    process.env.MANAGE_AUTH_TOKEN = "prod-token";
    expect(getMissingProductionAuthConfig()).toEqual([]);
    expect(() => assertProductionAuthConfig()).not.toThrow();
    expect(hasValidLoginToken("prod-token")).toBe(false);

    process.env.MANAGE_OPERATOR_TOKEN = "operator-token";
    expect(hasValidLoginToken("operator-token")).toBe(true);
    expect(hasValidBearer({ headers: { authorization: "Bearer operator-token" } })).toBe(false);
  });

  it("rejects matching agent and operator credentials", () => {
    process.env.MANAGE_AUTH_TOKEN = "shared-token";
    process.env.MANAGE_OPERATOR_TOKEN = "shared-token";

    expect(getOperatorAccessToken()).toBe("");
    expect(hasValidLoginToken("shared-token")).toBe(false);

    process.env.NODE_ENV = "production";
    expect(getMissingProductionAuthConfig()).toContain(
      "MANAGE_OPERATOR_TOKEN (must differ from MANAGE_AUTH_TOKEN)",
    );
    expect(() => assertProductionAuthConfig()).toThrow(/must differ from MANAGE_AUTH_TOKEN/);
  });

  it("rejects resolved default and alias collisions so the agent token cannot mint a session", () => {
    process.env.MANAGE_AUTH_TOKEN = "manage-local";
    expect(getAccessToken()).toBe("manage-local");
    expect(getOperatorAccessToken()).toBe("");
    expect(hasValidLoginToken("manage-local")).toBe(false);
    expect(hasValidBearer({ headers: { authorization: "Bearer manage-local" } })).toBe(true);

    delete process.env.MANAGE_AUTH_TOKEN;
    process.env.MANAGE_AUTH_TOKEN = "alias-token";
    process.env.MANAGE_ADMIN_TOKEN = "alias-token";
    expect(getAccessToken()).toBe("alias-token");
    expect(getOperatorAccessToken()).toBe("");
    expect(hasValidLoginToken("alias-token")).toBe(false);
    expect(hasValidBearer({ headers: { authorization: "Bearer alias-token" } })).toBe(true);
  });

  it("does not honor the legacy admin token fallback in production mode", () => {
    process.env.NODE_ENV = "production";
    process.env.MANAGE_AUTH_SECRET = "prod-secret";
    process.env.MANAGE_ADMIN_TOKEN = "legacy-admin-token";

    expect(getMissingProductionAuthConfig()).toEqual(["MANAGE_AUTH_TOKEN"]);
    expect(getAccessToken()).toBe("");
    expect(getOperatorAccessToken()).toBe("");
    expect(hasValidLoginToken("legacy-admin-token")).toBe(false);
    expect(hasValidBearer({ headers: { authorization: "Bearer legacy-admin-token" } })).toBe(false);
    expect(() => assertProductionAuthConfig()).toThrow(/MANAGE_AUTH_TOKEN/);
  });

  it("accepts only the exact configured token (case-insensitive Bearer prefix)", () => {
    process.env.MANAGE_AUTH_TOKEN = "s3cret-token";
    expect(hasValidBearer({ headers: { authorization: "Bearer s3cret-token" } })).toBe(true);
    expect(hasValidBearer({ headers: { authorization: "bearer s3cret-token" } })).toBe(true);
    expect(hasValidBearer({ headers: { authorization: "Bearer wrong-token1" } })).toBe(false);
    expect(hasValidBearer({ headers: { authorization: "Bearer short" } })).toBe(false);
    expect(hasValidBearer({ headers: { authorization: "Token s3cret-token" } })).toBe(false);
    expect(hasValidBearer({ headers: {} })).toBe(false);
  });

  it("validates login tokens through timing-safe comparison", () => {
    process.env.MANAGE_OPERATOR_TOKEN = "s3cret-token";
    const timingSafeEqual = vi.spyOn(crypto, "timingSafeEqual");

    expect(hasValidLoginToken("s3cret-token")).toBe(true);
    expect(hasValidLoginToken("wrong-token1")).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledTimes(2);

    expect(hasValidLoginToken("short")).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledTimes(2);

    timingSafeEqual.mockRestore();
  });

  it("getSession prefers the cookie session and labels bearer mode local vs token", () => {
    process.env.MANAGE_AUTH_TOKEN = "s3cret-token";
    const setCookie = createSessionCookie({ login: "operator" });
    const both = { headers: { cookie: setCookie.split(";")[0], authorization: "Bearer s3cret-token" } };
    expect(getSession(both).user.login).toBe("operator");

    const bearerOnly = { headers: { authorization: "Bearer s3cret-token" } };
    expect(getSession(bearerOnly)).toMatchObject({ mode: "token", user: { sub: "bearer-token", role: "agent" } });

    delete process.env.MANAGE_AUTH_TOKEN;
    process.env.MANAGE_AUTH_SECRET = "test-secret";
    const localReq = { headers: { authorization: "Bearer manage-local-agent" } };
    expect(getSession(localReq).mode).toBe("local");
    expect(isAuthenticated(localReq)).toBe(true);
    expect(isAuthenticated({ headers: {} })).toBe(false);
  });

  it("does not mint a cookie session from the agent bearer token", () => {
    process.env.MANAGE_AUTH_TOKEN = "agent-token";
    process.env.MANAGE_OPERATOR_TOKEN = "operator-token";
    expect(hasValidLoginToken("agent-token")).toBe(false);
    expect(hasValidBearer({ headers: { authorization: "Bearer agent-token" } })).toBe(true);
  });
});

describe("github OAuth status + public routes", () => {
  it("lists every missing configuration item", () => {
    delete process.env.MANAGE_AUTH_SECRET;
    const status = getGithubOAuthStatus();
    expect(status.available).toBe(false);
    expect(status.missing).toEqual([
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "MANAGE_AUTH_SECRET",
      "MANAGE_ALLOWED_GITHUB_LOGINS",
    ]);
  });

  it("is available with full config and normalizes the allow-list", () => {
    process.env.GITHUB_CLIENT_ID = "id";
    process.env.GITHUB_CLIENT_SECRET = "secret";
    process.env.MANAGE_ALLOWED_GITHUB_LOGINS = " AllowedUser , codex ,, ";
    const status = getGithubOAuthStatus();
    expect(status.available).toBe(true);
    expect(status.allowedLogins).toEqual(["alloweduser", "codex"]);
  });

  it("does not hardcode a product GitHub login allow-list", () => {
    process.env.GITHUB_CLIENT_ID = "id";
    process.env.GITHUB_CLIENT_SECRET = "secret";
    expect(getGithubOAuthStatus().allowedLogins).toEqual([]);
    expect(getGithubOAuthStatus().missing).toContain("MANAGE_ALLOWED_GITHUB_LOGINS");
  });

  it("binds the requested deep link to the signed OAuth state", () => {
    process.env.GITHUB_CLIENT_ID = "id";
    process.env.GITHUB_CLIENT_SECRET = "secret";
    process.env.MANAGE_ALLOWED_GITHUB_LOGINS = "allowed-user";
    const login = getGithubLoginStart("https://board.example.test", "/?repo=web-app&packet=TASK-101");
    const state = new URL(login.url).searchParams.get("state");
    expect(readOAuthState(reqWithCookie(login.cookie), state)).toEqual({
      returnTo: "/?repo=web-app&packet=TASK-101",
    });
  });

  it("treats only the auth/health endpoints as public", () => {
    for (const route of [
      "/api/health",
      "/api/auth/session",
      "/api/auth/login",
      "/api/auth/logout",
      "/api/auth/github/start",
      "/api/auth/github/callback",
    ]) {
      expect(isPublicRoute(route)).toBe(true);
    }
    expect(isPublicRoute("/api/work")).toBe(false);
    expect(isPublicRoute("/api/agent/next/claim")).toBe(false);
  });
});

describe("github OAuth user authorization", () => {
  it("allows a GitHub user on the allow-list", () => {
    expect(() => authorizeGithubUser({ login: "allowed-user" }, ["allowed-user"])).not.toThrow();
  });

  it("denies a GitHub user outside the allow-list", () => {
    expect(() => authorizeGithubUser({ login: "intruder" }, ["allowed-user"])).toThrow(/not allowed/);
  });

  it("denies a GitHub user when the allow-list is empty", () => {
    expect(() => authorizeGithubUser({ login: "allowed-user" }, [])).toThrow(/not allowed/);
  });

  it("normalizes GitHub login and allow-list casing", () => {
    expect(() => authorizeGithubUser({ login: " AllowedUser " }, [" ALLOWEDUSER "])).not.toThrow();
  });

  it("denies malformed GitHub user payloads without a usable login", () => {
    for (const user of [null, {}, { login: "" }, { email: "user@example.com" }]) {
      expect(() => authorizeGithubUser(user, ["allowed-user"])).toThrow(/not allowed/);
    }
  });

  it("denies safely when the allow-list shape is malformed", () => {
    for (const allowedLogins of ["allowed-user", { 0: "allowed-user" }, null]) {
      expect(() => authorizeGithubUser({ login: "allowed-user" }, allowedLogins)).toThrow(/not allowed/);
    }
  });
});

describe("authorizeWorkItemCompletion", () => {
  it("allows agents to complete with evidence but not with an override", () => {
    const session = { user: { role: "agent", login: "Bearer token" } };
    expect(authorizeWorkItemCompletion(session)).toEqual(session.user);
    expect(() => authorizeWorkItemCompletion(session, { override: true })).toThrow(/Operator role required/);
  });

  it("allows operators to complete with an override", () => {
    const session = { user: { role: "operator", login: "operator" } };
    expect(authorizeWorkItemCompletion(session, { override: true })).toEqual(session.user);
  });

  it("requires a session", () => {
    expect(() => authorizeWorkItemCompletion(null)).toThrow(/Authentication required/);
  });
});

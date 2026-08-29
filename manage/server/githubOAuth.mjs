import crypto from "node:crypto";
import {
  clearOAuthStateCookie,
  createOAuthStateCookie,
  createSessionCookie,
  getGithubOAuthStatus,
  readOAuthState,
} from "./auth.mjs";

function getBaseUrl(baseUrl) {
  return process.env.MANAGE_BASE_URL || baseUrl;
}

function callbackUrl(baseUrl) {
  return process.env.GITHUB_CALLBACK_URL || `${getBaseUrl(baseUrl).replace(/\/$/, "")}/api/auth/github/callback`;
}

function requireGithubOAuthConfig() {
  const status = getGithubOAuthStatus();

  if (!status.available) {
    throw Object.assign(new Error(`GitHub OAuth is not configured: missing ${status.missing.join(", ")}`), {
      statusCode: 503,
      status,
    });
  }

  return status;
}

export function getGithubLoginStart(baseUrl, returnTo = "/") {
  requireGithubOAuthConfig();

  const state = crypto.randomBytes(24).toString("base64url");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", callbackUrl(baseUrl));
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");

  return {
    url: url.toString(),
    cookie: createOAuthStateCookie(state, returnTo),
  };
}

async function requestGithubJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "User-Agent": "agent-backlog",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.error) {
    throw Object.assign(new Error(payload.error_description || payload.message || payload.error || `GitHub request failed: ${response.status}`), {
      statusCode: 502,
    });
  }

  return payload;
}

async function exchangeCodeForToken(code, baseUrl) {
  const body = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    client_secret: process.env.GITHUB_CLIENT_SECRET,
    code,
    redirect_uri: callbackUrl(baseUrl),
  });

  const payload = await requestGithubJson("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!payload.access_token) {
    throw Object.assign(new Error("GitHub did not return an access token"), { statusCode: 502 });
  }

  return payload.access_token;
}

async function fetchGithubUser(accessToken) {
  return requestGithubJson("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

export function authorizeGithubUser(user, allowedLogins) {
  const login = String(user?.login || "").trim().toLowerCase();
  const allowed = new Set(
    (Array.isArray(allowedLogins) ? allowedLogins : [])
      .map((allowedLogin) => String(allowedLogin || "").trim().toLowerCase())
      .filter(Boolean),
  );

  if (!login || !allowed.has(login)) {
    throw Object.assign(new Error("GitHub account is not allowed to access this console"), { statusCode: 403 });
  }
}

export async function completeGithubLogin(req, url, baseUrl) {
  const status = requireGithubOAuthConfig();
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (url.searchParams.get("error")) {
    throw Object.assign(new Error(url.searchParams.get("error_description") || "GitHub login was cancelled"), {
      statusCode: 401,
    });
  }

  const oauthState = code && state ? readOAuthState(req, state) : null;

  if (!oauthState) {
    throw Object.assign(new Error("GitHub login state is invalid or expired"), { statusCode: 400 });
  }

  const accessToken = await exchangeCodeForToken(code, baseUrl);
  const githubUser = await fetchGithubUser(accessToken);
  authorizeGithubUser(githubUser, status.allowedLogins);

  return {
    cookie: createSessionCookie({
      sub: `github:${githubUser.id}`,
      provider: "github",
      login: githubUser.login,
      name: githubUser.name || "",
      avatarUrl: githubUser.avatar_url || "",
    }),
    clearStateCookie: clearOAuthStateCookie(),
    returnTo: oauthState.returnTo,
    user: {
      login: githubUser.login,
      name: githubUser.name || "",
      avatarUrl: githubUser.avatar_url || "",
      provider: "github",
    },
  };
}

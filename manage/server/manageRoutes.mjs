import { buildAgentBootstrap, buildAgentInstructions, buildAgentPrompt, findNextWorkItem } from "../src/lib/agentPrompt.mjs";
import { labelOptions, repositories, statusOptions } from "../src/data/workItems.mjs";
import { blockedRepoIds } from "../src/lib/repoHealth.mjs";
import {
  authorizeWorkItemCompletion,
  clearSessionCookie,
  createSessionCookie,
  getAccessToken,
  getGithubOAuthStatus,
  getOperatorAccessToken,
  getSession,
  hasValidLoginToken,
  isPublicRoute,
} from "./auth.mjs";
import { authorizeManageRequest, managePermissions, requireBrowserWriteProtection, roleHasPermission } from "./authorization.mjs";
import {
  ingestGithubPacketSignal,
  loadPacketRoom,
  recordAgentHeartbeat,
  recordHumanPacketNote,
} from "./packetRoom.mjs";
import {
  findGithubMatchesForItem,
  findMergedPullRequest,
  hasGithubMatches,
  reconcileMergedPullRequests,
} from "./githubLinks.mjs";
import { createGithubIssueForWorkItem } from "./githubIssues.mjs";
import { resolveCompletionGithubEvidence } from "./completionWrite.mjs";
import { fetchPullRequestDeliveryEvidence, readGithubCache, summarizeGithubSyncStatus, syncGithubCache } from "./githubSync.mjs";
import { completeGithubLogin, getGithubLoginStart } from "./githubOAuth.mjs";
import { createStateSnapshot, getStorageStatus, listStateSnapshots, restoreStateSnapshot } from "./storage.mjs";
import { createInitiative, listInitiatives, patchInitiative, resetInitiatives } from "./initiativeStore.mjs";
import { createSavedView, deleteSavedView, listSavedViews, patchSavedView } from "./savedViewStore.mjs";
import {
  applyGithubMatches,
  claimWorkItem,
  createWorkItem,
  createWorkItemForPullRequest,
  importGithubIssues,
  linkMergedPullRequest,
  listWorkItems,
  patchWorkItem,
  recordGithubIssue,
  recoverAgentRun,
  nextWorkItemKey,
  resetWorkItems,
  updateTaskStatus,
} from "./workStore.mjs";

const RESET_CONFIRMATION = "RESET MANAGE";

async function nextWorkSelectionOptions({ repo, label } = {}) {
  const githubCache = await readGithubCache();
  return {
    repo: repo || undefined,
    label: label || undefined,
    blockedRepoIds: blockedRepoIds(repositories, githubCache),
  };
}

function send(res, status, body, contentType) {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(body, null, 2), "application/json; charset=utf-8");
}

function sendJsonDownload(res, status, body, filename) {
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  sendJson(res, status, body);
}

function sendMarkdown(res, status, body) {
  send(res, status, body, "text/markdown; charset=utf-8");
}

function redirect(res, location, cookies = []) {
  res.statusCode = 302;
  res.setHeader("Location", location);

  if (cookies.length > 0) {
    res.setHeader("Set-Cookie", cookies);
  }

  res.end();
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > 1_000_000) {
      throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(req) {
  const raw = (await readRawBody(req)).trim();
  return raw ? JSON.parse(raw) : {};
}

function requestActor(authorization, body = {}) {
  const user = authorization?.session?.user || {};
  return {
    login: String(user.login || "").trim(),
    agent: String(body.agent || user.login || "").trim(),
    agentRunId: String(body.agentRunId || "").trim(),
  };
}

function methodAllowed(res, methods) {
  res.setHeader("Allow", methods.join(", "));
  sendJson(res, 405, { error: "Method not allowed", allowed: methods });
}

function taskLinks(baseUrl, workItem) {
  const root = String(baseUrl || "").replace(/\/$/, "");
  const key = encodeURIComponent(workItem.key);

  return {
    markdown: `${root}/agent/${key}.md`,
    json: `${root}/api/agent/tasks/${key}`,
    claim: `${root}/api/agent/tasks/${key}/claim`,
    status: `${root}/api/agent/tasks/${key}/status`,
    recovery: `${root}/api/agent/tasks/${key}/recovery`,
  };
}

function withPrompt(workItem, baseUrl) {
  return {
    workItem,
    prompt: buildAgentPrompt(workItem),
    links: taskLinks(baseUrl, workItem),
  };
}

function withMutationMetadata(req, body = {}) {
  const headerValue = req.headers["idempotency-key"];
  const idempotencyKey = String(
    body.idempotencyKey || (Array.isArray(headerValue) ? headerValue[0] : headerValue) || "",
  ).trim();

  return {
    ...body,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

function agentTokenHint() {
  return getAccessToken() === "manage-local-agent" ? "manage-local-agent" : "$MANAGE_AUTH_TOKEN";
}

function authProviderSummary() {
  const github = getGithubOAuthStatus();

  return {
    token: Boolean(getOperatorAccessToken()),
    github: github.available,
  };
}

function canForceClaim(session) {
  return roleHasPermission(session?.user?.role, managePermissions.updateWorkspace);
}

function assertTypedConfirmation(received, expected) {
  if (String(received || "") !== String(expected || "")) {
    throw Object.assign(new Error(`Type ${expected} to confirm this destructive action`), { statusCode: 400 });
  }
}

function githubStatusSummary() {
  const status = getGithubOAuthStatus();

  return {
    available: status.available,
    missing: status.missing,
    allowedLoginsConfigured: status.allowedLogins.length > 0,
  };
}

async function findWorkItem(key) {
  const items = await listWorkItems();
  return items.find((candidate) => candidate.key === String(key || "").toUpperCase());
}

function completionOverrideRequested(payload = {}) {
  return Boolean(String(payload.completionOverrideReason || "").trim());
}

async function prepareCompletionWrite(req, key, payload = {}) {
  const session = getSession(req);

  if (String(payload.status || "").trim() !== "done") {
    return { principal: session?.user || null, verifiedCompletionWriteback: null };
  }

  const override = completionOverrideRequested(payload);
  const principal = authorizeWorkItemCompletion(session, { override });
  const workItem = await findWorkItem(key);

  if (!workItem || workItem.status === "done" || override) {
    return { principal, verifiedCompletionWriteback: null };
  }

  const cachedGithub = await readGithubCache();
  const localGithubCache = ["mock", "seed"].includes(cachedGithub?.source);
  const githubCache = localGithubCache
    ? cachedGithub
    : await syncGithubCache();
  const resolved = await resolveCompletionGithubEvidence(workItem, payload, {
    githubCache,
    localGithubCache,
    fetchEvidence: fetchPullRequestDeliveryEvidence,
  });

  return {
    principal,
    ...resolved,
  };
}

async function currentBackupState() {
  return {
    "work-items": await listWorkItems(),
    "github-cache": await readGithubCache(),
    initiatives: await listInitiatives(),
  };
}

function findRepository(repoId) {
  return repositories.find((repo) => repo.id === repoId || repo.name === repoId || `${repo.owner}/${repo.name}` === repoId);
}

async function handleRoute(req, res, baseUrl) {
  const url = new URL(req.url || "/", baseUrl);
  const pathname = url.pathname;
  const method = req.method || "GET";

  if (pathname === "/api/health") {
    if (method !== "GET") {
      methodAllowed(res, ["GET"]);
      return true;
    }

    sendJson(res, 200, {
      ok: true,
      service: "manage",
      storage: getStorageStatus().kind,
      githubSync: process.env.GITHUB_TOKEN ? "github-token" : "gh-cli-or-cache",
    });
    return true;
  }

  if (pathname === "/api/auth/session") {
    const session = getSession(req);

    sendJson(res, 200, {
      authenticated: Boolean(session),
      mode: session?.mode || (getOperatorAccessToken() === "manage-local" ? "local" : "configured"),
      user: session?.user || null,
      providers: authProviderSummary(),
      loginUrls: {
        github: getGithubOAuthStatus().available ? "/api/auth/github/start" : "",
      },
    });
    return true;
  }

  if (pathname === "/api/auth/login") {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    const body = await readJsonBody(req);

    if (!hasValidLoginToken(body.token)) {
      sendJson(res, 401, { error: "Invalid access token" });
      return true;
    }

    res.setHeader("Set-Cookie", createSessionCookie());
    sendJson(res, 200, { authenticated: true });
    return true;
  }

  if (pathname === "/api/auth/logout") {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    requireBrowserWriteProtection(req, { session: getSession(req), baseUrl });
    res.setHeader("Set-Cookie", clearSessionCookie());
    sendJson(res, 200, { authenticated: false });
    return true;
  }

  if (pathname === "/api/auth/github/start") {
    if (method !== "GET") {
      methodAllowed(res, ["GET"]);
      return true;
    }

    const login = getGithubLoginStart(baseUrl, url.searchParams.get("returnTo") || "/");
    redirect(res, login.url, [login.cookie]);
    return true;
  }

  if (pathname === "/api/auth/github/callback") {
    if (method !== "GET") {
      methodAllowed(res, ["GET"]);
      return true;
    }

    const result = await completeGithubLogin(req, url, baseUrl);
    redirect(res, result.returnTo || "/", [result.cookie, result.clearStateCookie]);
    return true;
  }

  const authorization =
    (pathname.startsWith("/api/") || pathname.startsWith("/agent/")) && !isPublicRoute(pathname)
      ? authorizeManageRequest(req, { pathname, method, baseUrl })
      : null;

  if (pathname === "/api/system/status") {
    if (method !== "GET") {
      methodAllowed(res, ["GET"]);
      return true;
    }

    sendJson(res, 200, {
      service: "manage",
      baseUrl,
      storage: getStorageStatus(),
      auth: {
        providers: authProviderSummary(),
        github: githubStatusSummary(),
      },
      githubSync: summarizeGithubSyncStatus(await readGithubCache()),
    });
    return true;
  }

  if (pathname === "/api/backups") {
    if (method === "GET") {
      sendJson(res, 200, { backups: await listStateSnapshots() });
      return true;
    }

    if (method === "POST") {
      const body = await readJsonBody(req);
      const snapshot = await createStateSnapshot(await currentBackupState(), {
        reason: body.reason || "manual",
      });
      sendJson(res, 201, {
        snapshot,
        backups: await listStateSnapshots(),
      });
      return true;
    }

    methodAllowed(res, ["GET", "POST"]);
    return true;
  }

  if (pathname === "/api/backups/export") {
    if (method !== "GET") {
      methodAllowed(res, ["GET"]);
      return true;
    }

    const exportedAt = new Date().toISOString();
    sendJsonDownload(
      res,
      200,
      {
        exportedAt,
        storage: getStorageStatus(),
        state: await currentBackupState(),
      },
      `manage-backlog-${exportedAt.slice(0, 10)}.json`,
    );
    return true;
  }

  const backupRestoreMatch = pathname.match(/^\/api\/backups\/([^/]+)\/restore$/);
  if (backupRestoreMatch) {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    const backupId = decodeURIComponent(backupRestoreMatch[1]);
    const preRestoreSnapshot = await createStateSnapshot(await currentBackupState(), {
      reason: `pre-restore:${backupId}`,
      automatic: true,
      prune: false,
    });
    const restore = await restoreStateSnapshot(backupId);

    sendJson(res, 200, {
      ...restore,
      preRestoreSnapshot,
      workItems: await listWorkItems(),
      github: await readGithubCache(),
      initiatives: await listInitiatives(),
      backups: await listStateSnapshots(),
    });
    return true;
  }

  if (pathname === "/api/github/sync") {
    if (method === "GET") {
      sendJson(res, 200, { github: await readGithubCache() });
      return true;
    }

    if (method === "POST") {
      const body = await readJsonBody(req);
      sendJson(res, 200, { github: await syncGithubCache({ mock: Boolean(body.mock) }) });
      return true;
    }

    methodAllowed(res, ["GET", "POST"]);
    return true;
  }

  if (pathname === "/api/github/reconciliation") {
    const githubCache = await readGithubCache();
    const workItems = await listWorkItems();

    if (method === "GET") {
      sendJson(res, 200, { reconciliation: reconcileMergedPullRequests(workItems, githubCache) });
      return true;
    }

    if (method !== "POST") {
      methodAllowed(res, ["GET", "POST"]);
      return true;
    }

    const body = withMutationMetadata(req, await readJsonBody(req));
    const action = String(body.action || "").trim();
    const mergedPullRequest = findMergedPullRequest(githubCache, body.pullRequestUrl);

    if (!mergedPullRequest) {
      sendJson(res, 404, { error: "Merged pull request not found in the GitHub sync cache" });
      return true;
    }

    if (action === "link") {
      const key = String(body.workItemKey || "").trim().toUpperCase();

      if (!key) {
        sendJson(res, 400, { error: "A suggested work packet key is required" });
        return true;
      }

      const selected = workItems.find((item) => item.key === key);
      const result = await linkMergedPullRequest(key, {
        ...mergedPullRequest,
        source: githubCache.source || "github-cache",
        expectedRevision: body.expectedRevision ?? selected?.revision,
        idempotencyKey: body.idempotencyKey || `reconciliation-link:${mergedPullRequest.pullRequest.url}:${key}`,
      });
      const nextWorkItems = workItems.map((item) => (item.key === key ? result.workItem : item));
      sendJson(res, 200, {
        action,
        ...result,
        reconciliation: reconcileMergedPullRequests(nextWorkItems, githubCache),
      });
      return true;
    }

    if (action === "follow_up") {
      const repoLabel = mergedPullRequest.repo.id || mergedPullRequest.repo.name || "repository";
      const pullRequest = mergedPullRequest.pullRequest;
      const result = await createWorkItemForPullRequest({
        title: `Follow up ${repoLabel} PR #${pullRequest.number}: ${pullRequest.title}`,
        status: "draft",
        priority: "medium",
        project: "Reconciliation",
        repo: repoLabel,
        labels: ["github-sync", "follow-up"],
        summary: `Reconcile remaining work from merged pull request #${pullRequest.number} in ${mergedPullRequest.repo.slug || repoLabel}.`,
        desiredOutcome: "The merged pull request is linked to a reviewed work packet, with any remaining validation or cleanup clearly recorded.",
        acceptanceCriteria: [
          "Review the merged pull request and record why it did not map to an existing packet.",
          "Complete any remaining validation or narrow cleanup work.",
          "Close this follow-up with a recorded disposition.",
        ],
        relevantUrls: [pullRequest.url],
        implementationNotes: [
          `Source pull request merged at ${pullRequest.mergedAt}.`,
          `Created from merged-PR reconciliation using GitHub cache source ${githubCache.source || "unknown"}.`,
        ],
        deployNotes: "Follow the repository's normal review and deployment path if code changes are required.",
        githubBranch: pullRequest.branch || "",
        githubPrUrl: pullRequest.url,
        mergedPullRequest: pullRequest,
        linkRepo: mergedPullRequest.repo,
        githubSource: githubCache.source || "github-cache",
        idempotencyKey: body.idempotencyKey || `reconciliation-follow-up:${pullRequest.url}`,
      });
      const nextWorkItems = result.created
        ? [result.workItem, ...workItems]
        : workItems.map((item) => (item.key === result.workItem.key ? result.workItem : item));
      sendJson(res, result.created ? 201 : 200, {
        action,
        created: result.created,
        ...result,
        reconciliation: reconcileMergedPullRequests(nextWorkItems, githubCache),
      });
      return true;
    }

    sendJson(res, 400, { error: "Reconciliation action must be link or follow_up" });
    return true;
  }

  if (pathname === "/api/github/link") {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    const githubCache = await readGithubCache();
    let workItems = await listWorkItems();
    const linked = [];

    for (const workItem of workItems) {
      const matches = findGithubMatchesForItem(workItem, githubCache);

      if (!hasGithubMatches(matches)) {
        continue;
      }

      const result = await applyGithubMatches(workItem.key, {
        ...matches,
        expectedRevision: workItem.revision,
        idempotencyKey: `github-link-all:${workItem.key}:${githubCache.refreshedAt || githubCache.source || "cache"}`,
      });
      workItems = workItems.map((item) => (item.key === workItem.key ? result.workItem : item));
      linked.push({
        key: workItem.key,
        branch: matches.bestBranch,
        prUrl: matches.bestPrUrl,
        matchCount:
          matches.pullRequests.length +
          matches.branches.length +
          matches.issues.length +
          matches.workflowRuns.length,
      });
    }

    sendJson(res, 200, { workItems, linked });
    return true;
  }

  if (pathname === "/api/github/issues/import") {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    const body = await readJsonBody(req);
    const result = await importGithubIssues(await readGithubCache(), {
      repo: body.repo || "",
      limit: body.limit,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === "/api/work-items") {
    if (method === "GET") {
      sendJson(res, 200, { workItems: await listWorkItems() });
      return true;
    }

    if (method === "POST") {
      const result = await createWorkItem(withMutationMetadata(req, await readJsonBody(req)));
      sendJson(res, 201, result);
      return true;
    }

    methodAllowed(res, ["GET", "POST"]);
    return true;
  }

  if (pathname === "/api/saved-views") {
    if (method === "GET") {
      sendJson(res, 200, await listSavedViews(authorization.session));
      return true;
    }

    if (method === "POST") {
      const result = await createSavedView(
        authorization.session,
        withMutationMetadata(req, await readJsonBody(req)),
      );
      sendJson(res, result.idempotentReplay ? 200 : 201, result);
      return true;
    }

    methodAllowed(res, ["GET", "POST"]);
    return true;
  }

  const savedViewMatch = pathname.match(/^\/api\/saved-views\/([^/]+)$/);
  if (savedViewMatch) {
    const id = decodeURIComponent(savedViewMatch[1]);

    if (method === "PATCH") {
      sendJson(res, 200, await patchSavedView(authorization.session, id, await readJsonBody(req)));
      return true;
    }

    if (method === "DELETE") {
      sendJson(res, 200, await deleteSavedView(authorization.session, id, await readJsonBody(req)));
      return true;
    }

    methodAllowed(res, ["PATCH", "DELETE"]);
    return true;
  }

  if (pathname === "/api/initiatives") {
    if (method === "GET") {
      sendJson(res, 200, { initiatives: await listInitiatives() });
      return true;
    }

    if (method === "POST") {
      const result = await createInitiative(withMutationMetadata(req, await readJsonBody(req)));
      sendJson(res, 201, result);
      return true;
    }

    methodAllowed(res, ["GET", "POST"]);
    return true;
  }

  const initiativeMatch = pathname.match(/^\/api\/initiatives\/([^/]+)$/);
  if (initiativeMatch) {
    if (method !== "PATCH") {
      methodAllowed(res, ["PATCH"]);
      return true;
    }

    const id = decodeURIComponent(initiativeMatch[1]);
    sendJson(res, 200, await patchInitiative(id, await readJsonBody(req)));
    return true;
  }

  const workItemGithubIssueMatch = pathname.match(/^\/api\/work-items\/([^/]+)\/github-issue$/);
  if (workItemGithubIssueMatch) {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    const key = decodeURIComponent(workItemGithubIssueMatch[1]).toUpperCase();
    const item = await findWorkItem(key);

    if (!item) {
      sendJson(res, 404, { error: "Work packet not found", key });
      return true;
    }

    if (item.githubIssueUrl) {
      sendJson(res, 200, {
        issue: {
          number: item.githubIssueNumber,
          title: item.githubIssueTitle || item.title,
          url: item.githubIssueUrl,
          source: "existing",
        },
        created: false,
        workItem: item,
        workItems: await listWorkItems(),
      });
      return true;
    }

    const repo = findRepository(item.repo);

    if (!repo) {
      sendJson(res, 400, { error: `Unknown repository for work packet: ${item.repo}` });
      return true;
    }

    const body = withMutationMetadata(req, await readJsonBody(req));
    const issue = await createGithubIssueForWorkItem(item, repo, {
      baseUrl,
      mock: Boolean(body.mock),
    });
    const result = await recordGithubIssue(key, {
      ...issue,
      expectedRevision: body.expectedRevision ?? item.revision,
      idempotencyKey: body.idempotencyKey || (issue.url ? `github-issue:${issue.url}` : ""),
    });
    sendJson(res, 201, {
      issue,
      created: true,
      workItem: result.workItem,
      workItems: result.workItems,
    });
    return true;
  }

  const workItemGithubLinkMatch = pathname.match(/^\/api\/work-items\/([^/]+)\/link-github$/);
  if (workItemGithubLinkMatch) {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    const key = decodeURIComponent(workItemGithubLinkMatch[1]).toUpperCase();
    const item = await findWorkItem(key);

    if (!item) {
      sendJson(res, 404, { error: "Work packet not found", key });
      return true;
    }

    const body = withMutationMetadata(req, await readJsonBody(req));
    const matches = findGithubMatchesForItem(item, await readGithubCache());
    const result = await applyGithubMatches(key, {
      ...matches,
      expectedRevision: body.expectedRevision ?? item.revision,
      idempotencyKey: body.idempotencyKey || `github-link:${key}:${matches.matchedAt || matches.source || "cache"}`,
    });
    sendJson(res, 200, {
      workItem: result.workItem,
      workItems: result.workItems,
      matches,
    });
    return true;
  }

  const workItemMatch = pathname.match(/^\/api\/work-items\/([^/]+)$/);
  if (workItemMatch) {
    if (method !== "PATCH") {
      methodAllowed(res, ["PATCH"]);
      return true;
    }

    const key = decodeURIComponent(workItemMatch[1]);
    const body = withMutationMetadata(req, await readJsonBody(req));
    const completion = await prepareCompletionWrite(req, key, body);
    const result = await patchWorkItem(key, body, completion);
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === "/api/agent/reset") {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    const body = await readJsonBody(req);
    assertTypedConfirmation(body.confirmation, RESET_CONFIRMATION);
    sendJson(res, 200, {
      workItems: await resetWorkItems(),
      initiatives: await resetInitiatives(),
    });
    return true;
  }

  if (pathname === "/api/agent/bootstrap") {
    if (method !== "GET") {
      methodAllowed(res, ["GET"]);
      return true;
    }

    sendJson(res, 200, {
      bootstrap: buildAgentBootstrap({
        baseUrl,
        repositories,
        statusOptions,
        labelOptions,
        tokenHint: agentTokenHint(),
      }),
    });
    return true;
  }

  if (pathname === "/api/agent/next-key") {
    if (method !== "GET") {
      methodAllowed(res, ["GET"]);
      return true;
    }

    sendJson(res, 200, { nextKey: await nextWorkItemKey(), source: "manage" });
    return true;
  }

  if (pathname === "/api/agent/tasks") {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    const result = await createWorkItem(withMutationMetadata(req, await readJsonBody(req)));
    sendJson(res, 201, {
      ...result,
      ...withPrompt(result.workItem, baseUrl),
    });
    return true;
  }

  if (pathname === "/api/agent/next/claim") {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    const body = withMutationMetadata(req, await readJsonBody(req));
    const repo = body.repo || url.searchParams.get("repo");
    const label = body.label || url.searchParams.get("label");
    const item = findNextWorkItem(await listWorkItems(), await nextWorkSelectionOptions({ repo, label }));

    if (!item) {
      sendJson(res, 404, {
        error: "No ready work packet found",
        repo,
        label,
      });
      return true;
    }

    const result = await claimWorkItem(item.key, {
      ...body,
      expectedRevision: body.expectedRevision ?? item.revision,
    }, { allowForce: canForceClaim(authorization?.session) });
    sendJson(res, 200, withPrompt(result.workItem, baseUrl));
    return true;
  }

  if (pathname === "/api/agent/next") {
    if (method !== "GET") {
      methodAllowed(res, ["GET"]);
      return true;
    }

    const repo = url.searchParams.get("repo");
    const label = url.searchParams.get("label");
    const item = findNextWorkItem(await listWorkItems(), await nextWorkSelectionOptions({ repo, label }));

    if (!item) {
      sendJson(res, 404, {
        error: "No ready work packet found",
        repo,
        label,
      });
      return true;
    }

    sendJson(res, 200, withPrompt(item, baseUrl));
    return true;
  }

  const taskMatch = pathname.match(/^\/api\/agent\/tasks\/([^/]+)$/);
  if (taskMatch) {
    if (method !== "GET") {
      methodAllowed(res, ["GET"]);
      return true;
    }

    const key = decodeURIComponent(taskMatch[1]).toUpperCase();
    const item = await findWorkItem(key);

    if (!item) {
      sendJson(res, 404, { error: "Work packet not found", key });
      return true;
    }

    sendJson(res, 200, withPrompt(item, baseUrl));
    return true;
  }

  const statusMatch = pathname.match(/^\/api\/agent\/tasks\/([^/]+)\/status$/);
  if (statusMatch) {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    const key = decodeURIComponent(statusMatch[1]);
    const body = withMutationMetadata(req, await readJsonBody(req));
    const completion = await prepareCompletionWrite(req, key, body);
    const result = await updateTaskStatus(key, body, completion);
    sendJson(res, 200, withPrompt(result.workItem, baseUrl));
    return true;
  }

  const claimMatch = pathname.match(/^\/api\/agent\/tasks\/([^/]+)\/claim$/);
  if (claimMatch) {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    const result = await claimWorkItem(decodeURIComponent(claimMatch[1]), withMutationMetadata(req, await readJsonBody(req)), {
      allowForce: canForceClaim(authorization?.session),
    });
    sendJson(res, 200, withPrompt(result.workItem, baseUrl));
    return true;
  }

  const recoveryMatch = pathname.match(/^\/api\/agent\/tasks\/([^/]+)\/recovery$/);
  if (recoveryMatch) {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    const key = decodeURIComponent(recoveryMatch[1]);
    const body = withMutationMetadata(req, await readJsonBody(req));
    const session = authorization?.session || getSession(req);
    const actor = session?.user?.login || session?.user?.name || body.agent || "Operator";
    const result = await recoverAgentRun(key, body, { actor });
    sendJson(res, 200, {
      ...withPrompt(result.workItem, baseUrl),
      action: result.action,
      workItems: result.workItems,
    });
    return true;
  }

  const eventsMatch = pathname.match(/^\/api\/agent\/tasks\/([^/]+)\/events$/);
  if (eventsMatch) {
    if (method !== "GET") {
      methodAllowed(res, ["GET"]);
      return true;
    }

    const room = await loadPacketRoom(decodeURIComponent(eventsMatch[1]));
    sendJson(res, 200, {
      workItemKey: room.workItem.key,
      events: room.events,
      heartbeat: room.heartbeat,
      migrated: room.migrated,
    });
    return true;
  }

  const heartbeatMatch = pathname.match(/^\/api\/agent\/tasks\/([^/]+)\/heartbeat$/);
  if (heartbeatMatch) {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    const body = withMutationMetadata(req, await readJsonBody(req));
    const result = await recordAgentHeartbeat(
      decodeURIComponent(heartbeatMatch[1]),
      body,
      requestActor(authorization, body),
    );
    sendJson(res, 200, result);
    return true;
  }

  const notesMatch = pathname.match(/^\/api\/agent\/tasks\/([^/]+)\/notes$/);
  if (notesMatch) {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    const body = withMutationMetadata(req, await readJsonBody(req));
    const event = await recordHumanPacketNote(
      decodeURIComponent(notesMatch[1]),
      body,
      requestActor(authorization, body),
    );
    sendJson(res, 201, { event });
    return true;
  }

  if (pathname === "/api/packet-events/github") {
    if (method !== "POST") {
      methodAllowed(res, ["POST"]);
      return true;
    }

    const rawBody = await readRawBody(req);
    const payload = rawBody.trim() ? JSON.parse(rawBody) : {};
    const headers = Object.fromEntries(
      Object.entries(req.headers || {}).map(([header, value]) => [header.toLowerCase(), Array.isArray(value) ? value[0] : value]),
    );
    const result = await ingestGithubPacketSignal({
      payload,
      headers,
      rawBody,
      actor: requestActor(authorization, payload),
    });
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === "/agent/instructions.md") {
    if (method !== "GET") {
      methodAllowed(res, ["GET"]);
      return true;
    }

    sendMarkdown(res, 200, buildAgentInstructions({ baseUrl, tokenHint: agentTokenHint() }));
    return true;
  }

  const markdownMatch = pathname.match(/^\/agent\/([^/]+)\.md$/);
  if (markdownMatch) {
    if (method !== "GET") {
      methodAllowed(res, ["GET"]);
      return true;
    }

    const key = decodeURIComponent(markdownMatch[1]).toUpperCase();
    const item = await findWorkItem(key);

    if (!item) {
      sendMarkdown(res, 404, `# ${key}\n\nWork packet not found.\n`);
      return true;
    }

    sendMarkdown(res, 200, buildAgentPrompt(item));
    return true;
  }

  return false;
}

export async function routeManageRequest(req, res, baseUrl) {
  try {
    return await handleRoute(req, res, baseUrl);
  } catch (error) {
    const status = error.statusCode || (error instanceof SyntaxError ? 400 : 500);
    sendJson(res, status, {
      error: error.message || "API request failed",
      ...(error.code ? { code: error.code } : {}),
      ...(error.details ? { details: error.details } : {}),
      ...(Number.isFinite(error.expectedRevision) ? { expectedRevision: error.expectedRevision } : {}),
      ...(Number.isFinite(error.actualRevision) ? { actualRevision: error.actualRevision } : {}),
    });
    return true;
  }
}

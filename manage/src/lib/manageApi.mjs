async function requestJson(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const browserWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(browserWrite ? { "x-csrf-protection": "1" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  return payload;
}

export function fetchWorkItems() {
  return requestJson("/api/work-items");
}

export function fetchSession() {
  return requestJson("/api/auth/session");
}

export function login(token) {
  return requestJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function logout() {
  return requestJson("/api/auth/logout", {
    method: "POST",
    body: "{}",
  });
}

export function fetchGithubSync() {
  return requestJson("/api/github/sync");
}

export function fetchSystemStatus() {
  return requestJson("/api/system/status");
}

export function fetchBackups() {
  return requestJson("/api/backups");
}

export function createBackup(payload = {}) {
  return requestJson("/api/backups", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function restoreBackup(id) {
  return requestJson(`/api/backups/${encodeURIComponent(id)}/restore`, {
    method: "POST",
    body: "{}",
  });
}

export function syncGithub({ mock = false } = {}) {
  return requestJson("/api/github/sync", {
    method: "POST",
    body: JSON.stringify({ mock }),
  });
}

export function createWorkItem(payload) {
  return requestJson("/api/work-items", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateWorkItem(key, updates) {
  return requestJson(`/api/work-items/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function claimWorkItem(key, payload = {}) {
  return requestJson(`/api/agent/tasks/${encodeURIComponent(key)}/claim`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function claimNextWorkItem(payload = {}) {
  return requestJson("/api/agent/next/claim", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function recoverAgentRun(key, payload = {}) {
  return requestJson(`/api/agent/tasks/${encodeURIComponent(key)}/recovery`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function linkGithubWorkItem(key) {
  return requestJson(`/api/work-items/${encodeURIComponent(key)}/link-github`, {
    method: "POST",
    body: "{}",
  });
}

export function createGithubIssue(key, payload = {}) {
  return requestJson(`/api/work-items/${encodeURIComponent(key)}/github-issue`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function linkAllGithubWorkItems() {
  return requestJson("/api/github/link", {
    method: "POST",
    body: "{}",
  });
}

export function importGithubIssues(payload = {}) {
  return requestJson("/api/github/issues/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resetWorkItems(confirmation) {
  return requestJson("/api/agent/reset", {
    method: "POST",
    body: JSON.stringify({ confirmation }),
  });
}

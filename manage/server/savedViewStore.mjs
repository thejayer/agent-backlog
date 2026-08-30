import { randomUUID } from "node:crypto";
import { repositories } from "../src/data/workItems.mjs";
import { mutateJsonState } from "./storage.mjs";

const savedViewStateKey = "saved-views";
const schemaVersion = 1;
const maxViewsPerPrincipal = 50;
const allowedRepos = new Set(["all", ...repositories.map((repo) => repo.id)]);
const allowedStatuses = new Set([
  "all",
  "draft",
  "ready_for_agent",
  "claimed",
  "in_progress",
  "needs_review",
  "done",
  "blocked",
]);

function statusError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function initialState() {
  return { version: schemaVersion, principals: [] };
}

function cleanBoundedString(value, field, { required = false, maxLength }) {
  const cleaned = String(value || "").trim();

  if (required && !cleaned) {
    throw statusError(`${field} is required`);
  }

  if (cleaned.length > maxLength) {
    throw statusError(`${field} must be ${maxLength} characters or fewer`);
  }

  return cleaned;
}

export function normalizeSavedBacklogState(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw statusError("Saved view state must be an object");
  }

  if (value.version !== undefined && Number(value.version) !== schemaVersion) {
    throw statusError("Unsupported saved view state version");
  }

  const repo = cleanBoundedString(value.repo || "all", "Saved view repository", { maxLength: 80 });
  const status = cleanBoundedString(value.status || "all", "Saved view status", { maxLength: 40 });
  const label = cleanBoundedString(value.label || "all", "Saved view label", { maxLength: 64 }).toLowerCase();
  const query = cleanBoundedString(value.query || "", "Saved view query", { maxLength: 240 });

  if (!allowedRepos.has(repo)) {
    throw statusError("Saved view repository is invalid");
  }

  if (!allowedStatuses.has(status)) {
    throw statusError("Saved view status is invalid");
  }

  if (label !== "all" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(label)) {
    throw statusError("Saved view label is invalid");
  }

  return { version: schemaVersion, repo, status, label, query };
}

export function savedViewPrincipalKey(session) {
  const user = session?.user;

  if (!user || user.role === "agent") {
    throw statusError("Saved views require an authenticated operator session", 403);
  }

  if (user.provider === "github") {
    const subject = String(user.sub || "").trim();

    if (!/^github:\d+$/.test(subject)) {
      throw statusError("GitHub saved-view identity is invalid", 403);
    }

    return subject;
  }

  if (user.provider === "token" && ["admin", "operator"].includes(user.role)) {
    return "token:operator";
  }

  throw statusError("Saved views are unavailable for this session", 403);
}

function assertRoot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.principals)) {
    throw statusError("Saved-view state is corrupt", 500);
  }

  if (Number(value.version) !== schemaVersion) {
    throw statusError("Saved-view state version is unsupported", 500);
  }

  return value;
}

function principalEntry(root, principalKey, { create = false } = {}) {
  const matches = root.principals.filter((entry) => entry?.key === principalKey);

  if (matches.length > 1) {
    throw statusError("Saved-view ownership state is corrupt", 500);
  }

  if (matches.length === 1) {
    if (!Array.isArray(matches[0].views)) {
      throw statusError("Saved-view ownership state is corrupt", 500);
    }

    return matches[0];
  }

  if (!create) {
    return { key: principalKey, views: [] };
  }

  const entry = { key: principalKey, views: [] };
  root.principals.push(entry);
  return entry;
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw statusError("Saved view record is invalid");
  }

  const id = cleanBoundedString(record.id, "Saved view id", { required: true, maxLength: 100 });

  if (!/^saved-view-[a-f0-9-]{36}$/.test(id)) {
    throw statusError("Saved view id is invalid");
  }

  const revision = Number(record.revision);

  if (!Number.isInteger(revision) || revision < 1) {
    throw statusError("Saved view revision is invalid");
  }

  return {
    id,
    name: cleanBoundedString(record.name, "Saved view name", { required: true, maxLength: 80 }),
    state: normalizeSavedBacklogState(record.state),
    revision,
    createdAt: cleanBoundedString(record.createdAt, "Saved view creation time", { required: true, maxLength: 40 }),
    updatedAt: cleanBoundedString(record.updatedAt, "Saved view update time", { required: true, maxLength: 40 }),
  };
}

function publicList(entry) {
  const savedViews = [];
  let invalidCount = 0;

  for (const record of entry.views) {
    try {
      savedViews.push(normalizeRecord(record));
    } catch {
      invalidCount += 1;
    }
  }

  savedViews.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return {
    savedViews,
    warnings: invalidCount > 0
      ? [`${invalidCount} saved view${invalidCount === 1 ? " is" : "s are"} unavailable because stored data is invalid.`]
      : [],
  };
}

function expectedRevision(payload) {
  const revision = Number(payload?.expectedRevision);

  if (!Number.isInteger(revision) || revision < 1) {
    throw statusError("expectedRevision is required");
  }

  return revision;
}

function findOwnedRecord(entry, id) {
  const matchingIndexes = entry.views.flatMap((record, index) => (record?.id === id ? [index] : []));

  if (matchingIndexes.length > 1) {
    throw statusError("Saved view data contains duplicate identifiers");
  }

  const [index = -1] = matchingIndexes;
  return { index, record: index >= 0 ? entry.views[index] : null };
}

function mutatePrincipalState(principalKey, operation) {
  return mutateJsonState(savedViewStateKey, initialState, operation, { scope: principalKey });
}

export async function listSavedViews(session) {
  const principalKey = savedViewPrincipalKey(session);
  return mutatePrincipalState(principalKey, (stored) => {
    const root = assertRoot(stored);
    return { write: false, result: publicList(principalEntry(root, principalKey)) };
  });
}

export async function createSavedView(session, payload = {}) {
  const principalKey = savedViewPrincipalKey(session);
  const name = cleanBoundedString(payload.name, "Saved view name", { required: true, maxLength: 80 });
  const state = normalizeSavedBacklogState(payload.state);
  const createOperationId = cleanBoundedString(payload.idempotencyKey, "Idempotency key", { maxLength: 200 });

  return mutatePrincipalState(principalKey, (stored) => {
    const root = assertRoot(stored);
    const entry = principalEntry(root, principalKey, { create: true });
    const replay = createOperationId
      ? entry.views.find((record) => record?.createOperationId === createOperationId)
      : null;

    if (replay) {
      return { write: false, result: { savedView: normalizeRecord(replay), idempotentReplay: true } };
    }

    if (entry.views.length >= maxViewsPerPrincipal) {
      throw statusError(`Saved views are limited to ${maxViewsPerPrincipal} per operator`, 409);
    }

    const now = new Date().toISOString();
    const savedView = {
      id: `saved-view-${randomUUID()}`,
      name,
      state,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      createOperationId,
    };
    entry.views.push(savedView);
    return { value: root, result: { savedView: normalizeRecord(savedView), idempotentReplay: false } };
  });
}

export async function patchSavedView(session, id, payload = {}) {
  const principalKey = savedViewPrincipalKey(session);
  const revision = expectedRevision(payload);
  const hasName = Object.prototype.hasOwnProperty.call(payload, "name");
  const hasState = Object.prototype.hasOwnProperty.call(payload, "state");

  if (!hasName && !hasState) {
    throw statusError("Saved view update must include a name or state");
  }

  return mutatePrincipalState(principalKey, (stored) => {
    const root = assertRoot(stored);
    const entry = principalEntry(root, principalKey);
    const { index, record } = findOwnedRecord(entry, id);

    if (!record) {
      throw statusError("Saved view not found", 404);
    }

    const current = normalizeRecord(record);

    if (current.revision !== revision) {
      throw statusError("Saved view changed since it was loaded", 409);
    }

    const next = {
      ...record,
      ...(hasName ? { name: cleanBoundedString(payload.name, "Saved view name", { required: true, maxLength: 80 }) } : {}),
      ...(hasState ? { state: normalizeSavedBacklogState(payload.state) } : {}),
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    entry.views[index] = next;
    return { value: root, result: { savedView: normalizeRecord(next) } };
  });
}

export async function deleteSavedView(session, id, payload = {}) {
  const principalKey = savedViewPrincipalKey(session);

  return mutatePrincipalState(principalKey, (stored) => {
    const root = assertRoot(stored);
    const entry = principalEntry(root, principalKey);
    const { index, record } = findOwnedRecord(entry, id);

    if (!record) {
      return { write: false, result: { id, deleted: false } };
    }

    const current = normalizeRecord(record);

    if (current.revision !== expectedRevision(payload)) {
      throw statusError("Saved view changed since it was loaded", 409);
    }

    entry.views.splice(index, 1);
    return { value: root, result: { id, deleted: true } };
  });
}

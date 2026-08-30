import { createHash, randomUUID } from "node:crypto";
import { priorityOptions, statusOptions, workItems as seedWorkItems } from "../src/data/workItems.mjs";
import { AGENT_RUN_EXTEND_LEASE_MINUTES } from "../src/lib/agentRunContract.mjs";
import {
  MIN_COMPLETION_OVERRIDE_REASON_LENGTH,
  normalizeCompletionOverrideReason,
  normalizeEvidenceCollection,
  reviewCompletionEvidence,
} from "../src/lib/reviewEvidence.mjs";
import { deriveAgentRunHealth, isLeaseActive, normalizeLeaseMinutes } from "./agentRunHealth.mjs";
import { createWorkItemState, nextWorkItemKeyFromItems, readJsonState, writeJsonState, writeWorkItemMutation } from "./storage.mjs";

const allowedStatuses = new Set(statusOptions.map((status) => status.id));
const allowedPriorities = new Set(priorityOptions.map((priority) => priority.id));
const seedLabelsByKey = new Map(seedWorkItems.map((item) => [item.key, item.labels || []]));
const completedStatuses = new Set(["needs_review", "done", "blocked"]);
let workItemMutationQueue = Promise.resolve();

function serializeWorkItemMutation(operation) {
  const result = workItemMutationQueue.then(operation, operation);
  workItemMutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function splitLines(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasPayloadField(payload, field) {
  return Object.prototype.hasOwnProperty.call(payload || {}, field);
}

function splitWritebackLines(payload, ...fields) {
  for (const field of fields) {
    if (hasPayloadField(payload, field)) {
      return splitLines(payload[field]);
    }
  }

  return [];
}

function splitLabels(value) {
  const rawLabels = Array.isArray(value) ? value : String(value || "").split(/[,\n]/);
  const labels = rawLabels
    .map((label) =>
      String(label || "")
        .trim()
        .replace(/^#/, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    )
    .filter(Boolean);

  return [...new Set(labels)].slice(0, 12);
}

function slugify(value) {
  return String(value || "work-packet")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}

function normalizeAgentName(payload = {}, fallback = "Unspecified agent") {
  return String(payload.claimedBy || payload.agent || fallback).trim() || fallback;
}

function buildAgentRunId(key) {
  return `${key}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function appendAgentEvent(item, event) {
  return [...(Array.isArray(item.agentEvents) ? item.agentEvents : []), event].slice(-20);
}

function resolveCompletedAt(currentItem, nextStatus, now) {
  if (nextStatus !== "done") {
    return "";
  }

  return currentItem.status === "done" && currentItem.completedAt ? currentItem.completedAt : now;
}

function completionDecision(item, payload = {}) {
  const evidence = reviewCompletionEvidence(item, { writeback: payload });
  const overrideReason = normalizeCompletionOverrideReason(payload.completionOverrideReason);

  if (overrideReason && overrideReason.length < MIN_COMPLETION_OVERRIDE_REASON_LENGTH) {
    throw Object.assign(
      new Error(`Completion override reason must be at least ${MIN_COMPLETION_OVERRIDE_REASON_LENGTH} characters.`),
      { statusCode: 400 },
    );
  }

  if (!evidence.canComplete && !overrideReason) {
    throw Object.assign(
      new Error(`Completion evidence required: ${evidence.missing.map((check) => check.label).join(", ")}.`),
      { statusCode: 409 },
    );
  }

  return { evidence, overrideReason };
}

function trustedCompletionWriteback(payload, verifiedWriteback) {
  const trusted = verifiedWriteback && typeof verifiedWriteback === "object" ? verifiedWriteback : {};
  const testsRun = splitWritebackLines(trusted, "testsRun", "testCommandsRun");
  const filesChanged = splitWritebackLines(trusted, "filesChanged");

  return {
    ...payload,
    testsRun,
    filesChanged,
    evidenceCollection: normalizeEvidenceCollection(trusted.evidenceCollection, { testsRun, filesChanged }),
  };
}

function completionPrincipalActor(principal) {
  return String(principal?.login || principal?.name || principal?.sub || "Operator").trim() || "Operator";
}

function completionState(currentItem, nextStatus, decision, now, principal) {
  if (nextStatus !== "done") {
    return {
      completionEvidence: null,
      completionOverride: null,
    };
  }

  if (!decision) {
    return {
      completionEvidence: currentItem.completionEvidence || null,
      completionOverride: currentItem.completionOverride || null,
    };
  }

  return {
    completionEvidence: decision.evidence.completionEvidence,
    completionOverride: decision.overrideReason
      ? {
          at: now,
          actor: completionPrincipalActor(principal),
          reason: decision.overrideReason,
        }
      : null,
  };
}

function emptyCompletionState() {
  return {
    completionEvidence: null,
    completionOverride: null,
    completedAt: "",
  };
}

function countGithubMatches(matches) {
  return (
    (matches.pullRequests || []).length +
    (matches.branches || []).length +
    (matches.issues || []).length +
    (matches.workflowRuns || []).length
  );
}

function uniqueLines(values) {
  return [...new Set(splitLines(values))];
}

function nextKey(items) {
  return nextWorkItemKeyFromItems(items);
}

export async function nextWorkItemKey() {
  return nextKey(await readWorkItems());
}

function normalizeWorkItem(item) {
  const hasLabels = Object.prototype.hasOwnProperty.call(item, "labels");

  return {
    ...item,
    labels: splitLabels(hasLabels ? item.labels : seedLabelsByKey.get(item.key)),
    completionEvidence: item.completionEvidence || null,
    completionOverride: item.completionOverride || null,
  };
}

function publicWorkItem(item, now = new Date()) {
  const normalized = normalizeWorkItem(item);
  const { _persistence, ...visible } = normalized;
  const revision = Math.max(Number(_persistence?.revision) || Number(normalized.revision) || 0, 0);
  return {
    ...visible,
    revision,
    agentRunHealth: deriveAgentRunHealth(visible, now),
  };
}

function publicWorkItems(items, now = new Date()) {
  return items.map((item) => publicWorkItem(item, now));
}

async function writeWorkItems(items) {
  return writeJsonState("work-items", items);
}

function idempotencyOperationId(value) {
  const normalized = String(value || "").trim();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : "";
}

function workItemRevision(item) {
  return Math.max(Number(item?._persistence?.revision) || Number(item?.revision) || 0, 0);
}

function workItemConflict(key, expectedRevision, actualRevision) {
  return Object.assign(
    new Error(`${key} changed concurrently. Refresh the board and retry the operation.`),
    {
      statusCode: 409,
      code: "WORK_ITEM_REVISION_CONFLICT",
      expectedRevision,
      actualRevision,
    },
  );
}

function workItemMutationResult(item, items, { changed = true, idempotentReplay = false } = {}) {
  const workItem = publicWorkItem(item);
  return {
    workItem,
    workItems: publicWorkItems(items),
    delta: {
      upsert: changed ? [workItem] : [],
      remove: [],
    },
    revision: workItem.revision,
    idempotentReplay,
  };
}

function replayedWorkItemMutation(item, items, idempotencyKey) {
  const operationId = idempotencyOperationId(idempotencyKey);
  return operationId && item?._persistence?.recentOperationIds?.includes(operationId)
    ? workItemMutationResult(item, items, { changed: false, idempotentReplay: true })
    : null;
}

async function commitWorkItemMutation(items, index, nextItem, {
  expectedRevision,
  idempotencyKey = "",
} = {}) {
  const currentItem = items[index];
  const currentRevision = workItemRevision(currentItem);
  const requiredRevision = Number.isFinite(Number(expectedRevision))
    ? Number(expectedRevision)
    : currentRevision;
  const operationId = idempotencyOperationId(idempotencyKey);
  const recentOperationIds = Array.isArray(currentItem?._persistence?.recentOperationIds)
    ? currentItem._persistence.recentOperationIds
    : [];

  if (operationId && recentOperationIds.includes(operationId)) {
    return workItemMutationResult(currentItem, items, { changed: false, idempotentReplay: true });
  }

  if (requiredRevision !== currentRevision) {
    throw workItemConflict(currentItem.key, requiredRevision, currentRevision);
  }

  const persistedItem = {
    ...nextItem,
    _persistence: {
      revision: currentRevision + 1,
      expectedRevision: currentRevision,
      recentOperationIds: operationId
        ? [...recentOperationIds, operationId].slice(-20)
        : recentOperationIds,
      createOperationId: currentItem?._persistence?.createOperationId || "",
    },
  };
  const nextItems = [...items];
  nextItems[index] = persistedItem;

  try {
    await writeWorkItemMutation(nextItems, persistedItem);
  } catch (error) {
    if (error?.statusCode === 409 && operationId) {
      const latestItems = await readWorkItems();
      const latest = latestItems.find((item) => item.key === currentItem.key);
      if (latest?._persistence?.recentOperationIds?.includes(operationId)) {
        return workItemMutationResult(latest, latestItems, { changed: false, idempotentReplay: true });
      }
    }
    throw error;
  }

  return workItemMutationResult(persistedItem, nextItems);
}

export async function readWorkItems() {
  const parsed = await readJsonState("work-items", () => clone(seedWorkItems), { includePersistence: true });

  if (!Array.isArray(parsed)) {
    throw Object.assign(new Error("Manage work-items state must contain an array"), { statusCode: 500 });
  }

  return parsed.map((item) => normalizeWorkItem(item));
}

async function resetWorkItemsUnlocked() {
  const items = clone(seedWorkItems);
  await writeWorkItems(items);
  return publicWorkItems(items);
}

export async function resetWorkItems() {
  return serializeWorkItemMutation(resetWorkItemsUnlocked);
}

export async function listWorkItems() {
  return publicWorkItems(await readWorkItems());
}

async function createWorkItemUnlocked(payload) {
  const title = String(payload.title || "Untitled work packet").trim();
  const now = new Date().toISOString();
  const status = payload.ready ? "ready_for_agent" : payload.status || "draft";
  const priority = allowedPriorities.has(payload.priority) ? payload.priority : "medium";
  const branchSlug = slugify(title);

  if (!allowedStatuses.has(status)) {
    throw Object.assign(new Error(`Invalid status: ${status}`), { statusCode: 400 });
  }

  if (status === "done") {
    throw Object.assign(new Error("New work packets cannot be created as done."), { statusCode: 400 });
  }

  const result = await createWorkItemState((key) => ({
    id: `w-${key.toLowerCase()}`,
    key,
    title,
    status,
    priority,
    project: String(payload.project || "Manage").trim(),
    repo: String(payload.repo || "agent-backlog").trim(),
    labels: splitLabels(payload.labels),
    suggestedBranch: String(payload.branch || `codex/${key.toLowerCase()}-${branchSlug}`).trim(),
    summary: String(payload.summary || "").trim(),
    desiredOutcome: String(payload.desiredOutcome || "").trim(),
    acceptanceCriteria: splitLines(payload.acceptanceCriteria),
    relevantFiles: splitLines(payload.relevantFiles),
    relevantUrls: splitLines(payload.relevantUrls),
    implementationNotes: splitLines(payload.implementationNotes),
    testCommands: splitLines(payload.testCommands),
    deployNotes: String(payload.deployNotes || "Not recorded.").trim(),
    blockedBy: String(payload.blockedBy || "").trim(),
    githubBranch: String(payload.githubBranch || "").trim(),
    githubPrUrl: String(payload.githubPrUrl || "").trim(),
    githubIssueUrl: String(payload.githubIssueUrl || "").trim(),
    githubIssueNumber: payload.githubIssueNumber ? Number(payload.githubIssueNumber) : null,
    githubIssueTitle: String(payload.githubIssueTitle || "").trim(),
    githubLinks: payload.githubLinks || null,
    lastGithubLinkUpdate: payload.lastGithubLinkUpdate || null,
    agent: String(payload.agent || "").trim(),
    claimedBy: "",
    claimedAt: "",
    agentRunId: "",
    leaseExpiresAt: "",
    agentEvents: [],
    lastAgentUpdate: null,
    completionEvidence: null,
    completionOverride: null,
    completedAt: "",
    createdAt: now,
    updatedAt: now,
  }), {
    fallbackFactory: () => clone(seedWorkItems),
    idempotencyKey: payload.idempotencyKey,
  });

  return workItemMutationResult(result.workItem, await readWorkItems(), {
    changed: !result.idempotentReplay,
    idempotentReplay: result.idempotentReplay,
  });
}

export async function createWorkItem(payload) {
  return serializeWorkItemMutation(() => createWorkItemUnlocked(payload));
}

async function patchWorkItemUnlocked(key, updates, options = {}) {
  const items = await readWorkItems();
  const normalizedKey = String(key || "").toUpperCase();
  const index = items.findIndex((item) => item.key === normalizedKey);

  if (index === -1) {
    throw Object.assign(new Error("Work packet not found"), { statusCode: 404 });
  }

  const allowedFields = new Set([
    "title",
    "status",
    "priority",
    "project",
    "repo",
    "labels",
    "suggestedBranch",
    "summary",
    "desiredOutcome",
    "acceptanceCriteria",
    "relevantFiles",
    "relevantUrls",
    "implementationNotes",
    "testCommands",
    "deployNotes",
    "blockedBy",
    "githubBranch",
    "githubPrUrl",
    "githubIssueUrl",
    "githubIssueNumber",
    "githubIssueTitle",
    "agent",
    "claimedBy",
    "claimedAt",
    "agentRunId",
    "leaseExpiresAt",
  ]);
  const listFields = new Set(["acceptanceCriteria", "relevantFiles", "relevantUrls", "implementationNotes", "testCommands"]);
  const cleaned = {};

  for (const [field, value] of Object.entries(updates || {})) {
    if (value === undefined) {
      continue;
    }

    if (!allowedFields.has(field)) {
      continue;
    }

    if (field === "status" && !allowedStatuses.has(value)) {
      throw Object.assign(new Error(`Invalid status: ${value}`), { statusCode: 400 });
    }

    if (field === "priority" && !allowedPriorities.has(value)) {
      throw Object.assign(new Error(`Invalid priority: ${value}`), { statusCode: 400 });
    }

    cleaned[field] =
      field === "labels"
        ? splitLabels(value)
        : field === "githubIssueNumber"
          ? Number(value) || null
          : listFields.has(field)
            ? splitLines(value)
            : value;
  }

  const currentItem = items[index];
  const now = new Date().toISOString();
  const isNewCompletion = cleaned.status === "done" && currentItem.status !== "done";
  const decision = isNewCompletion
    ? completionDecision(currentItem, trustedCompletionWriteback(updates, options.verifiedCompletionWriteback))
    : null;
  const completion = hasPayloadField(cleaned, "status")
    ? completionState(currentItem, cleaned.status, decision, now, options.principal)
    : {
        completionEvidence: currentItem.completionEvidence || null,
        completionOverride: currentItem.completionOverride || null,
      };
  const overrideEvent = completion.completionOverride && decision
    ? {
        type: "completion_override",
        at: now,
        agent: completion.completionOverride.actor,
        status: "done",
        note: completion.completionOverride.reason,
        reason: completion.completionOverride.reason,
      }
    : null;
  const nextItem = {
    ...currentItem,
    ...cleaned,
    ...completion,
    agentEvents: overrideEvent ? appendAgentEvent(currentItem, overrideEvent) : currentItem.agentEvents || [],
    completedAt: Object.prototype.hasOwnProperty.call(cleaned, "status")
      ? resolveCompletedAt(currentItem, cleaned.status, now)
      : currentItem.completedAt || "",
    updatedAt: now,
  };
  return commitWorkItemMutation(items, index, nextItem, {
    expectedRevision: options.expectedRevision ?? updates.expectedRevision,
    idempotencyKey: options.idempotencyKey || updates.idempotencyKey,
  });
}

export async function patchWorkItem(key, updates, options = {}) {
  return serializeWorkItemMutation(() => patchWorkItemUnlocked(key, updates, options));
}

async function claimWorkItemUnlocked(key, payload = {}, { allowForce = false } = {}) {
  const items = await readWorkItems();
  const normalizedKey = String(key || "").toUpperCase();
  const index = items.findIndex((item) => item.key === normalizedKey);

  if (index === -1) {
    throw Object.assign(new Error("Work packet not found"), { statusCode: 404 });
  }

  const currentItem = items[index];
  const now = new Date();
  const replay = replayedWorkItemMutation(currentItem, items, payload.idempotencyKey);

  if (replay) {
    return replay;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "expectedAgentRunId")) {
    assertExpectedAgentRunId(currentItem, payload.expectedAgentRunId);
  }

  const requestedForce = Boolean(payload.force);
  const force = requestedForce && allowForce;

  if (isLeaseActive(currentItem, now) && requestedForce && !allowForce) {
    throw Object.assign(
      new Error("Force-claiming an active lease requires an operator"),
      { statusCode: 403 },
    );
  }

  if (isLeaseActive(currentItem, now) && !force) {
    throw Object.assign(
      new Error(
        `${currentItem.key} is already claimed by ${currentItem.claimedBy || currentItem.agent || "another agent"} until ${currentItem.leaseExpiresAt}`,
      ),
      { statusCode: 409 },
    );
  }

  const leaseMinutes = normalizeLeaseMinutes(payload.leaseMinutes);
  const claimedAt = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + leaseMinutes * 60_000).toISOString();
  const agentName = normalizeAgentName(payload, currentItem.agent || "Unspecified agent");
  const agentRunId = String(payload.agentRunId || "").trim() || buildAgentRunId(currentItem.key);
  const note = String(payload.note || `Claimed for ${leaseMinutes} minutes.`).trim();
  const agent = String(payload.agent || currentItem.agent || "").trim();
  const event = {
    type: "claimed",
    at: claimedAt,
    agent: agentName,
    agentRunId,
    leaseExpiresAt,
    note,
  };
  const nextItem = {
    ...currentItem,
    status: "claimed",
    agent,
    claimedBy: agentName,
    claimedAt,
    agentRunId,
    leaseExpiresAt,
    lastAgentUpdate: {
      at: claimedAt,
      agent: agentName,
      status: "claimed",
      note,
      agentRunId,
    },
    agentEvents: appendAgentEvent(currentItem, event),
    ...emptyCompletionState(),
    updatedAt: claimedAt,
  };
  return commitWorkItemMutation(items, index, nextItem, {
    expectedRevision: payload.expectedRevision,
    idempotencyKey: payload.idempotencyKey,
  });
}

export async function claimWorkItem(key, payload = {}, { allowForce = false } = {}) {
  return serializeWorkItemMutation(() => claimWorkItemUnlocked(key, payload, { allowForce }));
}

function assertExpectedAgentRunId(currentItem, expectedAgentRunId) {
  const expected = String(expectedAgentRunId || "").trim();
  const current = String(currentItem.agentRunId || "").trim();

  if (expected !== current) {
    throw Object.assign(
      new Error("The agent run changed before recovery. Refresh the board and try again."),
      { statusCode: 409 },
    );
  }
}

function assertObservedAgentRun(currentItem, payload) {
  if (!Object.prototype.hasOwnProperty.call(payload || {}, "agentRunId")) {
    throw Object.assign(new Error("The observed agent run ID is required for recovery actions"), { statusCode: 400 });
  }

  assertExpectedAgentRunId(currentItem, payload.agentRunId);
}

async function readObservedRecoveryItem(key, payload) {
  const items = await readWorkItems();
  const normalizedKey = String(key || "").toUpperCase();
  const index = items.findIndex((item) => item.key === normalizedKey);

  if (index === -1) {
    throw Object.assign(new Error("Work packet not found"), { statusCode: 404 });
  }

  const currentItem = items[index];
  const now = new Date();
  const action = String(payload.action || "").trim().toLowerCase();
  assertObservedAgentRun(currentItem, payload);
  const health = deriveAgentRunHealth(currentItem, now);
  const allowedActions = new Set(health.actions.map((candidate) => candidate.id));

  if (!allowedActions.has(action)) {
    throw Object.assign(
      new Error(`${action} is not available while the agent run is ${health.state}`),
      { statusCode: 409 },
    );
  }

  return { items, index, currentItem, now, health };
}

function recoveryActor(payload = {}, authenticatedActor = "") {
  return String(authenticatedActor || payload.agent || payload.claimedBy || "Operator").trim() || "Operator";
}

export async function recoverAgentRun(key, payload = {}, { actor: authenticatedActor } = {}) {
  return serializeWorkItemMutation(async () => {
    const action = String(payload.action || "").trim().toLowerCase();

    if (!["release", "reclaim", "extend"].includes(action)) {
      throw Object.assign(new Error("Recovery action must be release, reclaim, or extend"), { statusCode: 400 });
    }

    if (!Object.prototype.hasOwnProperty.call(payload || {}, "agentRunId")) {
      throw Object.assign(new Error("The observed agent run ID is required for recovery actions"), { statusCode: 400 });
    }

    if (action === "reclaim") {
      const preview = await readObservedRecoveryItem(key, { ...payload, action });
      const previousRunId = String(preview.currentItem.agentRunId || "").trim() || "missing run context";
      const result = await claimWorkItemUnlocked(key, {
        agent: payload.agent || preview.currentItem.claimedBy || preview.currentItem.agent || "Operator",
        claimedBy: payload.agent || preview.currentItem.claimedBy || preview.currentItem.agent || "Operator",
        leaseMinutes: payload.leaseMinutes,
        force: true,
        expectedAgentRunId: payload.agentRunId,
        expectedRevision: payload.expectedRevision,
        idempotencyKey: payload.idempotencyKey,
        note: String(payload.note || `Reclaimed from ${previousRunId}.`).trim(),
      }, { allowForce: true });
      return { action, ...result };
    }

    const { items, index, currentItem, now } = await readObservedRecoveryItem(key, { ...payload, action });
    const at = now.toISOString();
    const note = String(payload.note || "").trim();
    const actor = recoveryActor(payload, authenticatedActor);

    if (action === "extend") {
      const leaseMinutes = normalizeLeaseMinutes(payload.leaseMinutes || AGENT_RUN_EXTEND_LEASE_MINUTES);
      const currentExpiry = Date.parse(currentItem.leaseExpiresAt || "");
      const extendedFrom = Number.isFinite(currentExpiry) && currentExpiry > now.getTime() ? currentExpiry : now.getTime();
      const leaseExpiresAt = new Date(extendedFrom + leaseMinutes * 60_000).toISOString();
      const recoveryNote = note || `Extended the lease by ${leaseMinutes} minutes.`;
      const event = {
        type: "recovery",
        action,
        at,
        agent: actor,
        agentRunId: currentItem.agentRunId || "",
        leaseExpiresAt,
        note: recoveryNote,
      };
      const nextItem = {
        ...currentItem,
        leaseExpiresAt,
        lastAgentUpdate: {
          at,
          agent: actor,
          status: currentItem.status,
          note: recoveryNote,
          agentRunId: currentItem.agentRunId || "",
        },
        agentEvents: appendAgentEvent(currentItem, event),
        updatedAt: at,
      };
      return {
        action,
        ...await commitWorkItemMutation(items, index, nextItem, {
          expectedRevision: payload.expectedRevision,
          idempotencyKey: payload.idempotencyKey,
        }),
      };
    }

    const previousRunId = currentItem.agentRunId || "";
    const recoveryNote = note || `Released ${previousRunId || "incomplete agent run"}.`;
    const event = {
      type: "recovery",
      action,
      at,
      agent: actor,
      agentRunId: previousRunId,
      note: recoveryNote,
    };
    const nextItem = {
      ...currentItem,
      status: "ready_for_agent",
      claimedBy: "",
      claimedAt: "",
      agentRunId: "",
      leaseExpiresAt: "",
      blockedBy: "",
      lastAgentUpdate: {
        at,
        agent: actor,
        status: "ready_for_agent",
        note: recoveryNote,
        agentRunId: previousRunId,
      },
      agentEvents: appendAgentEvent(currentItem, event),
      ...emptyCompletionState(),
      updatedAt: at,
    };
    return {
      action,
      ...await commitWorkItemMutation(items, index, nextItem, {
        expectedRevision: payload.expectedRevision,
        idempotencyKey: payload.idempotencyKey,
      }),
    };
  });
}

async function updateTaskStatusUnlocked(key, payload = {}, options = {}) {
  const status = String(payload.status || "").trim();

  if (!allowedStatuses.has(status)) {
    throw Object.assign(new Error(`Invalid status: ${status}`), { statusCode: 400 });
  }

  const items = await readWorkItems();
  const normalizedKey = String(key || "").toUpperCase();
  const index = items.findIndex((item) => item.key === normalizedKey);

  if (index === -1) {
    throw Object.assign(new Error("Work packet not found"), { statusCode: 404 });
  }

  const currentItem = items[index];
  const now = new Date().toISOString();
  const agentName = String(payload.agent || currentItem.claimedBy || currentItem.agent || "Unspecified agent").trim();
  const agentRunId = String(payload.agentRunId || currentItem.agentRunId || "").trim();
  const note = String(payload.note || "").trim();
  const suppliedTestsRun = splitWritebackLines(payload, "testsRun", "testCommandsRun");
  const suppliedFilesChanged = splitWritebackLines(payload, "filesChanged");
  const suppliedEvidenceCollection = normalizeEvidenceCollection(payload.evidenceCollection, {
    testsRun: suppliedTestsRun,
    filesChanged: suppliedFilesChanged,
  });
  const blockers = splitWritebackLines(payload, "blockers");
  const nextSteps = splitWritebackLines(payload, "nextSteps");
  const githubBranch = payload.githubBranch === undefined ? currentItem.githubBranch : String(payload.githubBranch || "").trim();
  const githubPrUrl = payload.githubPrUrl === undefined ? currentItem.githubPrUrl : String(payload.githubPrUrl || "").trim();
  const normalizedWriteback = {
    ...payload,
    ...(hasPayloadField(payload, "testsRun") || hasPayloadField(payload, "testCommandsRun")
      ? { testsRun: suppliedTestsRun }
      : {}),
    ...(hasPayloadField(payload, "filesChanged") ? { filesChanged: suppliedFilesChanged } : {}),
    ...(hasPayloadField(payload, "evidenceCollection") ||
    hasPayloadField(payload, "testsRun") ||
    hasPayloadField(payload, "testCommandsRun") ||
    hasPayloadField(payload, "filesChanged")
      ? { evidenceCollection: suppliedEvidenceCollection }
      : {}),
  };
  const isNewCompletion = status === "done" && currentItem.status !== "done";
  const completionWriteback = isNewCompletion
    ? trustedCompletionWriteback(payload, options.verifiedCompletionWriteback)
    : normalizedWriteback;
  const testsRun = isNewCompletion ? completionWriteback.testsRun : suppliedTestsRun;
  const filesChanged = isNewCompletion ? completionWriteback.filesChanged : suppliedFilesChanged;
  const evidenceCollection = isNewCompletion
    ? completionWriteback.evidenceCollection
    : suppliedEvidenceCollection;
  const decision = isNewCompletion ? completionDecision(currentItem, completionWriteback) : null;
  const lastAgentUpdate = {
    at: now,
    agent: agentName,
    status,
    note,
    agentRunId,
    githubBranch,
    githubPrUrl,
    testsRun,
    filesChanged,
    evidenceCollection,
    blockers,
    nextSteps,
  };
  const completion = completionState(currentItem, status, decision, now, options.principal);
  const event = {
    type: decision?.overrideReason ? "completion_override" : "status",
    at: now,
    agent: decision?.overrideReason ? completion.completionOverride.actor : agentName,
    status,
    note: note || decision?.overrideReason || "",
    agentRunId,
    githubBranch,
    githubPrUrl,
    testsRun,
    filesChanged,
    evidenceCollection,
    blockers,
    nextSteps,
    ...(decision?.overrideReason ? { completionOverrideReason: decision.overrideReason } : {}),
  };
  const nextItem = {
    ...currentItem,
    status,
    agent: payload.agent === undefined ? currentItem.agent : String(payload.agent || "").trim(),
    githubBranch,
    githubPrUrl,
    blockedBy: hasPayloadField(payload, "blockers") ? blockers.join("\n") : currentItem.blockedBy,
    leaseExpiresAt: completedStatuses.has(status) ? "" : currentItem.leaseExpiresAt,
    completedAt: resolveCompletedAt(currentItem, status, now),
    ...completion,
    lastAgentUpdate,
    agentEvents: appendAgentEvent(currentItem, event),
    updatedAt: now,
  };
  return commitWorkItemMutation(items, index, nextItem, {
    expectedRevision: options.expectedRevision ?? payload.expectedRevision,
    idempotencyKey: options.idempotencyKey || payload.idempotencyKey,
  });
}

export async function updateTaskStatus(key, payload = {}, options = {}) {
  return serializeWorkItemMutation(() => updateTaskStatusUnlocked(key, payload, options));
}

async function applyGithubMatchesUnlocked(key, matches = {}) {
  const items = await readWorkItems();
  const normalizedKey = String(key || "").toUpperCase();
  const index = items.findIndex((item) => item.key === normalizedKey);

  if (index === -1) {
    throw Object.assign(new Error("Work packet not found"), { statusCode: 404 });
  }

  const currentItem = items[index];
  const now = new Date().toISOString();
  const matchCount = countGithubMatches(matches);
  const nextItem = {
    ...currentItem,
    githubBranch: matches.bestBranch || currentItem.githubBranch || "",
    githubPrUrl: matches.bestPrUrl || currentItem.githubPrUrl || "",
    githubLinks: {
      ...matches,
      matchedAt: matches.matchedAt || now,
    },
    lastGithubLinkUpdate: {
      at: now,
      source: matches.source || "github-cache",
      matchCount,
    },
    updatedAt: now,
  };
  return commitWorkItemMutation(items, index, nextItem, {
    expectedRevision: matches.expectedRevision,
    idempotencyKey: matches.idempotencyKey,
  });
}

export async function applyGithubMatches(key, matches = {}) {
  return serializeWorkItemMutation(() => applyGithubMatchesUnlocked(key, matches));
}

async function recordGithubIssueUnlocked(key, issue = {}) {
  const items = await readWorkItems();
  const normalizedKey = String(key || "").toUpperCase();
  const index = items.findIndex((item) => item.key === normalizedKey);

  if (index === -1) {
    throw Object.assign(new Error("Work packet not found"), { statusCode: 404 });
  }

  const currentItem = items[index];
  const now = new Date().toISOString();
  const issueUrl = String(issue.url || issue.html_url || "").trim();
  const issueNumber = issue.number ? Number(issue.number) : null;
  const issueTitle = String(issue.title || currentItem.githubIssueTitle || "").trim();
  const nextItem = {
    ...currentItem,
    githubIssueUrl: issueUrl || currentItem.githubIssueUrl || "",
    githubIssueNumber: issueNumber || currentItem.githubIssueNumber || null,
    githubIssueTitle: issueTitle,
    relevantUrls: issueUrl ? uniqueLines([...(currentItem.relevantUrls || []), issueUrl]) : currentItem.relevantUrls,
    lastGithubLinkUpdate: {
      at: now,
      source: issue.source || "github-issue",
      matchCount: 1,
    },
    updatedAt: now,
  };
  return commitWorkItemMutation(items, index, nextItem, {
    expectedRevision: issue.expectedRevision,
    idempotencyKey: issue.idempotencyKey || (issueUrl ? `github-issue:${issueUrl}` : ""),
  });
}

export async function recordGithubIssue(key, issue = {}) {
  return serializeWorkItemMutation(() => recordGithubIssueUnlocked(key, issue));
}

async function importGithubIssuesUnlocked(githubCache, { repo: repoFilter = "", limit = 12 } = {}) {
  const items = await readWorkItems();
  const existingIssueUrls = new Set(
    items.flatMap((item) => [item.githubIssueUrl, ...(Array.isArray(item.relevantUrls) ? item.relevantUrls : [])]).filter(Boolean),
  );
  const now = new Date().toISOString();
  const imported = [];
  const skipped = [];
  const maxImports = Math.min(Math.max(Number(limit) || 12, 1), 50);

  for (const repo of githubCache?.repos || []) {
    if (repoFilter && repo.id !== repoFilter && repo.name !== repoFilter && repo.slug !== repoFilter) {
      continue;
    }

    for (const issue of repo.latestIssues || []) {
      if (imported.length >= maxImports) {
        break;
      }

      if (!issue?.url || existingIssueUrls.has(issue.url)) {
        skipped.push({ repo: repo.id, url: issue?.url || "", reason: "already imported" });
        continue;
      }

      const title = String(issue.title || `GitHub issue #${issue.number}`).trim();
      const result = await createWorkItemUnlocked({
        title,
        status: "draft",
        priority: "medium",
        project: repo.domain || repo.name || "GitHub import",
        repo: repo.id || repo.name || "",
        labels: splitLabels([...(issue.labels || []), "github-sync"]),
        summary: `Imported from GitHub issue #${issue.number || "unknown"} in ${repo.slug || repo.name}.`,
        desiredOutcome: "Triage this GitHub issue and turn it into an agent-ready work packet.",
        acceptanceCriteria: [
          "The underlying GitHub issue is understood and scoped.",
          "Acceptance criteria, relevant files, and test commands are completed before agent pickup.",
        ],
        relevantFiles: [],
        relevantUrls: [issue.url],
        implementationNotes: [
          `Imported from GitHub cache source ${githubCache?.source || "unknown"}.`,
          "Edit this draft before marking it ready for agent pickup.",
        ],
        testCommands: [],
        deployNotes: "Not recorded.",
        blockedBy: "",
        githubBranch: "",
        githubPrUrl: "",
        githubIssueUrl: issue.url,
        githubIssueNumber: issue.number ? Number(issue.number) : null,
        githubIssueTitle: title,
        githubLinks: {
          repoId: repo.id || "",
          repoSlug: repo.slug || "",
          source: githubCache?.source || "github-cache",
          matchedAt: now,
          bestBranch: "",
          bestPrUrl: "",
          pullRequests: [],
          branches: [],
          issues: [issue],
          workflowRuns: [],
        },
        lastGithubLinkUpdate: {
          at: now,
          source: githubCache?.source || "github-cache",
          matchCount: 1,
        },
        idempotencyKey: `github-import:${issue.url}`,
      });
      const workItem = result.workItem;

      if (result.idempotentReplay) {
        skipped.push({ repo: repo.id, url: issue.url, reason: "already imported" });
        existingIssueUrls.add(issue.url);
        continue;
      }

      existingIssueUrls.add(issue.url);
      imported.push({
        key: workItem.key,
        repo: workItem.repo,
        issueNumber: workItem.githubIssueNumber,
        issueUrl: workItem.githubIssueUrl,
        title: workItem.title,
      });
    }
  }

  return {
    imported,
    skipped,
    workItems: await listWorkItems(),
  };
}

export async function importGithubIssues(githubCache, options = {}) {
  return serializeWorkItemMutation(() => importGithubIssuesUnlocked(githubCache, options));
}

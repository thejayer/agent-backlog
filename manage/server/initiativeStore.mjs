import { randomUUID } from "node:crypto";
import { getWorkItemKeyPrefix, readJsonState, writeJsonState } from "./storage.mjs";

const allowedStatuses = new Set(["planned", "active", "paused", "complete"]);
const allowedHealth = new Set(["on_track", "watch", "blocked"]);

function cleanLines(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);
  return [...new Set(values.map((entry) => String(entry || "").trim()).filter(Boolean))];
}

function packetKeyPattern() {
  return new RegExp(`^${getWorkItemKeyPrefix()}-\\d+$`);
}

export function cleanPacketKeys(value) {
  return [...new Set(cleanLines(value)
    .map((key) => key.toUpperCase())
    .filter((key) => packetKeyPattern().test(key)))];
}

function normalizeInitiative(initiative) {
  return {
    id: String(initiative.id || "").trim(),
    title: String(initiative.title || "Untitled initiative").trim(),
    objective: String(initiative.objective || "").trim(),
    owner: String(initiative.owner || "").trim(),
    status: allowedStatuses.has(initiative.status) ? initiative.status : "planned",
    health: allowedHealth.has(initiative.health) ? initiative.health : "on_track",
    targetDate: String(initiative.targetDate || "").trim(),
    nextAction: String(initiative.nextAction || "").trim(),
    blocker: String(initiative.blocker || "").trim(),
    completionCriteria: cleanLines(initiative.completionCriteria),
    labels: cleanLines(initiative.labels),
    groupingGuidance: String(initiative.groupingGuidance || "").trim(),
    packetKeys: cleanPacketKeys(initiative.packetKeys),
    _persistence: {
      createOperationId: String(initiative?._persistence?.createOperationId || "").trim(),
    },
    createdAt: initiative.createdAt || new Date().toISOString(),
    updatedAt: initiative.updatedAt || initiative.createdAt || new Date().toISOString(),
  };
}

function publicInitiative(initiative) {
  const { _persistence, ...result } = initiative;
  return result;
}

function publicInitiativeResult(initiative, initiatives, extra = {}) {
  return {
    initiative: publicInitiative(initiative),
    initiatives: initiatives.map(publicInitiative),
    ...extra,
  };
}

function assertControlledFields(payload) {
  if (payload.status !== undefined && !allowedStatuses.has(payload.status)) {
    throw Object.assign(new Error(`Invalid initiative status: ${payload.status}`), { statusCode: 400 });
  }

  if (payload.health !== undefined && !allowedHealth.has(payload.health)) {
    throw Object.assign(new Error(`Invalid initiative health: ${payload.health}`), { statusCode: 400 });
  }
}

async function readInitiatives() {
  const initiatives = await readJsonState("initiatives", () => []);

  if (!Array.isArray(initiatives)) {
    throw Object.assign(new Error("Manage initiatives state must contain an array"), { statusCode: 500 });
  }

  return initiatives.map(normalizeInitiative);
}

export async function listInitiatives() {
  return (await readInitiatives()).map(publicInitiative);
}

export async function resetInitiatives() {
  await writeJsonState("initiatives", []);
  return [];
}

export async function createInitiative(payload = {}) {
  const initiatives = await readInitiatives();
  const createOperationId = String(payload.idempotencyKey || "").trim();
  const replay = createOperationId
    ? initiatives.find((initiative) => initiative._persistence.createOperationId === createOperationId)
    : null;

  if (replay) {
    return publicInitiativeResult(replay, initiatives, { idempotentReplay: true });
  }

  const now = new Date().toISOString();
  const title = String(payload.title || "").trim();

  if (!title) {
    throw Object.assign(new Error("Initiative title is required"), { statusCode: 400 });
  }

  assertControlledFields(payload);

  const initiative = normalizeInitiative({
    ...payload,
    title,
    id: `initiative-${randomUUID()}`,
    _persistence: { createOperationId },
    createdAt: now,
    updatedAt: now,
  });

  const next = [initiative, ...initiatives];
  await writeJsonState("initiatives", next);
  return publicInitiativeResult(initiative, next, { idempotentReplay: false });
}

export async function patchInitiative(id, updates = {}) {
  const initiatives = await readInitiatives();
  const index = initiatives.findIndex((initiative) => initiative.id === id);

  if (index < 0) {
    throw Object.assign(new Error("Initiative not found"), { statusCode: 404 });
  }

  assertControlledFields(updates);

  const initiative = normalizeInitiative({
    ...initiatives[index],
    ...updates,
    id,
    _persistence: initiatives[index]._persistence,
    createdAt: initiatives[index].createdAt,
    updatedAt: new Date().toISOString(),
  });
  const next = [...initiatives];
  next[index] = initiative;
  await writeJsonState("initiatives", next);
  return publicInitiativeResult(initiative, next);
}

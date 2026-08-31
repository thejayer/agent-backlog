import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { getManageDataDir, getPacketEventsPath } from "./paths.mjs";

export const PACKET_EVENT_KINDS = Object.freeze(["lifecycle", "human_note", "heartbeat", "github"]);
export const GITHUB_EVENT_TYPES = Object.freeze(["pull_request", "check_run", "check_suite", "status"]);
export const HEARTBEAT_STATES = Object.freeze(["running", "waiting", "blocked", "idle", "failed"]);

const SENSITIVE_KEY_PATTERN = /(secret|token|password|authorization|cookie|private[_-]?key|access[_-]?key|refresh[_-]?token|api[_-]?key|credential)/i;
const SENSITIVE_GITHUB_KEYS = new Set([
  "body",
  "diff",
  "patch",
  "commits",
  "files",
  "head_commit",
  "email",
  "emails",
  "token",
  "secrets",
]);

let firestoreClientPromise = null;

function getStorageBackend() {
  return String(process.env.MANAGE_STORAGE_BACKEND || process.env.MANAGE_STORAGE_DRIVER || "file").trim().toLowerCase();
}

export function getFirestorePacketEventCollection() {
  const stateCollection = String(process.env.MANAGE_FIRESTORE_COLLECTION || "manage_state").trim();
  return String(process.env.MANAGE_FIRESTORE_PACKET_EVENT_COLLECTION || `${stateCollection}_packet_events`).trim();
}

function getPacketEventLogPath() {
  return getPacketEventsPath();
}

async function getFirestoreClient() {
  if (!firestoreClientPromise) {
    firestoreClientPromise = import("@google-cloud/firestore").then((firestoreModule) => {
      const Firestore = firestoreModule.Firestore || firestoreModule.default?.Firestore;
      const options = {};
      const projectId =
        process.env.MANAGE_FIRESTORE_PROJECT_ID
        || process.env.GOOGLE_CLOUD_PROJECT
        || process.env.GCP_PROJECT
        || process.env.GCLOUD_PROJECT;
      const databaseId = process.env.MANAGE_FIRESTORE_DATABASE_ID;

      if (!Firestore) {
        throw new Error("@google-cloud/firestore did not expose a Firestore client");
      }

      if (projectId) options.projectId = projectId;
      if (databaseId) options.databaseId = databaseId;
      return new Firestore(options);
    }).catch((error) => {
      firestoreClientPromise = null;
      throw error;
    });
  }

  return firestoreClientPromise;
}

function cloneJson(value) {
  return value == null ? {} : JSON.parse(JSON.stringify(value));
}

export function sanitizePacketEventPayload(value, { depth = 0, github = false } = {}) {
  if (value == null || typeof value !== "object") {
    return value;
  }

  if (depth > 4) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizePacketEventPayload(entry, { depth: depth + 1, github }));
  }

  const sanitized = {};

  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key) || (github && SENSITIVE_GITHUB_KEYS.has(key))) {
      continue;
    }

    if (typeof entry === "string") {
      sanitized[key] = entry.length > 500 ? `${entry.slice(0, 500)}…` : entry;
      continue;
    }

    const next = sanitizePacketEventPayload(entry, { depth: depth + 1, github });
    if (next !== undefined) {
      sanitized[key] = next;
    }
  }

  return sanitized;
}

export function packetEventIdFromParts(parts) {
  const basis = parts.map((part) => String(part || "").trim()).join("|");
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

function normalizeActor(actor = {}) {
  return {
    agent: String(actor.agent || "").trim(),
    agentRunId: String(actor.agentRunId || "").trim(),
    login: String(actor.login || "").trim(),
  };
}

export function normalizePacketEvent(event = {}) {
  const kind = String(event.kind || "").trim();
  const type = String(event.type || "").trim();
  const packetKey = String(event.packetKey || "").trim().toUpperCase();
  const source = String(event.source || "").trim();
  const at = String(event.at || new Date().toISOString()).trim();

  if (!packetKey) {
    throw Object.assign(new Error("Packet event requires packetKey"), { statusCode: 400 });
  }

  if (!PACKET_EVENT_KINDS.includes(kind)) {
    throw Object.assign(new Error(`Unsupported packet event kind: ${kind || "(empty)"}`), { statusCode: 400 });
  }

  if (!type) {
    throw Object.assign(new Error("Packet event requires type"), { statusCode: 400 });
  }

  if (kind === "github" && !GITHUB_EVENT_TYPES.includes(type)) {
    throw Object.assign(new Error(`Unsupported GitHub event type: ${type}`), { statusCode: 400 });
  }

  if (kind === "heartbeat" && event.state && !HEARTBEAT_STATES.includes(event.state)) {
    throw Object.assign(new Error(`Unsupported heartbeat state: ${event.state}`), { statusCode: 400 });
  }

  const evidenceUrl = String(event.evidenceUrl || "").trim();
  if (evidenceUrl && !/^https:\/\/(github\.com|cursor\.com)\//i.test(evidenceUrl) && !evidenceUrl.startsWith("/")) {
    throw Object.assign(new Error("Packet event evidenceUrl must be a trusted https link"), { statusCode: 400 });
  }

  return {
    id: String(event.id || `evt-${randomUUID()}`).trim(),
    packetKey,
    at,
    kind,
    type,
    source: source || (kind === "github" ? "github" : kind === "human_note" ? "human" : "manage"),
    actor: normalizeActor(event.actor),
    summary: String(event.summary || event.note || "").trim().slice(0, 500),
    evidenceUrl,
    state: kind === "heartbeat" ? String(event.state || "").trim() : "",
    currentStep: kind === "heartbeat" ? String(event.currentStep || event.step || "").trim().slice(0, 200) : "",
    payload: sanitizePacketEventPayload(event.payload || {}, { github: kind === "github" }),
  };
}

export function lifecyclePacketEvent(workItem, event = {}) {
  const packetKey = String(workItem?.key || "").trim().toUpperCase();
  const type = String(event.type || "status").trim();
  const at = String(event.at || new Date().toISOString()).trim();
  return normalizePacketEvent({
    id: `lifecycle-${packetEventIdFromParts([packetKey, type, at, event.agentRunId, event.note])}`,
    packetKey,
    at,
    kind: "lifecycle",
    type,
    source: "manage",
    actor: {
      agent: event.agent || workItem?.claimedBy || workItem?.agent,
      agentRunId: event.agentRunId || workItem?.agentRunId,
      login: event.login || "",
    },
    summary: event.note || event.summary || type,
    evidenceUrl: event.githubPrUrl || event.evidenceUrl || workItem?.githubPrUrl || "",
    payload: {
      status: event.status || workItem?.status || "",
      githubBranch: event.githubBranch || workItem?.githubBranch || "",
      githubPrUrl: event.githubPrUrl || workItem?.githubPrUrl || "",
      testsRun: Array.isArray(event.testsRun) ? event.testsRun.slice(0, 20) : [],
      filesChanged: Array.isArray(event.filesChanged) ? event.filesChanged.slice(0, 20) : [],
      blockers: Array.isArray(event.blockers) ? event.blockers.slice(0, 20) : [],
      nextSteps: Array.isArray(event.nextSteps) ? event.nextSteps.slice(0, 20) : [],
      leaseExpiresAt: event.leaseExpiresAt || "",
    },
  });
}

async function readFileEvents() {
  let raw = "";

  try {
    raw = await fs.readFile(getPacketEventLogPath(), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const events = [];

  for (const line of raw.split(/\r?\n/)) {
    const value = line.trim();
    if (!value) continue;

    try {
      events.push(normalizePacketEvent(JSON.parse(value)));
    } catch {
      // An interrupted append must not make the remaining trail unreadable.
    }
  }

  return events;
}

export async function findPacketEventById(id) {
  const eventId = String(id || "").trim();
  if (!eventId) return null;

  const backend = getStorageBackend();

  if (backend === "file") {
    return (await readFileEvents()).find((event) => event.id === eventId) || null;
  }

  if (backend === "firestore") {
    const firestore = await getFirestoreClient();
    const snapshot = await firestore.collection(getFirestorePacketEventCollection()).doc(eventId).get();
    return snapshot.exists ? normalizePacketEvent(snapshot.data()) : null;
  }

  throw new Error(`Unsupported MANAGE_STORAGE_BACKEND: ${backend}`);
}

export async function listPacketEvents(packetKey, { limit = 500 } = {}) {
  const key = String(packetKey || "").trim().toUpperCase();
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const backend = getStorageBackend();

  if (backend === "file") {
    return (await readFileEvents())
      .filter((event) => event.packetKey === key)
      .sort((left, right) => String(left.at).localeCompare(String(right.at)))
      .slice(-safeLimit);
  }

  if (backend === "firestore") {
    const firestore = await getFirestoreClient();
    const snapshot = await firestore
      .collection(getFirestorePacketEventCollection())
      .where("packetKey", "==", key)
      .get();
    return snapshot.docs
      .map((doc) => normalizePacketEvent(doc.data()))
      .sort((left, right) => String(left.at).localeCompare(String(right.at)))
      .slice(-safeLimit);
  }

  throw new Error(`Unsupported MANAGE_STORAGE_BACKEND: ${backend}`);
}

export async function appendPacketEvent(event) {
  const normalized = normalizePacketEvent(event);
  const existing = await findPacketEventById(normalized.id);

  if (existing) {
    return { event: existing, created: false };
  }

  const backend = getStorageBackend();

  if (backend === "file") {
    await fs.mkdir(getManageDataDir(), { recursive: true });
    await fs.appendFile(getPacketEventLogPath(), `${JSON.stringify(normalized)}\n`, "utf8");
    return { event: normalized, created: true };
  }

  if (backend === "firestore") {
    const firestore = await getFirestoreClient();

    try {
      await firestore.collection(getFirestorePacketEventCollection()).doc(normalized.id).create(cloneJson(normalized));
      return { event: normalized, created: true };
    } catch (error) {
      if (error?.code === 6 || /ALREADY_EXISTS/i.test(String(error?.message || ""))) {
        const current = await findPacketEventById(normalized.id);
        return { event: current || normalized, created: false };
      }
      throw error;
    }
  }

  throw new Error(`Unsupported MANAGE_STORAGE_BACKEND: ${backend}`);
}

export async function resetPacketEvents() {
  const backend = getStorageBackend();

  if (backend === "file") {
    await fs.rm(getPacketEventLogPath(), { force: true });
    return;
  }

  if (backend === "firestore") {
    const firestore = await getFirestoreClient();
    const snapshot = await firestore.collection(getFirestorePacketEventCollection()).get();
    const deletes = snapshot.docs.map((doc) => doc.ref.delete());
    await Promise.all(deletes);
    return;
  }

  throw new Error(`Unsupported MANAGE_STORAGE_BACKEND: ${backend}`);
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { getWorkItemKeyPrefix } from "./storage.mjs";
import { listWorkItems } from "./workStore.mjs";
import {
  GITHUB_EVENT_TYPES,
  HEARTBEAT_STATES,
  appendPacketEvent,
  lifecyclePacketEvent,
  listPacketEvents,
  normalizePacketEvent,
  packetEventIdFromParts,
  sanitizePacketEventPayload,
} from "./packetEventStore.mjs";

const TRUSTED_GITHUB_HOSTS = new Set(["github.com", "api.github.com"]);

function packetKeyPattern() {
  const prefix = getWorkItemKeyPrefix().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${prefix}-\\d+\\b`, "gi");
}

export function extractPacketKeys(...values) {
  const keys = new Set();
  const pattern = packetKeyPattern();

  for (const value of values) {
    for (const match of String(value || "").matchAll(pattern)) {
      keys.add(match[0].toUpperCase());
    }
  }

  return [...keys];
}

export function latestHeartbeat(events = []) {
  return [...events].reverse().find((event) => event.kind === "heartbeat") || null;
}

function compareEvents(left, right) {
  const timeDelta = String(left.at || "").localeCompare(String(right.at || ""));
  if (timeDelta !== 0) return timeDelta;
  return String(left.id || "").localeCompare(String(right.id || ""));
}

export function mergePacketRoomEvents(durableEvents = [], workItem = {}) {
  const merged = new Map();

  for (const event of durableEvents) {
    merged.set(event.id, event);
  }

  for (const event of workItem.agentEvents || []) {
    const normalized = lifecyclePacketEvent(workItem, event);
    if (!merged.has(normalized.id)) {
      merged.set(normalized.id, normalized);
    }
  }

  if (workItem.lastAgentUpdate && !(workItem.agentEvents || []).some((event) => (
    event.at === workItem.lastAgentUpdate.at
    && (event.note || "") === (workItem.lastAgentUpdate.note || "")
  ))) {
    const normalized = lifecyclePacketEvent(workItem, {
      ...workItem.lastAgentUpdate,
      type: workItem.lastAgentUpdate.status || "status",
    });
    if (!merged.has(normalized.id)) {
      merged.set(normalized.id, normalized);
    }
  }

  return [...merged.values()].sort(compareEvents);
}

export async function migrateEmbeddedPacketEvents(workItem) {
  const existing = await listPacketEvents(workItem.key);
  if (existing.length > 0) {
    return { events: mergePacketRoomEvents(existing, workItem), migrated: false };
  }

  const seeded = mergePacketRoomEvents([], workItem);

  for (const event of seeded) {
    await appendPacketEvent(event);
  }

  return {
    events: mergePacketRoomEvents(await listPacketEvents(workItem.key), workItem),
    migrated: seeded.length > 0,
  };
}

async function requireWorkItem(key) {
  const items = await listWorkItems();
  const workItem = items.find((item) => item.key === String(key || "").toUpperCase());

  if (!workItem) {
    throw Object.assign(new Error("Work packet not found"), { statusCode: 404 });
  }

  return workItem;
}

export async function loadPacketRoom(key) {
  const workItem = await requireWorkItem(key);
  const { events, migrated } = await migrateEmbeddedPacketEvents(workItem);
  const heartbeat = latestHeartbeat(events);

  return {
    workItem,
    events,
    migrated,
    heartbeat: heartbeat
      ? {
          agent: heartbeat.actor?.agent || "",
          agentRunId: heartbeat.actor?.agentRunId || "",
          state: heartbeat.state || "",
          currentStep: heartbeat.currentStep || "",
          lastSeenAt: heartbeat.at,
          summary: heartbeat.summary || "",
        }
      : null,
  };
}

export async function recordLifecyclePacketEvent(workItem, event) {
  if (!workItem?.key || !event) {
    return null;
  }

  const { event: recorded } = await appendPacketEvent(lifecyclePacketEvent(workItem, event));
  return recorded;
}

export async function recordHumanPacketNote(key, payload = {}, actor = {}) {
  const workItem = await requireWorkItem(key);
  const summary = String(payload.summary || payload.note || "").trim();
  if (!summary) {
    throw Object.assign(new Error("Human note requires summary"), { statusCode: 400 });
  }

  const at = new Date().toISOString();
  const { event } = await appendPacketEvent({
    id: `note-${packetEventIdFromParts([workItem.key, at, actor.login, summary])}`,
    packetKey: workItem.key,
    at,
    kind: "human_note",
    type: "note",
    source: "human",
    actor: { login: actor.login || "", agent: actor.agent || "" },
    summary,
    evidenceUrl: payload.evidenceUrl || "",
  });

  return event;
}

export async function recordAgentHeartbeat(key, payload = {}, actor = {}) {
  const workItem = await requireWorkItem(key);
  const state = String(payload.state || "running").trim();
  if (!HEARTBEAT_STATES.includes(state)) {
    throw Object.assign(new Error(`Unsupported heartbeat state: ${state}`), { statusCode: 400 });
  }

  const agentRunId = String(payload.agentRunId || actor.agentRunId || workItem.agentRunId || "").trim();
  const at = new Date().toISOString();
  const currentStep = String(payload.currentStep || payload.step || "").trim();
  const { event } = await appendPacketEvent({
    id: `heartbeat-${packetEventIdFromParts([workItem.key, agentRunId, at, state, currentStep])}`,
    packetKey: workItem.key,
    at,
    kind: "heartbeat",
    type: "heartbeat",
    source: "agent",
    actor: {
      agent: payload.agent || actor.agent || workItem.claimedBy || workItem.agent || "",
      agentRunId,
      login: actor.login || "",
    },
    state,
    currentStep,
    summary: payload.note || payload.summary || currentStep || state,
  });

  return {
    event,
    leaseExpiresAt: workItem.leaseExpiresAt || "",
    claimedBy: workItem.claimedBy || "",
    status: workItem.status,
  };
}

export function verifyGithubWebhookSignature(rawBody, signatureHeader, secret) {
  const signature = String(signatureHeader || "").trim();
  const expectedSecret = String(secret || "").trim();

  if (!expectedSecret) {
    throw Object.assign(new Error("GitHub webhook secret is not configured"), { statusCode: 503 });
  }

  if (!signature.startsWith("sha256=")) {
    throw Object.assign(new Error("GitHub webhook signature is required"), { statusCode: 401 });
  }

  const digest = createHmac("sha256", expectedSecret).update(rawBody).digest("hex");
  const expected = Buffer.from(`sha256=${digest}`);
  const provided = Buffer.from(signature);

  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw Object.assign(new Error("GitHub webhook signature is invalid"), { statusCode: 401 });
  }
}

export function githubEvidenceUrl(payload = {}, type = "") {
  const candidates = [
    payload.html_url,
    payload.pull_request?.html_url,
    payload.check_run?.html_url,
    payload.check_suite?.html_url,
    payload.target_url,
    payload.repository?.html_url,
  ];

  for (const candidate of candidates) {
    try {
      const url = new URL(String(candidate || "").trim());
      if (url.protocol === "https:" && TRUSTED_GITHUB_HOSTS.has(url.hostname)) {
        return url.toString();
      }
    } catch {
      // Ignore untrusted or malformed URLs.
    }
  }

  if (type === "pull_request" && payload.number && payload.repository?.full_name) {
    return `https://github.com/${payload.repository.full_name}/pull/${payload.number}`;
  }

  return "";
}

function githubEntityId(type, payload = {}) {
  if (type === "pull_request") {
    return payload.pull_request?.id || payload.number || payload.pull_request?.number || "";
  }

  if (type === "check_run") {
    return payload.check_run?.id || "";
  }

  if (type === "check_suite") {
    return payload.check_suite?.id || "";
  }

  return payload.sha || payload.id || "";
}

function githubSummary(type, action, payload = {}) {
  if (type === "pull_request") {
    const number = payload.number || payload.pull_request?.number || "";
    const title = payload.pull_request?.title || payload.title || "pull request";
    return `GitHub PR #${number} ${action || payload.action || ""}: ${title}`.trim();
  }

  if (type === "check_run" || type === "check_suite") {
    const name = payload.check_run?.name || payload.check_suite?.app?.name || type;
    const conclusion = payload.check_run?.conclusion || payload.check_suite?.conclusion || payload.state || "";
    return `GitHub ${type.replace("_", " ")} ${conclusion || action || ""}: ${name}`.trim();
  }

  return `GitHub ${type} ${payload.state || action || ""}`.trim();
}

export async function associateGithubPacketKeys(payload = {}, headers = {}) {
  const explicit = String(payload.packetKey || "").trim().toUpperCase();
  const candidates = extractPacketKeys(
    explicit,
    headers["x-github-ref"] || "",
    payload.ref,
    payload.pull_request?.head?.ref,
    payload.pull_request?.title,
    payload.check_run?.head_branch,
    payload.check_suite?.head_branch,
    payload.branches?.[0]?.name,
    payload.packetKeys,
  );
  const items = await listWorkItems();
  const known = new Set(items.map((item) => item.key));
  const matched = (explicit ? [explicit, ...candidates] : candidates).filter((key, index, all) => (
    known.has(key) && all.indexOf(key) === index
  ));

  if (matched.length === 0) {
    throw Object.assign(new Error("GitHub signal did not match a work packet"), { statusCode: 422 });
  }

  return matched;
}

export async function ingestGithubPacketSignal({
  payload = {},
  headers = {},
  rawBody = "",
  actor = {},
} = {}) {
  const type = String(headers["x-github-event"] || payload.event || payload.type || "").trim();
  const action = String(payload.action || payload.state || "").trim();

  if (!GITHUB_EVENT_TYPES.includes(type)) {
    throw Object.assign(new Error(`Unsupported GitHub event type: ${type || "(empty)"}`), { statusCode: 400 });
  }

  const webhookSecret = String(process.env.MANAGE_GITHUB_WEBHOOK_SECRET || "").trim();
  const signature = headers["x-hub-signature-256"] || headers["X-Hub-Signature-256"];

  if (webhookSecret) {
    verifyGithubWebhookSignature(rawBody || JSON.stringify(payload), signature, webhookSecret);
  } else if (!actor.agent && !actor.login) {
    throw Object.assign(new Error("Authenticated GitHub ingestion requires a verified origin"), { statusCode: 401 });
  }

  const packetKeys = await associateGithubPacketKeys(payload, headers);
  const deliveryId = String(headers["x-github-delivery"] || payload.deliveryId || "").trim();
  const entityId = String(githubEntityId(type, payload));
  const evidenceUrl = githubEvidenceUrl(payload, type);
  const events = [];

  for (const packetKey of packetKeys) {
    const id = `github-${packetEventIdFromParts([
      deliveryId || `${type}:${action}:${entityId}`,
      packetKey,
    ])}`;
    const { event, created } = await appendPacketEvent(normalizePacketEvent({
      id,
      packetKey,
      at: payload.updated_at || payload.check_run?.completed_at || new Date().toISOString(),
      kind: "github",
      type,
      source: "github",
      actor: {
        login: actor.login || payload.sender?.login || "",
        agent: actor.agent || "",
      },
      summary: githubSummary(type, action, payload),
      evidenceUrl,
      payload: sanitizePacketEventPayload({
        action,
        number: payload.number || payload.pull_request?.number || "",
        title: payload.pull_request?.title || payload.check_run?.name || "",
        state: payload.pull_request?.state || payload.state || payload.check_run?.status || "",
        conclusion: payload.check_run?.conclusion || payload.check_suite?.conclusion || "",
        branch: payload.pull_request?.head?.ref || payload.check_run?.head_branch || payload.ref || "",
        repository: payload.repository?.full_name || "",
        deliveryId,
      }, { github: true }),
    }));
    events.push({ event, created });
  }

  return { packetKeys, events };
}

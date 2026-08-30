import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { getGithubCachePath, getInitiativesPath, getManageDataDir, getWorkItemsPath } from "./paths.mjs";

const fileReaders = {
  "github-cache": getGithubCachePath,
  "work-items": getWorkItemsPath,
  initiatives: getInitiativesPath,
};

const firestoreDocumentIds = {
  "github-cache": "github-cache",
  "work-items": "work-items",
  initiatives: "initiatives",
};

const stateKeys = new Set(Object.keys(fileReaders));
const firestoreWriteBatchLimit = 500;
const workItemCounterDocumentId = "work-items-counter";
const workItemCreateHistoryLimit = 20;
const workItemCounterReconciliationVersion = 1;
let firestoreClientPromise = null;
let fileWorkItemMutationQueue = Promise.resolve();
const fileStateMutationQueues = new Map();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function serializeFileWorkItemMutation(operation) {
  const result = fileWorkItemMutationQueue.then(operation, operation);
  fileWorkItemMutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function serializeFileStateMutation(key, operation) {
  const queue = fileStateMutationQueues.get(key) || Promise.resolve();
  const result = queue.then(operation, operation);
  fileStateMutationQueues.set(key, result.then(() => undefined, () => undefined));
  return result;
}

function getStorageBackend() {
  return String(process.env.MANAGE_STORAGE_BACKEND || process.env.MANAGE_STORAGE_DRIVER || "file").trim().toLowerCase();
}

function getFirestoreCollection() {
  return String(process.env.MANAGE_FIRESTORE_COLLECTION || "manage_state").trim();
}

function getFirestoreSnapshotCollection() {
  return String(process.env.MANAGE_FIRESTORE_SNAPSHOT_COLLECTION || `${getFirestoreCollection()}_snapshots`).trim();
}

function getFirestoreWorkItemsCollection() {
  return String(process.env.MANAGE_FIRESTORE_WORK_ITEMS_COLLECTION || `${getFirestoreCollection()}_work_items`).trim();
}

function getFirestoreSnapshotMaxBytes() {
  const maxBytes = Number(process.env.MANAGE_FIRESTORE_SNAPSHOT_MAX_BYTES || 850_000);

  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return 850_000;
  }

  return Math.min(Math.max(Math.round(maxBytes), 1_024), 950_000);
}

export function getWorkItemKeyPrefix() {
  const cleaned = String(process.env.MANAGE_PACKET_KEY_PREFIX || "TASK")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  return cleaned || "TASK";
}

function workItemKeyPattern() {
  return new RegExp(`^(?:w-)?${getWorkItemKeyPrefix()}-(\\d+)$`, "i");
}

function getFirestoreProjectId() {
  return (
    process.env.MANAGE_FIRESTORE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    ""
  );
}

function getFirestoreDatabaseId() {
  return process.env.MANAGE_FIRESTORE_DATABASE_ID || "";
}

function getSnapshotRetention() {
  const retention = Number(process.env.MANAGE_SNAPSHOT_RETENTION || 25);

  if (!Number.isFinite(retention) || retention <= 0) {
    return 25;
  }

  return Math.min(Math.max(Math.round(retention), 5), 250);
}

function getSnapshotsDir() {
  return path.join(getManageDataDir(), "snapshots");
}

function isAutoSnapshotEnabled(key) {
  return ["work-items", "initiatives"].includes(key) && process.env.MANAGE_AUTO_SNAPSHOTS !== "false";
}

function fallbackFrom(factory) {
  return clone(typeof factory === "function" ? factory() : factory);
}

function filePathForKey(key) {
  const reader = fileReaders[key];

  if (!reader) {
    throw new Error(`Unknown Manage state key: ${key}`);
  }

  return reader();
}

function ensureStateKey(key) {
  if (!stateKeys.has(key)) {
    throw new Error(`Unknown Manage state key: ${key}`);
  }
}

function safeSnapshotId(id) {
  const cleaned = String(id || "").trim();

  if (!/^[a-zA-Z0-9_.-]+$/.test(cleaned)) {
    throw Object.assign(new Error("Invalid backup snapshot id"), { statusCode: 400 });
  }

  return cleaned;
}

function createSnapshotId(createdAt = new Date().toISOString()) {
  return `${createdAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTransientReplaceError(error) {
  return ["EACCES", "EBUSY", "EPERM"].includes(error?.code);
}

async function replaceFileWithRetry(tmpPath, targetPath) {
  const maxAttempts = 8;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await fs.rename(tmpPath, targetPath);
      return;
    } catch (error) {
      if (attempt < maxAttempts && isTransientReplaceError(error)) {
        await delay(50 * attempt);
        continue;
      }

      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

function snapshotStats(values) {
  const stats = {};

  if (Array.isArray(values["work-items"])) {
    stats.workItems = values["work-items"].length;
  }

  if (Array.isArray(values["github-cache"]?.repos)) {
    stats.githubRepos = values["github-cache"].repos.length;
  }

  if (Array.isArray(values.initiatives)) {
    stats.initiatives = values.initiatives.length;
  }

  return stats;
}

function normalizeSnapshotValues(values) {
  const normalized = {};

  for (const [key, value] of Object.entries(values || {})) {
    ensureStateKey(key);

    if (value !== undefined) {
      normalized[key] = clone(value);
    }
  }

  if (Object.keys(normalized).length === 0) {
    throw Object.assign(new Error("Backup snapshot requires at least one state key"), { statusCode: 400 });
  }

  return normalized;
}

function buildSnapshot(values, { reason = "manual", automatic = false } = {}) {
  const createdAt = new Date().toISOString();
  const normalized = normalizeSnapshotValues(values);

  return {
    id: createSnapshotId(createdAt),
    createdAt,
    backend: getStorageBackend(),
    reason: String(reason || "manual").trim(),
    automatic: Boolean(automatic),
    keys: Object.keys(normalized),
    stats: snapshotStats(normalized),
    state: normalized,
  };
}

function summarizeSnapshot(snapshot) {
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    backend: snapshot.backend || getStorageBackend(),
    reason: snapshot.reason || "manual",
    automatic: Boolean(snapshot.automatic),
    keys: Array.isArray(snapshot.keys) ? snapshot.keys : Object.keys(snapshot.state || {}),
    stats: snapshot.stats || snapshotStats(snapshot.state || {}),
  };
}

function jsonByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function safeFirestoreDocumentId(value, fallback) {
  const cleaned = String(value || "").trim();

  if (
    cleaned &&
    cleaned !== "." &&
    cleaned !== ".." &&
    !cleaned.includes("/") &&
    Buffer.byteLength(cleaned, "utf8") <= 1_200
  ) {
    return cleaned;
  }

  return fallback;
}

function firestoreWorkItemDocumentId(item, index, usedIds) {
  const baseId = safeFirestoreDocumentId(item?.id || item?.key || item?.packetId, `item-${index}`);

  if (!usedIds.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (usedIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseId}-${suffix}`;
}

function safePacketNumber(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

export function workItemNumber(value) {
  const candidates = value && typeof value === "object"
    ? [value.key, value.packetId, value.id]
    : [value];
  const pattern = workItemKeyPattern();

  for (const candidate of candidates) {
    const match = String(candidate || "").match(pattern);
    if (match) {
      return safePacketNumber(match[1]);
    }
  }

  return 0;
}

export function nextWorkItemKeyFromItems(items) {
  const maxNumber = items.reduce((max, item) => Math.max(max, workItemNumber(item)), 100);
  return `${getWorkItemKeyPrefix()}-${maxNumber + 1}`;
}

function idempotencyHash(value) {
  const normalized = String(value || "").trim();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : "";
}

function withoutWorkItemPersistence(item) {
  const { _persistence, revision, ...payload } = clone(item || {});
  return payload;
}

function withWorkItemPersistence(payload, envelope = {}) {
  return {
    ...clone(payload),
    _persistence: {
      revision: Math.max(Number(envelope.revision) || 0, 0),
      recentOperationIds: Array.isArray(envelope.recentOperationIds)
        ? envelope.recentOperationIds.map(String).filter(Boolean).slice(-20)
        : [],
      createOperationId: String(envelope.createOperationId || ""),
    },
  };
}

function firestoreRevision(data) {
  return Math.max(Number(data?.revision) || 0, 0);
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

function buildFirestoreSnapshotChunk(snapshot, key, order, kind, value) {
  return {
    id: `${snapshot.id}__chunk_${order}`,
    data: {
      snapshotChunk: true,
      snapshotId: snapshot.id,
      key,
      order,
      kind,
      value: clone(value),
    },
  };
}

function splitFirestoreSnapshotArray(snapshot, key, value, maxBytes, startOrder) {
  const chunks = [];
  let current = [];
  let order = startOrder;

  for (const item of value) {
    const candidate = [...current, item];
    const candidateChunk = buildFirestoreSnapshotChunk(snapshot, key, order, "array", candidate);

    if (current.length > 0 && jsonByteLength(candidateChunk.data) > maxBytes) {
      chunks.push(buildFirestoreSnapshotChunk(snapshot, key, order, "array", current));
      order += 1;
      current = [item];
    } else {
      current = candidate;
    }
  }

  chunks.push(buildFirestoreSnapshotChunk(snapshot, key, order, "array", current));
  return chunks.every((chunk) => jsonByteLength(chunk.data) <= maxBytes)
    ? chunks
    : splitFirestoreSnapshotJson(snapshot, key, value, maxBytes, startOrder);
}

function splitFirestoreSnapshotJson(snapshot, key, value, maxBytes, startOrder) {
  const serialized = JSON.stringify(value);
  const chunks = [];
  let offset = 0;
  let order = startOrder;
  let size = Math.max(Math.floor(maxBytes * 0.7), 1);

  while (offset < serialized.length) {
    let text = serialized.slice(offset, offset + size);
    let chunk = buildFirestoreSnapshotChunk(snapshot, key, order, "json", text);

    while (text.length > 1 && jsonByteLength(chunk.data) > maxBytes) {
      size = Math.max(Math.floor(size / 2), 1);
      text = serialized.slice(offset, offset + size);
      chunk = buildFirestoreSnapshotChunk(snapshot, key, order, "json", text);
    }

    if (jsonByteLength(chunk.data) > maxBytes) {
      throw Object.assign(new Error("Backup snapshot chunk is too large to store in Firestore"), { statusCode: 500 });
    }

    chunks.push(chunk);
    offset += text.length;
    order += 1;
  }

  if (chunks.length === 0) {
    chunks.push(buildFirestoreSnapshotChunk(snapshot, key, startOrder, "json", serialized));
  }

  return chunks;
}

function buildFirestoreSnapshotDocuments(snapshot) {
  const root = clone(snapshot);
  const maxBytes = getFirestoreSnapshotMaxBytes();

  if (jsonByteLength(root) <= maxBytes) {
    return { root, chunks: [] };
  }

  const chunks = [];
  root.state = {};
  root.chunked = true;
  root.chunks = [];

  for (const [key, value] of Object.entries(snapshot.state || {})) {
    const keyChunks = Array.isArray(value)
      ? splitFirestoreSnapshotArray(snapshot, key, value, maxBytes, chunks.length)
      : splitFirestoreSnapshotJson(snapshot, key, value, maxBytes, chunks.length);

    for (const chunk of keyChunks) {
      chunks.push(chunk);
      root.chunks.push({
        id: chunk.id,
        key: chunk.data.key,
        order: chunk.data.order,
        kind: chunk.data.kind,
      });
    }
  }

  root.chunkCount = chunks.length;

  if (jsonByteLength(root) > maxBytes) {
    throw Object.assign(new Error("Backup snapshot metadata is too large to store in Firestore"), { statusCode: 500 });
  }

  return { root, chunks };
}

function isFirestoreSnapshotChunk(data) {
  return data?.snapshotChunk === true;
}

function hydrateFirestoreSnapshot(root, chunkDocs) {
  if (!root?.chunked) {
    return root;
  }

  const state = { ...(root.state || {}) };
  const matchingChunks = chunkDocs.filter((chunk) => chunk.snapshotId === root.id && isFirestoreSnapshotChunk(chunk));
  const expectedChunkCount = Number(root.chunkCount || root.chunks?.length || 0);
  const chunksByKey = new Map();

  if (expectedChunkCount > 0 && matchingChunks.length < expectedChunkCount) {
    throw Object.assign(new Error("Backup snapshot is missing Firestore chunk documents"), { statusCode: 500 });
  }

  for (const chunk of matchingChunks) {
    const group = chunksByKey.get(chunk.key) || [];
    group.push(chunk);
    chunksByKey.set(chunk.key, group);
  }

  for (const [key, chunks] of chunksByKey.entries()) {
    chunks.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

    if (chunks[0]?.kind === "array") {
      state[key] = chunks.flatMap((chunk) => (Array.isArray(chunk.value) ? chunk.value : []));
    } else if (chunks[0]?.kind === "json") {
      state[key] = JSON.parse(chunks.map((chunk) => String(chunk.value || "")).join(""));
    } else if (chunks.length > 0) {
      state[key] = clone(chunks[0].value);
    }
  }

  return {
    ...root,
    state,
  };
}

async function readExistingFileJson(key) {
  const filePath = filePathForKey(key);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return { exists: true, value: JSON.parse(raw) };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { exists: false, value: null };
    }

    throw Object.assign(new Error(`Failed to read Manage state ${key}: ${error.message}`), { statusCode: 500 });
  }
}

async function readFileJson(key, fallbackFactory) {
  const existing = await readExistingFileJson(key);

  if (existing.exists) {
    return existing.value;
  }

  const fallback = fallbackFrom(fallbackFactory);
  await writeFileJson(key, fallback);
  return fallback;
}

async function writeFileJson(key, value, { skipSnapshot = false, snapshotReason = "auto-before-write" } = {}) {
  const filePath = filePathForKey(key);
  const existing = !skipSnapshot && isAutoSnapshotEnabled(key) ? await readExistingFileJson(key) : { exists: false };

  if (existing.exists) {
    await createStateSnapshot(
      {
        [key]: existing.value,
      },
      { reason: snapshotReason, automatic: true },
    );
  }

  await fs.mkdir(getManageDataDir(), { recursive: true });
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await replaceFileWithRetry(tmpPath, filePath);
}

async function getFirestoreClient() {
  if (!firestoreClientPromise) {
    firestoreClientPromise = import("@google-cloud/firestore").then((firestoreModule) => {
      const Firestore = firestoreModule.Firestore || firestoreModule.default?.Firestore;

      if (!Firestore) {
        throw new Error("@google-cloud/firestore did not expose a Firestore client");
      }

      const options = {};
      const projectId = getFirestoreProjectId();
      const databaseId = getFirestoreDatabaseId();

      if (projectId) {
        options.projectId = projectId;
      }

      if (databaseId) {
        options.databaseId = databaseId;
      }

      return new Firestore(options);
    });
  }

  return firestoreClientPromise;
}

function firestoreDocumentRef(firestore, key) {
  const documentId = firestoreDocumentIds[key];

  if (!documentId) {
    throw new Error(`Unknown Manage state key: ${key}`);
  }

  return firestore.collection(getFirestoreCollection()).doc(documentId);
}

function firestoreSnapshotCollection(firestore) {
  return firestore.collection(getFirestoreSnapshotCollection());
}

function firestoreWorkItemsCollection(firestore) {
  return firestore.collection(getFirestoreWorkItemsCollection());
}

async function commitFirestoreBatches(firestore, operations) {
  for (let index = 0; index < operations.length; index += firestoreWriteBatchLimit) {
    const batch = firestore.batch();
    const batchOperations = operations.slice(index, index + firestoreWriteBatchLimit);

    for (const operation of batchOperations) {
      if (operation.type === "set") {
        batch.set(operation.ref, operation.value);
      } else if (operation.type === "delete") {
        batch.delete(operation.ref);
      }
    }

    await batch.commit();
  }
}

function isUnmigratedLegacyWorkItems(data) {
  return Array.isArray(data?.payload) && data.migrated !== true && data.initialized !== true;
}

function isInitializedWorkItemsCollection(data) {
  return data?.initialized === true || data?.migrated === true;
}

async function markWorkItemsCollectionInitialized(firestore, now = new Date().toISOString()) {
  await firestoreDocumentRef(firestore, "work-items").set({
    key: "work-items",
    migrated: true,
    initialized: true,
    updatedAt: now,
  });
}

async function readFirestoreWorkItems(fallbackFactory, { includePersistence = false } = {}) {
  const firestore = await getFirestoreClient();
  const querySnapshot = await firestoreWorkItemsCollection(firestore).orderBy("order", "asc").get();

  if (querySnapshot.docs.length > 0) {
    return querySnapshot.docs.map((doc) => {
      const data = doc.data();
      return includePersistence ? withWorkItemPersistence(data.payload, data) : clone(data.payload);
    });
  }

  const legacySnapshot = await firestoreDocumentRef(firestore, "work-items").get();
  const legacyData = legacySnapshot.exists ? legacySnapshot.data() : undefined;

  if (isUnmigratedLegacyWorkItems(legacyData)) {
    await writeFirestoreWorkItems(legacyData.payload, { skipSnapshot: true });
    return includePersistence
      ? legacyData.payload.map((item) => withWorkItemPersistence(item, { revision: 1 }))
      : clone(legacyData.payload);
  }

  if (isInitializedWorkItemsCollection(legacyData)) {
    return [];
  }

  const fallback = fallbackFrom(fallbackFactory);
  await writeFirestoreWorkItems(fallback, { skipSnapshot: true });
  return includePersistence
    ? fallback.map((item) => withWorkItemPersistence(item, { revision: 1 }))
    : fallback;
}

async function readFirestoreJson(key, fallbackFactory, options = {}) {
  if (key === "work-items") {
    return readFirestoreWorkItems(fallbackFactory, options);
  }

  const firestore = await getFirestoreClient();
  const ref = firestoreDocumentRef(firestore, key);
  const snapshot = await ref.get();

  if (!snapshot.exists || snapshot.data()?.payload === undefined) {
    const fallback = fallbackFrom(fallbackFactory);
    await writeFirestoreJson(key, fallback);
    return fallback;
  }

  return clone(snapshot.data().payload);
}

function firestoreWorkItemEnvelope(item, {
  existingData,
  order,
  revision,
  now = new Date().toISOString(),
} = {}) {
  const payload = withoutWorkItemPersistence(item);

  return {
    key: "work-items",
    itemId: String(item?.id || item?.key || ""),
    packetNumber: workItemNumber(item),
    order,
    payload,
    revision,
    recentOperationIds: item?._persistence?.recentOperationIds || existingData?.recentOperationIds || [],
    createOperationId: item?._persistence?.createOperationId || existingData?.createOperationId || "",
    updatedAt: now,
  };
}

async function writeFirestoreWorkItemMutation(item) {
  const firestore = await getFirestoreClient();
  const collection = firestoreWorkItemsCollection(firestore);
  const documentId = firestoreWorkItemDocumentId(item, 0, new Set());
  const ref = collection.doc(documentId);
  const expectedRevision = Number(item?._persistence?.expectedRevision);

  if (!Number.isFinite(expectedRevision)) {
    throw Object.assign(new Error("A work-item mutation requires an expected revision"), { statusCode: 500 });
  }

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existingData = snapshot.data();
    const actualRevision = firestoreRevision(existingData);

    if (actualRevision !== expectedRevision) {
      throw workItemConflict(item?.key || documentId, expectedRevision, actualRevision);
    }

    const requestedRevision = Number(item?._persistence?.revision);
    const revision = Number.isFinite(requestedRevision) ? requestedRevision : actualRevision + 1;
    transaction.set(ref, firestoreWorkItemEnvelope(item, {
      existingData,
      order: Number.isFinite(Number(existingData?.order)) ? existingData.order : 0,
      revision,
    }));
    return { changedDocumentCount: 1 };
  });
}

async function commitFirestoreTransactions(firestore, operations) {
  for (let index = 0; index < operations.length; index += firestoreWriteBatchLimit) {
    const transactionOperations = operations.slice(index, index + firestoreWriteBatchLimit);

    await firestore.runTransaction(async (transaction) => {
      const snapshots = [];

      for (const operation of transactionOperations) {
        snapshots.push(await transaction.get(operation.ref));
      }

      for (let operationIndex = 0; operationIndex < transactionOperations.length; operationIndex += 1) {
        const operation = transactionOperations[operationIndex];
        const snapshot = snapshots[operationIndex];
        const actualRevision = firestoreRevision(snapshot.data());

        if (actualRevision !== operation.expectedRevision) {
          throw workItemConflict(
            operation.value?.payload?.key || snapshot.data()?.payload?.key || operation.ref.id,
            operation.expectedRevision,
            actualRevision,
          );
        }
      }

      for (const operation of transactionOperations) {
        if (operation.type === "set") {
          transaction.set(operation.ref, operation.value);
        } else {
          transaction.delete(operation.ref);
        }
      }
    });
  }
}

async function writeFirestoreWorkItems(value) {
  if (!Array.isArray(value)) {
    throw Object.assign(new Error("Manage work-items state must be an array"), { statusCode: 500 });
  }

  const firestore = await getFirestoreClient();
  const collection = firestoreWorkItemsCollection(firestore);
  const existingSnapshot = await collection.get();
  const existingById = new Map(existingSnapshot.docs.map((doc) => [doc.id, doc]));
  const nextIds = new Set();
  const operations = [];
  const now = new Date().toISOString();

  for (const [index, item] of value.entries()) {
    const id = firestoreWorkItemDocumentId(item, index, nextIds);
    nextIds.add(id);
    const existing = existingById.get(id);
    const existingData = existing?.data();
    const currentRevision = firestoreRevision(existingData);
    const expectedRevision = Number.isFinite(Number(item?._persistence?.expectedRevision))
      ? Number(item._persistence.expectedRevision)
      : currentRevision;
    const requestedRevision = item?._persistence?.revision ?? item?.revision;
    const payload = withoutWorkItemPersistence(item);
    const payloadUnchanged = existing && JSON.stringify(existingData?.payload) === JSON.stringify(payload);
    const revision = Number.isFinite(Number(requestedRevision))
      ? Number(requestedRevision)
      : payloadUnchanged
        ? currentRevision
        : currentRevision + 1;
    const order = index;
    const recentOperationIds = item?._persistence?.recentOperationIds || existingData?.recentOperationIds || [];
    const createOperationId = item?._persistence?.createOperationId || existingData?.createOperationId || "";
    const unchanged = existing
      && payloadUnchanged
      && existingData?.order === order
      && currentRevision === revision
      && JSON.stringify(existingData?.recentOperationIds || []) === JSON.stringify(recentOperationIds)
      && String(existingData?.createOperationId || "") === String(createOperationId);

    if (!unchanged) {
      operations.push({
        type: "set",
        ref: collection.doc(id),
        expectedRevision,
        value: firestoreWorkItemEnvelope(item, { existingData, order, revision, now }),
      });
    }
  }

  for (const doc of existingSnapshot.docs) {
    if (!nextIds.has(doc.id)) {
      operations.push({
        type: "delete",
        ref: doc.ref,
        expectedRevision: firestoreRevision(doc.data()),
      });
    }
  }

  if (
    existingSnapshot.docs.length === 0
    && operations.length > 1
    && operations.every((operation) => operation.type === "set")
  ) {
    await commitFirestoreBatches(firestore, operations);
  } else if (operations.length > 0) {
    await commitFirestoreTransactions(firestore, operations);
  }

  await markWorkItemsCollectionInitialized(firestore, now);

  return {
    changedDocumentCount: operations.length,
  };
}

export async function createWorkItemState(buildWorkItem, { fallbackFactory = [], idempotencyKey = "" } = {}) {
  const backend = getStorageBackend();
  const createOperationId = idempotencyHash(idempotencyKey);

  if (backend === "file") {
    return serializeFileWorkItemMutation(async () => {
      const items = await readFileJson("work-items", fallbackFactory);
      const replay = createOperationId
        ? items.find((item) => item?._persistence?.createOperationId === createOperationId)
        : null;

      if (replay) {
        return {
          workItem: clone(replay),
          revision: Number(replay._persistence?.revision) || 1,
          idempotentReplay: true,
        };
      }

      const key = nextWorkItemKeyFromItems(items);
      const workItem = withWorkItemPersistence(buildWorkItem(key), {
        revision: 1,
        createOperationId,
      });
      await writeFileJson("work-items", [workItem, ...items]);
      return { workItem, revision: 1, idempotentReplay: false };
    });
  }

  if (backend === "firestore") {
    const firestore = await getFirestoreClient();
    const collection = firestoreWorkItemsCollection(firestore);
    const counterRef = firestore.collection(getFirestoreCollection()).doc(workItemCounterDocumentId);

    const initialCounter = await counterRef.get();
    if (!initialCounter.exists) {
      try {
        await readFirestoreWorkItems(fallbackFactory, { includePersistence: true });
      } catch (error) {
        const initialized = await collection.limit(1).get();
        if (initialized.docs.length === 0) {
          throw error;
        }
      }
    }

    return firestore.runTransaction(async (transaction) => {
      const counterSnapshot = await transaction.get(counterRef);
      const counterData = counterSnapshot.data() || {};
      const recentCreates = Array.isArray(counterData.recentCreates) ? counterData.recentCreates : [];
      const replay = createOperationId
        ? recentCreates.find((entry) => entry.operationId === createOperationId)
        : null;

      if (replay?.workItemDocumentId) {
        const existingRef = collection.doc(replay.workItemDocumentId);
        const existingSnapshot = await transaction.get(existingRef);
        if (existingSnapshot.exists) {
          const existingData = existingSnapshot.data();
          return {
            workItem: withWorkItemPersistence(existingData.payload, existingData),
            revision: firestoreRevision(existingData),
            idempotentReplay: true,
          };
        }
      }

      if (createOperationId && !replay) {
        const replaySnapshot = await transaction.get(
          collection.where("createOperationId", "==", createOperationId).limit(1),
        );
        const replayDocument = replaySnapshot.docs[0];
        if (replayDocument) {
          const existingData = replayDocument.data();
          return {
            workItem: withWorkItemPersistence(existingData.payload, existingData),
            revision: firestoreRevision(existingData),
            idempotentReplay: true,
          };
        }
      }

      let liveMax = 100;
      if (safePacketNumber(counterData.reconciliationVersion) < workItemCounterReconciliationVersion) {
        const livePackets = await transaction.get(collection);
        liveMax = livePackets.docs.reduce((max, document) => {
          const data = document.data();
          return Math.max(
            max,
            safePacketNumber(data?.packetNumber),
            workItemNumber(data?.payload),
            workItemNumber(data?.itemId),
            workItemNumber(document.id),
          );
        }, 100);
      }
      const currentNumber = Math.max(safePacketNumber(counterData.currentNumber), liveMax, 100);
      if (currentNumber >= Number.MAX_SAFE_INTEGER) {
        throw Object.assign(new Error("Packet key space is exhausted or corrupt."), { statusCode: 500 });
      }
      const nextNumber = currentNumber + 1;
      const key = `${getWorkItemKeyPrefix()}-${nextNumber}`;
      const workItem = buildWorkItem(key);
      const documentId = firestoreWorkItemDocumentId(workItem, 0, new Set());
      const itemRef = collection.doc(documentId);
      const itemSnapshot = await transaction.get(itemRef);

      if (itemSnapshot.exists) {
        throw workItemConflict(key, 0, firestoreRevision(itemSnapshot.data()));
      }

      const now = new Date().toISOString();
      const envelope = {
        key: "work-items",
        itemId: String(workItem?.id || documentId),
        packetNumber: nextNumber,
        order: -nextNumber,
        payload: withoutWorkItemPersistence(workItem),
        revision: 1,
        recentOperationIds: [],
        createOperationId,
        updatedAt: now,
      };
      transaction.set(itemRef, envelope);
      transaction.set(counterRef, {
        key: "work-items-counter",
        currentNumber: nextNumber,
        reconciliationVersion: workItemCounterReconciliationVersion,
        recentCreates: createOperationId
          ? [...recentCreates, { operationId: createOperationId, workItemDocumentId: documentId }]
              .slice(-workItemCreateHistoryLimit)
          : recentCreates.slice(-workItemCreateHistoryLimit),
        updatedAt: now,
      });

      return {
        workItem: withWorkItemPersistence(envelope.payload, envelope),
        revision: 1,
        idempotentReplay: false,
      };
    });
  }

  throw new Error(`Unsupported MANAGE_STORAGE_BACKEND: ${backend}`);
}

async function writeFirestoreJson(key, value, { skipSnapshot = false, snapshotReason = "auto-before-write" } = {}) {
  if (key === "work-items") {
    return writeFirestoreWorkItems(value, { skipSnapshot, snapshotReason });
  }

  const firestore = await getFirestoreClient();
  const ref = firestoreDocumentRef(firestore, key);
  const currentSnapshot = !skipSnapshot && isAutoSnapshotEnabled(key) ? await ref.get() : null;

  if (currentSnapshot?.exists && currentSnapshot.data()?.payload !== undefined) {
    await createStateSnapshot(
      {
        [key]: currentSnapshot.data().payload,
      },
      { reason: snapshotReason, automatic: true },
    );
  }

  await ref.set({
    key,
    payload: clone(value),
    updatedAt: new Date().toISOString(),
  });
}

async function fileSnapshotPath(id) {
  return path.join(getSnapshotsDir(), `${safeSnapshotId(id)}.json`);
}

async function readFileSnapshotPayloads() {
  try {
    const names = await fs.readdir(getSnapshotsDir());
    const snapshots = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          try {
            const raw = await fs.readFile(path.join(getSnapshotsDir(), name), "utf8");
            return JSON.parse(raw);
          } catch {
            return null;
          }
        }),
    );

    return snapshots
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function pruneFileSnapshots() {
  const snapshots = await readFileSnapshotPayloads();
  const staleSnapshots = snapshots.slice(getSnapshotRetention());

  for (const snapshot of staleSnapshots) {
    const targetPath = await fileSnapshotPath(snapshot.id);
    const resolvedDir = path.resolve(getSnapshotsDir());
    const resolvedTarget = path.resolve(targetPath);

    if (resolvedTarget.startsWith(resolvedDir)) {
      await fs.rm(resolvedTarget, { force: true });
    }
  }
}

async function writeFileSnapshot(snapshot, { prune = true } = {}) {
  await fs.mkdir(getSnapshotsDir(), { recursive: true });
  const targetPath = await fileSnapshotPath(snapshot.id);
  const tmpPath = `${targetPath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await replaceFileWithRetry(tmpPath, targetPath);

  if (prune) {
    await pruneFileSnapshots();
  }

  return summarizeSnapshot(snapshot);
}

async function readFileSnapshot(id) {
  const raw = await fs.readFile(await fileSnapshotPath(id), "utf8");
  return JSON.parse(raw);
}

async function listFileSnapshots({ limit = 12 } = {}) {
  return (await readFileSnapshotPayloads()).slice(0, limit).map(summarizeSnapshot);
}

async function writeFirestoreSnapshot(snapshot, { prune = true } = {}) {
  const firestore = await getFirestoreClient();
  const collection = firestoreSnapshotCollection(firestore);
  const { root, chunks } = buildFirestoreSnapshotDocuments(snapshot);

  for (const chunk of chunks) {
    await collection.doc(chunk.id).set(chunk.data);
  }

  await collection.doc(snapshot.id).set(root);

  if (prune) {
    await pruneFirestoreSnapshots(firestore);
  }

  return summarizeSnapshot(snapshot);
}

async function listFirestoreSnapshotPayloads({ limit = 12 } = {}) {
  const firestore = await getFirestoreClient();
  const querySnapshot = await firestoreSnapshotCollection(firestore).orderBy("createdAt", "desc").limit(limit).get();
  return querySnapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((snapshot) => !isFirestoreSnapshotChunk(snapshot))
    .slice(0, limit);
}

async function pruneFirestoreSnapshots(firestore) {
  const collection = firestoreSnapshotCollection(firestore);
  const querySnapshot = await collection.orderBy("createdAt", "desc").get();
  const rootDocs = querySnapshot.docs.filter((doc) => !isFirestoreSnapshotChunk(doc.data()));
  const staleDocs = rootDocs.slice(getSnapshotRetention());

  if (staleDocs.length === 0) {
    return;
  }

  const staleIds = new Set(staleDocs.map((doc) => doc.id));
  const allDocs = await collection.get();
  const docsToDelete = [...staleDocs];

  for (const doc of allDocs.docs) {
    const data = doc.data();
    if (isFirestoreSnapshotChunk(data) && staleIds.has(data.snapshotId)) {
      docsToDelete.push(doc);
    }
  }

  for (const doc of docsToDelete) {
    await doc.ref.delete();
  }
}

async function readFirestoreSnapshot(id) {
  const firestore = await getFirestoreClient();
  const collection = firestoreSnapshotCollection(firestore);
  const snapshot = await collection.doc(safeSnapshotId(id)).get();

  if (!snapshot.exists) {
    throw Object.assign(new Error("Backup snapshot not found"), { statusCode: 404 });
  }

  const root = { id: snapshot.id, ...snapshot.data() };

  if (!root.chunked) {
    return root;
  }

  const querySnapshot = await collection.where("snapshotId", "==", root.id).get();
  const chunks = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return hydrateFirestoreSnapshot(root, chunks);
}

async function listFirestoreSnapshots(options = {}) {
  return (await listFirestoreSnapshotPayloads(options)).map(summarizeSnapshot);
}

async function readStateSnapshot(id) {
  const backend = getStorageBackend();

  if (backend === "file") {
    try {
      return await readFileSnapshot(id);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw Object.assign(new Error("Backup snapshot not found"), { statusCode: 404 });
      }

      throw error;
    }
  }

  if (backend === "firestore") {
    return readFirestoreSnapshot(id);
  }

  throw new Error(`Unsupported MANAGE_STORAGE_BACKEND: ${backend}`);
}

export async function readJsonState(key, fallbackFactory, options = {}) {
  ensureStateKey(key);
  const backend = getStorageBackend();

  if (backend === "file") {
    return readFileJson(key, fallbackFactory);
  }

  if (backend === "firestore") {
    return readFirestoreJson(key, fallbackFactory, options);
  }

  throw new Error(`Unsupported MANAGE_STORAGE_BACKEND: ${backend}`);
}

export async function writeJsonState(key, value, options = {}) {
  ensureStateKey(key);
  const backend = getStorageBackend();

  if (backend === "file") {
    return writeFileJson(key, value, options);
  }

  if (backend === "firestore") {
    return writeFirestoreJson(key, value, options);
  }

  throw new Error(`Unsupported MANAGE_STORAGE_BACKEND: ${backend}`);
}

export async function mutateJsonState(key, fallbackFactory, operation) {
  ensureStateKey(key);

  if (key === "work-items") {
    throw new Error("Work items must be mutated through the work-item APIs");
  }

  const backend = getStorageBackend();

  if (backend === "file") {
    return serializeFileStateMutation(key, async () => {
      const current = await readFileJson(key, fallbackFactory);
      const mutation = await operation(clone(current));

      if (mutation?.write !== false) {
        await writeFileJson(key, mutation.value, { skipSnapshot: true });
      }

      return mutation?.result === undefined ? undefined : clone(mutation.result);
    });
  }

  if (backend === "firestore") {
    const firestore = await getFirestoreClient();
    const ref = firestoreDocumentRef(firestore, key);

    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists && snapshot.data()?.payload !== undefined
        ? clone(snapshot.data().payload)
        : fallbackFrom(fallbackFactory);
      const mutation = await operation(current);

      if (mutation?.write !== false) {
        transaction.set(ref, {
          key,
          payload: clone(mutation.value),
          updatedAt: new Date().toISOString(),
        });
      }

      return mutation?.result === undefined ? undefined : clone(mutation.result);
    });
  }

  throw new Error(`Unsupported MANAGE_STORAGE_BACKEND: ${backend}`);
}

export async function writeWorkItemMutation(items, item) {
  const backend = getStorageBackend();

  if (backend === "file") {
    return writeFileJson("work-items", items);
  }

  if (backend === "firestore") {
    return writeFirestoreWorkItemMutation(item);
  }

  throw new Error(`Unsupported MANAGE_STORAGE_BACKEND: ${backend}`);
}

export async function createStateSnapshot(values, options = {}) {
  const snapshot = buildSnapshot(values, options);
  const backend = getStorageBackend();
  const writeOptions = { prune: options.prune !== false };

  if (backend === "file") {
    return writeFileSnapshot(snapshot, writeOptions);
  }

  if (backend === "firestore") {
    return writeFirestoreSnapshot(snapshot, writeOptions);
  }

  throw new Error(`Unsupported MANAGE_STORAGE_BACKEND: ${backend}`);
}

export async function listStateSnapshots(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 12, 1), 100);
  const backend = getStorageBackend();

  if (backend === "file") {
    return listFileSnapshots({ limit });
  }

  if (backend === "firestore") {
    return listFirestoreSnapshots({ limit });
  }

  throw new Error(`Unsupported MANAGE_STORAGE_BACKEND: ${backend}`);
}

export async function restoreStateSnapshot(id, { keys = [] } = {}) {
  const snapshot = await readStateSnapshot(id);
  const requestedKeys = keys.length > 0 ? keys : snapshot.keys || Object.keys(snapshot.state || {});
  const restored = [];

  for (const key of requestedKeys) {
    ensureStateKey(key);

    if (snapshot.state?.[key] === undefined) {
      continue;
    }

    await writeJsonState(key, snapshot.state[key], { skipSnapshot: true });
    restored.push(key);
  }

  if (restored.length === 0) {
    throw Object.assign(new Error("Backup snapshot does not contain restorable state"), { statusCode: 400 });
  }

  return {
    snapshot: summarizeSnapshot(snapshot),
    restored,
  };
}

export async function verifyStateSnapshot(id, { requiredKeys = [] } = {}) {
  const snapshot = await readStateSnapshot(id);
  const keys = new Set(snapshot.keys || Object.keys(snapshot.state || {}));

  for (const key of requiredKeys) {
    ensureStateKey(key);

    if (!keys.has(key) || snapshot.state?.[key] === undefined) {
      throw Object.assign(new Error(`Backup snapshot verification failed for ${key}`), { statusCode: 500 });
    }
  }

  return summarizeSnapshot(snapshot);
}

export function getStorageStatus() {
  const backend = getStorageBackend();

  if (backend === "file") {
    return {
      kind: "file",
      dataDir: getManageDataDir(),
      files: {
        workItems: getWorkItemsPath(),
        githubCache: getGithubCachePath(),
        initiatives: getInitiativesPath(),
      },
      backups: {
        enabled: true,
        automatic: isAutoSnapshotEnabled("work-items"),
        retention: getSnapshotRetention(),
        snapshotsDir: getSnapshotsDir(),
      },
    };
  }

  if (backend === "firestore") {
    return {
      kind: "firestore",
      projectId: getFirestoreProjectId() || "application-default",
      databaseId: getFirestoreDatabaseId() || "(default)",
      collection: getFirestoreCollection(),
      collections: {
        workItems: getFirestoreWorkItemsCollection(),
        snapshots: getFirestoreSnapshotCollection(),
      },
      documents: {
        legacyWorkItems: firestoreDocumentIds["work-items"],
        githubCache: firestoreDocumentIds["github-cache"],
        workItemsCounter: workItemCounterDocumentId,
        initiatives: firestoreDocumentIds.initiatives,
      },
      packetKeyPrefix: getWorkItemKeyPrefix(),
      backups: {
        enabled: true,
        automatic: false,
        retention: getSnapshotRetention(),
        collection: getFirestoreSnapshotCollection(),
        maxDocumentBytes: getFirestoreSnapshotMaxBytes(),
      },
    };
  }

  return {
    kind: backend || "unknown",
    error: `Unsupported MANAGE_STORAGE_BACKEND: ${backend}`,
  };
}

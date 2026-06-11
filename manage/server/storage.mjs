import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getGithubCachePath, getManageDataDir, getWorkItemsPath } from "./paths.mjs";

const fileReaders = {
  "github-cache": getGithubCachePath,
  "work-items": getWorkItemsPath,
};

const firestoreDocumentIds = {
  "github-cache": "github-cache",
  "work-items": "work-items",
};

const stateKeys = new Set(Object.keys(fileReaders));
let firestoreClientPromise = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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
  return key === "work-items" && process.env.MANAGE_AUTO_SNAPSHOTS !== "false";
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

async function readFirestoreJson(key, fallbackFactory) {
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

async function writeFirestoreJson(key, value, { skipSnapshot = false, snapshotReason = "auto-before-write" } = {}) {
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
  await firestoreSnapshotCollection(firestore).doc(snapshot.id).set(clone(snapshot));

  if (prune) {
    await pruneFirestoreSnapshots(firestore);
  }

  return summarizeSnapshot(snapshot);
}

async function listFirestoreSnapshotPayloads({ limit = 12 } = {}) {
  const firestore = await getFirestoreClient();
  const querySnapshot = await firestoreSnapshotCollection(firestore).orderBy("createdAt", "desc").limit(limit).get();
  return querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function pruneFirestoreSnapshots(firestore) {
  const querySnapshot = await firestoreSnapshotCollection(firestore).orderBy("createdAt", "desc").get();
  const staleDocs = querySnapshot.docs.slice(getSnapshotRetention());

  if (staleDocs.length === 0) {
    return;
  }

  const batch = firestore.batch();

  for (const doc of staleDocs) {
    batch.delete(doc.ref);
  }

  await batch.commit();
}

async function readFirestoreSnapshot(id) {
  const firestore = await getFirestoreClient();
  const snapshot = await firestoreSnapshotCollection(firestore).doc(safeSnapshotId(id)).get();

  if (!snapshot.exists) {
    throw Object.assign(new Error("Backup snapshot not found"), { statusCode: 404 });
  }

  return { id: snapshot.id, ...snapshot.data() };
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

export async function readJsonState(key, fallbackFactory) {
  const backend = getStorageBackend();

  if (backend === "file") {
    return readFileJson(key, fallbackFactory);
  }

  if (backend === "firestore") {
    return readFirestoreJson(key, fallbackFactory);
  }

  throw new Error(`Unsupported MANAGE_STORAGE_BACKEND: ${backend}`);
}

export async function writeJsonState(key, value, options = {}) {
  const backend = getStorageBackend();

  if (backend === "file") {
    await writeFileJson(key, value, options);
    return;
  }

  if (backend === "firestore") {
    await writeFirestoreJson(key, value, options);
    return;
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

export function getStorageStatus() {
  const backend = getStorageBackend();

  if (backend === "file") {
    return {
      kind: "file",
      dataDir: getManageDataDir(),
      files: {
        workItems: getWorkItemsPath(),
        githubCache: getGithubCachePath(),
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
      documents: {
        workItems: firestoreDocumentIds["work-items"],
        githubCache: firestoreDocumentIds["github-cache"],
      },
      backups: {
        enabled: true,
        automatic: isAutoSnapshotEnabled("work-items"),
        retention: getSnapshotRetention(),
        collection: getFirestoreSnapshotCollection(),
      },
    };
  }

  return {
    kind: backend || "unknown",
    error: `Unsupported MANAGE_STORAGE_BACKEND: ${backend}`,
  };
}

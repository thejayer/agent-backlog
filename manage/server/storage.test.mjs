import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const firestoreMock = vi.hoisted(() => {
  const collections = new Map();
  const batchCommits = [];
  const directSets = [];
  const instances = [];
  const transactionCommits = [];
  const transactionAttempts = [];
  const queryGets = [];
  const whereCalls = [];
  let transactionQueue = Promise.resolve();
  let retryNextTransaction = false;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function collectionStore(name) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }

    return collections.get(name);
  }

  class FakeDocumentSnapshot {
    constructor(ref, value) {
      this.id = ref.id;
      this.ref = ref;
      this.exists = value !== undefined;
      this.value = value === undefined ? undefined : clone(value);
    }

    data() {
      return this.exists ? clone(this.value) : undefined;
    }
  }

  class FakeDocumentReference {
    constructor(collectionName, id) {
      this.collectionName = collectionName;
      this.id = id;
      this.path = `${collectionName}/${id}`;
    }

    async get() {
      return new FakeDocumentSnapshot(this, collectionStore(this.collectionName).get(this.id));
    }

    async set(value) {
      collectionStore(this.collectionName).set(this.id, clone(value));
      directSets.push(this.path);
    }

    async delete() {
      collectionStore(this.collectionName).delete(this.id);
    }
  }

  class FakeQuery {
    constructor(collectionName, order = null, limitValue = null, filters = []) {
      this.collectionName = collectionName;
      this.order = order;
      this.limitValue = limitValue;
      this.filters = filters;
    }

    orderBy(field, direction = "asc") {
      return new FakeQuery(this.collectionName, { field, direction }, this.limitValue, this.filters);
    }

    where(field, operator, value) {
      whereCalls.push({ collectionName: this.collectionName, field, operator, value });
      return new FakeQuery(this.collectionName, this.order, this.limitValue, [
        ...this.filters,
        { field, operator, value },
      ]);
    }

    limit(limitValue) {
      return new FakeQuery(this.collectionName, this.order, limitValue, this.filters);
    }

    async get() {
      queryGets.push({
        collectionName: this.collectionName,
        order: this.order,
        limitValue: this.limitValue,
        filters: clone(this.filters),
      });
      let docs = [...collectionStore(this.collectionName).entries()].map(([id, value]) => {
        const ref = new FakeDocumentReference(this.collectionName, id);
        return new FakeDocumentSnapshot(ref, value);
      });

      for (const filter of this.filters) {
        if (filter.operator !== "==") {
          throw new Error(`Unsupported fake Firestore operator: ${filter.operator}`);
        }

        docs = docs.filter((doc) => doc.data()?.[filter.field] === filter.value);
      }

      if (this.order) {
        const { field, direction } = this.order;
        docs.sort((a, b) => {
          const leftValue = a.data()?.[field];
          const rightValue = b.data()?.[field];

          if (typeof leftValue === "number" && typeof rightValue === "number") {
            return direction === "desc" ? rightValue - leftValue : leftValue - rightValue;
          }

          const left = String(leftValue || "");
          const right = String(rightValue || "");
          return direction === "desc" ? right.localeCompare(left) : left.localeCompare(right);
        });
      }

      return {
        docs: Number.isFinite(this.limitValue) ? docs.slice(0, this.limitValue) : docs,
      };
    }
  }

  class FakeCollectionReference extends FakeQuery {
    constructor(name) {
      super(name);
      this.name = name;
    }

    doc(id) {
      return new FakeDocumentReference(this.name, id);
    }
  }

  class FakeWriteBatch {
    constructor() {
      this.operations = [];
    }

    set(ref, value) {
      this.operations.push({ type: "set", ref, value: clone(value) });
    }

    delete(ref) {
      this.operations.push({ type: "delete", ref });
    }

    async commit() {
      for (const operation of this.operations) {
        if (operation.type === "set") {
          collectionStore(operation.ref.collectionName).set(operation.ref.id, clone(operation.value));
        } else if (operation.type === "delete") {
          collectionStore(operation.ref.collectionName).delete(operation.ref.id);
        }
      }

      batchCommits.push(this.operations.length);
    }
  }

  class FakeTransaction {
    constructor() {
      this.operations = [];
    }

    async get(target) {
      return target.get();
    }

    set(ref, value) {
      this.operations.push({ type: "set", ref, value: clone(value) });
    }

    delete(ref) {
      this.operations.push({ type: "delete", ref });
    }

    commit() {
      for (const operation of this.operations) {
        if (operation.type === "set") {
          collectionStore(operation.ref.collectionName).set(operation.ref.id, clone(operation.value));
        } else {
          collectionStore(operation.ref.collectionName).delete(operation.ref.id);
        }
      }
      transactionCommits.push(this.operations.map((operation) => `${operation.type}:${operation.ref.path}`));
    }
  }

  class Firestore {
    constructor(options = {}) {
      this.options = { ...options };
      instances.push(this);
    }

    collection(name) {
      return new FakeCollectionReference(name);
    }

    batch() {
      return new FakeWriteBatch();
    }

    runTransaction(operation) {
      const result = transactionQueue.then(async () => {
        if (retryNextTransaction) {
          retryNextTransaction = false;
          transactionAttempts.push("aborted");
          await operation(new FakeTransaction());
        }

        const transaction = new FakeTransaction();
        transactionAttempts.push("committed");
        const value = await operation(transaction);
        transaction.commit();
        return value;
      });
      transactionQueue = result.then(() => undefined, () => undefined);
      return result;
    }
  }

  return {
    Firestore,
    batchCommits,
    collectionStore,
    directSets,
    instances,
    transactionCommits,
    transactionAttempts,
    queryGets,
    retryNextTransaction() {
      retryNextTransaction = true;
    },
    reset() {
      collections.clear();
      batchCommits.length = 0;
      directSets.length = 0;
      instances.length = 0;
      transactionCommits.length = 0;
      transactionAttempts.length = 0;
      queryGets.length = 0;
      whereCalls.length = 0;
      transactionQueue = Promise.resolve();
      retryNextTransaction = false;
    },
    whereCalls,
  };
});

vi.mock("@google-cloud/firestore", () => ({
  Firestore: firestoreMock.Firestore,
}));

import {
  createWorkItemState,
  createStateSnapshot,
  getStorageStatus,
  listStateSnapshots,
  mutateJsonState,
  readJsonState,
  restoreStateSnapshot,
  verifyStateSnapshot,
  writeJsonState,
  writeWorkItemMutation,
} from "./storage.mjs";

const ENV_KEYS = [
  "MANAGE_DATA_DIR",
  "MANAGE_STORAGE_BACKEND",
  "MANAGE_STORAGE_DRIVER",
  "MANAGE_AUTO_SNAPSHOTS",
  "MANAGE_SNAPSHOT_RETENTION",
  "MANAGE_PACKET_KEY_PREFIX",
  "MANAGE_FIRESTORE_COLLECTION",
  "MANAGE_FIRESTORE_WORK_ITEMS_COLLECTION",
  "MANAGE_FIRESTORE_SNAPSHOT_COLLECTION",
  "MANAGE_FIRESTORE_SNAPSHOT_MAX_BYTES",
  "MANAGE_FIRESTORE_PROJECT_ID",
  "MANAGE_FIRESTORE_DATABASE_ID",
];

const FIRESTORE_COLLECTION = "manage_state_test";
const FIRESTORE_WORK_ITEMS_COLLECTION = "manage_state_test_work_items";
const FIRESTORE_SNAPSHOT_COLLECTION = "manage_state_test_snapshots";

const backendScenarios = [
  {
    name: "file backend",
    backend: "file",
    configure() {
      process.env.MANAGE_STORAGE_BACKEND = "file";
    },
    async expectPersistedWorkItems(dataDir, expected) {
      const onDisk = JSON.parse(await fs.readFile(path.join(dataDir, "work-items.json"), "utf8"));
      expect(onDisk).toEqual(expected);
    },
  },
  {
    name: "Firestore backend",
    backend: "firestore",
    configure() {
      process.env.MANAGE_STORAGE_BACKEND = "firestore";
      process.env.MANAGE_FIRESTORE_COLLECTION = FIRESTORE_COLLECTION;
      process.env.MANAGE_FIRESTORE_WORK_ITEMS_COLLECTION = FIRESTORE_WORK_ITEMS_COLLECTION;
      process.env.MANAGE_FIRESTORE_SNAPSHOT_COLLECTION = FIRESTORE_SNAPSHOT_COLLECTION;
    },
    async expectPersistedWorkItems(_dataDir, expected) {
      const stored = [...firestoreMock.collectionStore(FIRESTORE_WORK_ITEMS_COLLECTION).values()].sort(
        (left, right) => left.order - right.order,
      );
      expect(stored.map((doc) => doc.payload)).toEqual(expected);
      expect(firestoreMock.collectionStore(FIRESTORE_COLLECTION).get("work-items")).toMatchObject({
        migrated: true,
        initialized: true,
      });
      expect(firestoreMock.collectionStore(FIRESTORE_COLLECTION).get("work-items").payload).toBeUndefined();
    },
  },
];

let savedEnv;
let dataDir;

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  firestoreMock.reset();
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-backlog-storage-"));
  process.env.MANAGE_DATA_DIR = dataDir;
  process.env.MANAGE_AUTO_SNAPSHOTS = "false";
});

afterEach(async () => {
  vi.useRealTimers();

  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe.each(backendScenarios)("generic state mutations: $name", (scenario) => {
  beforeEach(() => scenario.configure());

  it("serializes concurrent github-cache mutations without losing updates", async () => {
    await Promise.all(Array.from({ length: 8 }, (_, index) => mutateJsonState(
      "github-cache",
      () => ({ repos: [], count: 0 }),
      async (current) => {
        await Promise.resolve();
        const next = { ...current, count: current.count + 1 };
        return { value: next, result: { index, count: next.count } };
      },
    )));

    await expect(readJsonState("github-cache", () => ({ repos: [], count: 0 }))).resolves.toEqual({
      repos: [],
      count: 8,
    });
  });
});

for (const scenario of backendScenarios) {
  describe(`${scenario.name} state round-trip`, () => {
    beforeEach(() => {
      scenario.configure();
    });

    it("seeds from the fallback factory on first read and persists writes", async () => {
      const seeded = await readJsonState("work-items", () => [{ id: "TASK-1" }]);
      expect(seeded).toEqual([{ id: "TASK-1" }]);

      await writeJsonState("work-items", [{ id: "TASK-2" }]);
      expect(await readJsonState("work-items", () => [])).toEqual([{ id: "TASK-2" }]);

      await scenario.expectPersistedWorkItems(dataDir, [{ id: "TASK-2" }]);
    });

    it("rejects unknown state keys", async () => {
      await expect(readJsonState("nope", () => [])).rejects.toThrow(/Unknown Manage state key/);
      await expect(writeJsonState("nope", [])).rejects.toThrow(/Unknown Manage state key/);
    });
  });

  describe(`${scenario.name} snapshots`, () => {
    beforeEach(() => {
      scenario.configure();
    });

    it("creates, lists, reads, and restores a snapshot of selected keys", async () => {
      await writeJsonState("work-items", [{ id: "TASK-9", status: "done" }]);
      const created = await createStateSnapshot({ "work-items": [{ id: "TASK-9", status: "done" }] });
      expect(created.id).toMatch(/^[a-zA-Z0-9_.-]+$/);

      await writeJsonState("work-items", [{ id: "TASK-9", status: "blocked" }]);
      const result = await restoreStateSnapshot(created.id);
      expect(result.restored).toEqual(["work-items"]);
      expect(result.snapshot.id).toBe(created.id);
      expect(await readJsonState("work-items", () => [])).toEqual([{ id: "TASK-9", status: "done" }]);

      const listed = await listStateSnapshots();
      expect(listed.some((snap) => snap.id === created.id)).toBe(true);
    });

    it("verifies required state before a destructive action", async () => {
      const created = await createStateSnapshot({
        "work-items": [{ id: "TASK-9" }],
        "github-cache": { repos: [] },
      });

      await expect(verifyStateSnapshot(created.id, {
        requiredKeys: ["work-items", "github-cache"],
      })).resolves.toMatchObject({
        id: created.id,
        keys: expect.arrayContaining(["work-items", "github-cache"]),
      });

      const partial = await createStateSnapshot({ "work-items": [{ id: "TASK-9" }] });
      await expect(verifyStateSnapshot(partial.id, {
        requiredKeys: ["work-items", "github-cache"],
      })).rejects.toThrow(/verification failed for github-cache/);
    });

    it("rejects snapshot ids with path traversal characters", async () => {
      await expect(restoreStateSnapshot("../../etc/passwd")).rejects.toThrow(/Invalid backup snapshot id/);
      await expect(restoreStateSnapshot("a/b")).rejects.toThrow(/Invalid backup snapshot id/);
      await expect(restoreStateSnapshot("")).rejects.toThrow(/Invalid backup snapshot id/);
    });

    it("refuses to restore a snapshot with no restorable state", async () => {
      const created = await createStateSnapshot({ "work-items": [{ id: "TASK-1" }] });
      await expect(restoreStateSnapshot(created.id, { keys: ["github-cache"] })).rejects.toThrow(
        /does not contain restorable state/,
      );
    });

    it("prunes snapshots beyond the retention limit", async () => {
      process.env.MANAGE_SNAPSHOT_RETENTION = "5";
      vi.useFakeTimers();

      const created = [];
      for (let index = 0; index < 7; index += 1) {
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, index)));
        created.push(await createStateSnapshot({ "work-items": [{ id: `TASK-${index}` }] }));
      }

      const listed = await listStateSnapshots({ limit: 10 });
      expect(listed).toHaveLength(5);
      expect(listed.map((snapshot) => snapshot.id)).toEqual(created.slice(2).reverse().map((snapshot) => snapshot.id));

      if (scenario.backend === "file") {
        const snapshotFiles = await fs.readdir(path.join(dataDir, "snapshots"));
        expect(snapshotFiles).toHaveLength(5);
        expect(snapshotFiles).not.toContain(`${created[0].id}.json`);
        expect(snapshotFiles).not.toContain(`${created[1].id}.json`);
        expect(snapshotFiles).toEqual(expect.arrayContaining(created.slice(2).map((snapshot) => `${snapshot.id}.json`)));
      } else if (scenario.backend === "firestore") {
        const snapshotStore = firestoreMock.collectionStore(FIRESTORE_SNAPSHOT_COLLECTION);
        expect(snapshotStore.has(created[0].id)).toBe(false);
        expect(snapshotStore.has(created[1].id)).toBe(false);
        expect(created.slice(2).every((snapshot) => snapshotStore.has(snapshot.id))).toBe(true);
      }
    });
  });
}

describe("Firestore work item storage", () => {
  beforeEach(() => {
    process.env.MANAGE_STORAGE_BACKEND = "firestore";
    process.env.MANAGE_FIRESTORE_COLLECTION = FIRESTORE_COLLECTION;
    process.env.MANAGE_FIRESTORE_WORK_ITEMS_COLLECTION = FIRESTORE_WORK_ITEMS_COLLECTION;
    process.env.MANAGE_FIRESTORE_SNAPSHOT_COLLECTION = FIRESTORE_SNAPSHOT_COLLECTION;
  });

  it("migrates a legacy monolithic work-items document into per-item documents on first read", async () => {
    const legacyItems = [
      { id: "TASK-1", status: "claimed" },
      { id: "TASK-2", status: "queued" },
    ];
    firestoreMock.collectionStore(FIRESTORE_COLLECTION).set("work-items", {
      key: "work-items",
      payload: legacyItems,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(readJsonState("work-items", () => [])).resolves.toEqual(legacyItems);

    const stored = [...firestoreMock.collectionStore(FIRESTORE_WORK_ITEMS_COLLECTION).values()].sort(
      (left, right) => left.order - right.order,
    );
    expect(stored.map((doc) => doc.payload)).toEqual(legacyItems);
    expect(firestoreMock.collectionStore(FIRESTORE_COLLECTION).get("work-items")).toMatchObject({
      migrated: true,
      initialized: true,
    });
    expect(firestoreMock.collectionStore(FIRESTORE_COLLECTION).get("work-items").payload).toBeUndefined();
  });

  it("does not remigrate a leftover legacy blob after the per-packet collection is emptied", async () => {
    firestoreMock.collectionStore(FIRESTORE_COLLECTION).set("work-items", {
      key: "work-items",
      payload: [{ id: "w-task-145", key: "TASK-145", title: "Stale leftover" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(readJsonState("work-items", () => [])).resolves.toEqual([
      { id: "w-task-145", key: "TASK-145", title: "Stale leftover" },
    ]);

    await writeJsonState("work-items", []);

    await expect(readJsonState("work-items", () => [{ id: "seed-should-not-appear" }])).resolves.toEqual([]);
    expect(firestoreMock.collectionStore(FIRESTORE_WORK_ITEMS_COLLECTION).size).toBe(0);
    expect(firestoreMock.collectionStore(FIRESTORE_COLLECTION).get("work-items")).toMatchObject({
      migrated: true,
      initialized: true,
    });
    expect(firestoreMock.collectionStore(FIRESTORE_COLLECTION).get("work-items").payload).toBeUndefined();

    const created = await createWorkItemState(
      (key) => ({ id: `w-${key.toLowerCase()}`, key, title: "After empty restore" }),
      { fallbackFactory: () => [{ id: "seed-should-not-appear" }], idempotencyKey: "after-empty-restore" },
    );
    expect(created.workItem.key).toBe("TASK-101");
    await expect(readJsonState("work-items", () => [])).resolves.toEqual([
      { id: "w-task-101", key: "TASK-101", title: "After empty restore" },
    ]);
  });

  it("returns the persisted revision during lazy migration", async () => {
    const legacyItems = [{ id: "w-task-145", key: "TASK-145", status: "ready_for_agent" }];
    firestoreMock.collectionStore(FIRESTORE_COLLECTION).set("work-items", {
      key: "work-items",
      payload: legacyItems,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const migrated = await readJsonState("work-items", () => [], { includePersistence: true });

    expect(migrated[0]._persistence.revision).toBe(1);
    expect(firestoreMock.collectionStore(FIRESTORE_WORK_ITEMS_COLLECTION).get("w-task-145").revision).toBe(1);
  });

  it("migrates legacy work items before the first create allocates a TASK- key", async () => {
    const legacyItems = [{ id: "w-task-145", key: "TASK-145", status: "ready_for_agent" }];
    firestoreMock.collectionStore(FIRESTORE_COLLECTION).set("work-items", {
      key: "work-items",
      payload: legacyItems,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await createWorkItemState(
      (key) => ({ id: `w-${key.toLowerCase()}`, key, status: "draft" }),
      { fallbackFactory: () => [], idempotencyKey: "first-create" },
    );
    const visible = await readJsonState("work-items", () => []);

    expect(result.workItem.key).toBe("TASK-146");
    expect(visible.map((item) => item.key).sort()).toEqual(["TASK-145", "TASK-146"]);
    expect([...firestoreMock.collectionStore(FIRESTORE_COLLECTION).keys()].sort()).toEqual([
      "work-items",
      "work-items-counter",
    ]);
  });

  it("repairs a stale Firestore packet counter from the live collection before allocating", async () => {
    await writeJsonState("work-items", [
      { id: "w-task-667", key: "TASK-667", status: "ready_for_agent" },
      { id: "w-task-663", key: "TASK-663", status: "done" },
    ]);
    delete firestoreMock.collectionStore(FIRESTORE_WORK_ITEMS_COLLECTION).get("w-task-667").packetNumber;
    firestoreMock.collectionStore(FIRESTORE_WORK_ITEMS_COLLECTION).set("corrupt-packet", {
      itemId: `w-task-${"9".repeat(40)}`,
      packetNumber: Number.MAX_SAFE_INTEGER + 1,
      payload: { key: `TASK-${"9".repeat(40)}` },
      order: 0,
      revision: 1,
    });
    firestoreMock.collectionStore(FIRESTORE_COLLECTION).set("work-items-counter", {
      key: "work-items-counter",
      currentNumber: 663,
      recentCreates: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await createWorkItemState(
      (key) => ({ id: `w-${key.toLowerCase()}`, key, status: "draft" }),
      { fallbackFactory: () => [], idempotencyKey: "stale-counter-create" },
    );

    expect(result.workItem.key).toBe("TASK-668");
    expect(firestoreMock.collectionStore(FIRESTORE_COLLECTION).get("work-items-counter")).toMatchObject({
      currentNumber: 668,
      reconciliationVersion: 1,
    });
  });

  it("uses the reconciled high-water counter without rescanning live packets", async () => {
    await writeJsonState("work-items", [
      { id: "w-task-667", key: "TASK-667", status: "ready_for_agent" },
    ]);
    firestoreMock.collectionStore(FIRESTORE_COLLECTION).set("work-items-counter", {
      key: "work-items-counter",
      currentNumber: 667,
      reconciliationVersion: 1,
      recentCreates: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    firestoreMock.queryGets.length = 0;

    const result = await createWorkItemState(
      (key) => ({ id: `w-${key.toLowerCase()}`, key, status: "draft" }),
      { fallbackFactory: () => [], idempotencyKey: "reconciled-counter-create" },
    );

    expect(result.workItem.key).toBe("TASK-668");
    expect(firestoreMock.queryGets).not.toContainEqual(expect.objectContaining({
      collectionName: FIRESTORE_WORK_ITEMS_COLLECTION,
      order: null,
      limitValue: null,
      filters: [],
    }));
  });

  it("deletes stale per-item documents when the work item list shrinks", async () => {
    await writeJsonState("work-items", [
      { id: "TASK-1", status: "claimed" },
      { id: "TASK-2", status: "queued" },
    ]);

    await writeJsonState("work-items", [{ id: "TASK-2", status: "done" }]);

    const store = firestoreMock.collectionStore(FIRESTORE_WORK_ITEMS_COLLECTION);
    expect(store.has("TASK-1")).toBe(false);
    expect(store.get("TASK-2").payload).toEqual({ id: "TASK-2", status: "done" });
  });

  it("splits large work-item syncs across Firestore write batches", async () => {
    const workItems = Array.from({ length: 505 }, (_, index) => ({
      id: `TASK-${index}`,
      status: "queued",
    }));

    await writeJsonState("work-items", workItems);

    const stored = [...firestoreMock.collectionStore(FIRESTORE_WORK_ITEMS_COLLECTION).values()].sort(
      (left, right) => left.order - right.order,
    );
    expect(stored.map((doc) => doc.payload)).toEqual(workItems);
    expect(firestoreMock.batchCommits).toEqual([500, 5]);
  });

  it("does not create automatic full-state snapshots for normal Firestore work-item writes", async () => {
    delete process.env.MANAGE_AUTO_SNAPSHOTS;

    await writeJsonState("work-items", [{ id: "TASK-1", status: "claimed" }]);
    await writeJsonState("work-items", [{ id: "TASK-1", status: "done" }]);

    const snapshotDocs = [...firestoreMock.collectionStore(FIRESTORE_SNAPSHOT_COLLECTION).values()];
    expect(snapshotDocs).toEqual([]);
  });

  it("allocates unique packet keys for parallel creates and replays duplicate requests", async () => {
    const build = (key) => ({ id: `w-${key.toLowerCase()}`, key, title: key });
    firestoreMock.retryNextTransaction();
    const [first, second] = await Promise.all([
      createWorkItemState(build, { idempotencyKey: "create-a" }),
      createWorkItemState(build, { idempotencyKey: "create-b" }),
    ]);
    const replay = await createWorkItemState(build, { idempotencyKey: "create-a" });

    expect([first.workItem.key, second.workItem.key].sort()).toEqual(["TASK-101", "TASK-102"]);
    expect(replay.workItem.key).toBe(first.workItem.key);
    expect(replay.idempotentReplay).toBe(true);
    expect(firestoreMock.collectionStore(FIRESTORE_WORK_ITEMS_COLLECTION).size).toBe(2);
    expect(firestoreMock.transactionAttempts).toContain("aborted");
  });

  it("writes an ordinary mutation without reverting a different packet", async () => {
    await writeJsonState("work-items", [
      { id: "TASK-1", key: "TASK-1", status: "ready_for_agent" },
      { id: "TASK-2", key: "TASK-2", status: "ready_for_agent" },
    ]);
    const staleItems = await readJsonState("work-items", () => [], { includePersistence: true });
    const changedSecond = {
      ...staleItems[1],
      status: "blocked",
      _persistence: {
        ...staleItems[1]._persistence,
        expectedRevision: 1,
        revision: 2,
      },
    };
    await writeWorkItemMutation([staleItems[0], changedSecond], changedSecond);

    const changedFirst = {
      ...staleItems[0],
      status: "in_progress",
      _persistence: {
        ...staleItems[0]._persistence,
        expectedRevision: 1,
        revision: 2,
      },
    };
    await writeWorkItemMutation([changedFirst, staleItems[1]], changedFirst);

    const stored = firestoreMock.collectionStore(FIRESTORE_WORK_ITEMS_COLLECTION);
    expect(stored.get("TASK-1")).toMatchObject({ revision: 2, payload: { status: "in_progress" } });
    expect(stored.get("TASK-2")).toMatchObject({ revision: 2, payload: { status: "blocked" } });
  });

  it("validates and applies a multi-packet replacement in one transaction", async () => {
    await writeJsonState("work-items", [
      { id: "TASK-1", key: "TASK-1", status: "ready_for_agent" },
      { id: "TASK-2", key: "TASK-2", status: "ready_for_agent" },
    ]);
    firestoreMock.transactionCommits.length = 0;

    await writeJsonState("work-items", [
      { id: "TASK-2", key: "TASK-2", status: "done" },
      { id: "TASK-1", key: "TASK-1", status: "blocked" },
    ]);

    expect(firestoreMock.transactionCommits).toHaveLength(1);
    expect(firestoreMock.transactionCommits[0]).toHaveLength(2);
    const ordered = await readJsonState("work-items", () => []);
    expect(ordered.map((item) => item.key)).toEqual(["TASK-2", "TASK-1"]);
  });

  it("writes only the changed packet for an ordinary update", async () => {
    await writeJsonState("work-items", [
      { id: "TASK-1", key: "TASK-1", status: "ready_for_agent" },
      { id: "TASK-2", key: "TASK-2", status: "ready_for_agent" },
    ]);
    firestoreMock.transactionCommits.length = 0;

    await writeJsonState("work-items", [
      {
        id: "TASK-1",
        key: "TASK-1",
        status: "in_progress",
        _persistence: { expectedRevision: 1, revision: 2 },
      },
      { id: "TASK-2", key: "TASK-2", status: "ready_for_agent" },
    ]);

    expect(firestoreMock.transactionCommits).toEqual([[
      `set:${FIRESTORE_WORK_ITEMS_COLLECTION}/TASK-1`,
    ]]);
  });

  it("persists revision and idempotency metadata even when the packet payload is unchanged", async () => {
    const packet = { id: "TASK-1", key: "TASK-1", status: "ready_for_agent" };
    await writeJsonState("work-items", [packet]);
    await writeJsonState("work-items", [{
      ...packet,
      _persistence: {
        expectedRevision: 1,
        revision: 2,
        recentOperationIds: ["operation-1"],
      },
    }]);

    expect(firestoreMock.collectionStore(FIRESTORE_WORK_ITEMS_COLLECTION).get("TASK-1")).toMatchObject({
      payload: packet,
      revision: 2,
      recentOperationIds: ["operation-1"],
    });
  });

  it("rejects concurrent writes that use the same stale revision", async () => {
    await writeJsonState("work-items", [{ id: "TASK-1", key: "TASK-1", status: "ready_for_agent" }]);
    const mutation = (status) => writeJsonState("work-items", [{
      id: "TASK-1",
      key: "TASK-1",
      status,
      _persistence: { expectedRevision: 1, revision: 2 },
    }]);

    const results = await Promise.allSettled([mutation("in_progress"), mutation("blocked")]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected.reason).toMatchObject({
      statusCode: 409,
      code: "WORK_ITEM_REVISION_CONFLICT",
      expectedRevision: 1,
      actualRevision: 2,
    });
  });

  it("chunks large Firestore snapshots and restores them", async () => {
    process.env.MANAGE_FIRESTORE_SNAPSHOT_MAX_BYTES = "2500";
    const workItems = Array.from({ length: 30 }, (_, index) => ({
      id: `TASK-${index}`,
      status: "queued",
      notes: "x".repeat(180),
    }));

    const created = await createStateSnapshot({ "work-items": workItems });
    const snapshotStore = firestoreMock.collectionStore(FIRESTORE_SNAPSHOT_COLLECTION);
    const root = snapshotStore.get(created.id);
    const chunks = [...snapshotStore.values()].filter((doc) => doc.snapshotChunk);

    expect(root.chunked).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
    expect(firestoreMock.directSets.at(-1)).toBe(`${FIRESTORE_SNAPSHOT_COLLECTION}/${created.id}`);

    await writeJsonState("work-items", [{ id: "TASK-reset", status: "queued" }]);
    await restoreStateSnapshot(created.id);

    expect(firestoreMock.whereCalls).toContainEqual({
      collectionName: FIRESTORE_SNAPSHOT_COLLECTION,
      field: "snapshotId",
      operator: "==",
      value: created.id,
    });
    await expect(readJsonState("work-items", () => [])).resolves.toEqual(workItems);
  });

  it("chunks large non-array Firestore snapshot state", async () => {
    process.env.MANAGE_FIRESTORE_SNAPSHOT_MAX_BYTES = "2000";
    const githubCache = {
      repos: Array.from({ length: 20 }, (_, index) => ({
        name: `repo-${index}`,
        summary: "x".repeat(160),
      })),
    };

    const created = await createStateSnapshot({ "github-cache": githubCache });
    const snapshotStore = firestoreMock.collectionStore(FIRESTORE_SNAPSHOT_COLLECTION);
    const root = snapshotStore.get(created.id);
    const chunks = [...snapshotStore.values()].filter((doc) => doc.snapshotChunk);

    expect(root.chunked).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => chunk.kind === "json")).toBe(true);

    await writeJsonState("github-cache", { repos: [] });
    await restoreStateSnapshot(created.id);

    await expect(readJsonState("github-cache", () => ({ repos: [] }))).resolves.toEqual(githubCache);
  });
});

describe("file backend errors", () => {
  it("throws on an unsupported backend env value", async () => {
    process.env.MANAGE_STORAGE_BACKEND = "redis";
    await expect(readJsonState("work-items", () => [])).rejects.toThrow(/Unsupported MANAGE_STORAGE_BACKEND/);
  });
});

describe("getStorageStatus", () => {
  it("describes the file backend with the active data dir and retention default", () => {
    process.env.MANAGE_STORAGE_BACKEND = "file";

    const status = getStorageStatus();
    expect(status.kind).toBe("file");
    expect(status.dataDir).toBe(path.resolve(dataDir));
    expect(status.files.workItems).toBe(path.join(path.resolve(dataDir), "work-items.json"));
    expect(status.files.githubCache).toBe(path.join(path.resolve(dataDir), "github-cache.json"));
    expect(status.files.initiatives).toBe(path.join(path.resolve(dataDir), "initiatives.json"));
    expect(status.files.savedViews).toBe(path.join(path.resolve(dataDir), "saved-views.json"));
    expect(status.files.packetEvents).toBe(path.join(path.resolve(dataDir), "packet-events.jsonl"));
    expect(status.backups.retention).toBe(25);
    expect(status.backups.automatic).toBe(false);
  });

  it("describes the Firestore backend with per-packet collections", () => {
    process.env.MANAGE_STORAGE_BACKEND = "firestore";
    process.env.MANAGE_FIRESTORE_COLLECTION = FIRESTORE_COLLECTION;
    process.env.MANAGE_FIRESTORE_WORK_ITEMS_COLLECTION = FIRESTORE_WORK_ITEMS_COLLECTION;
    process.env.MANAGE_FIRESTORE_SNAPSHOT_COLLECTION = FIRESTORE_SNAPSHOT_COLLECTION;
    process.env.MANAGE_FIRESTORE_PROJECT_ID = "manage-test-project";
    process.env.MANAGE_FIRESTORE_DATABASE_ID = "manage-test-db";

    const status = getStorageStatus();
    expect(status).toMatchObject({
      kind: "firestore",
      projectId: "manage-test-project",
      databaseId: "manage-test-db",
      collection: FIRESTORE_COLLECTION,
      collections: {
        workItems: FIRESTORE_WORK_ITEMS_COLLECTION,
        snapshots: FIRESTORE_SNAPSHOT_COLLECTION,
        packetEvents: `${FIRESTORE_COLLECTION}_packet_events`,
      },
      documents: {
        legacyWorkItems: "work-items",
        githubCache: "github-cache",
        workItemsCounter: "work-items-counter",
      },
      packetKeyPrefix: "TASK",
      backups: {
        enabled: true,
        automatic: false,
        retention: 25,
        collection: FIRESTORE_SNAPSHOT_COLLECTION,
        maxDocumentBytes: 850_000,
      },
    });
    expect(status.documents.initiatives).toBe("initiatives");
    expect(status.documents.savedViews).toBe("saved-views");
    expect(status.documents.legacySavedViews).toBe("saved-views");
    expect(status.documents.savedViewPrincipals).toBe("saved-views-<sha256-principal>");
  });

  it("clamps snapshot retention to [5, 250] and ignores garbage", () => {
    process.env.MANAGE_SNAPSHOT_RETENTION = "3";
    expect(getStorageStatus().backups.retention).toBe(5);
    process.env.MANAGE_SNAPSHOT_RETENTION = "9999";
    expect(getStorageStatus().backups.retention).toBe(250);
    process.env.MANAGE_SNAPSHOT_RETENTION = "not-a-number";
    expect(getStorageStatus().backups.retention).toBe(25);
    process.env.MANAGE_SNAPSHOT_RETENTION = "-4";
    expect(getStorageStatus().backups.retention).toBe(25);
  });

  it("reports automatic snapshots on by default for work-items", () => {
    delete process.env.MANAGE_AUTO_SNAPSHOTS;
    process.env.MANAGE_STORAGE_BACKEND = "file";
    expect(getStorageStatus().backups.automatic).toBe(true);
  });

  it("surfaces an unsupported backend instead of throwing", () => {
    process.env.MANAGE_STORAGE_BACKEND = "redis";
    const status = getStorageStatus();
    expect(status.kind).toBe("redis");
    expect(status.error).toMatch(/Unsupported/);
  });
});

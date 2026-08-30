import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  normalizeSavedBacklogState,
  patchSavedView,
  savedViewPrincipalKey,
} from "./savedViewStore.mjs";

let dataDir;
let savedEnv;

function githubSession(id = 123, login = "operator") {
  return { mode: "github", user: { sub: `github:${id}`, login, provider: "github", role: "operator" } };
}

function tokenSession() {
  return { mode: "cookie", user: { sub: "operator", login: "operator", provider: "token", role: "operator" } };
}

function agentSession() {
  return { mode: "token", user: { sub: "bearer-token", login: "Bearer token", provider: "token", role: "agent" } };
}

const backlogState = { version: 1, repo: "web-app", status: "ready_for_agent", label: "bug", query: "url" };

beforeEach(async () => {
  savedEnv = {
    MANAGE_DATA_DIR: process.env.MANAGE_DATA_DIR,
    MANAGE_STORAGE_BACKEND: process.env.MANAGE_STORAGE_BACKEND,
  };
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "manage-saved-views-"));
  process.env.MANAGE_DATA_DIR = dataDir;
  process.env.MANAGE_STORAGE_BACKEND = "file";
});

afterEach(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("saved view store", () => {
  it("isolates GitHub principals and explicitly shares the operator-token namespace", async () => {
    const created = await createSavedView(githubSession(123), {
      name: "Ready web app",
      state: backlogState,
      idempotencyKey: "create-1",
    });
    expect(created.savedView.name).toBe("Ready web app");
    expect((await listSavedViews(githubSession(456))).savedViews).toEqual([]);
    expect((await listSavedViews(githubSession(123))).savedViews).toHaveLength(1);

    await createSavedView(tokenSession(), { name: "Shared operator view", state: backlogState, idempotencyKey: "token-create" });
    expect(savedViewPrincipalKey(tokenSession())).toBe("token:operator");
    expect((await listSavedViews(tokenSession())).savedViews.map((view) => view.name)).toEqual(["Shared operator view"]);
    expect(() => savedViewPrincipalKey(agentSession())).toThrow(/authenticated operator/);
  });

  it("replays create idempotently and enforces revisions for update and delete", async () => {
    const first = await createSavedView(githubSession(), { name: "My view", state: backlogState, idempotencyKey: "same-create" });
    const replay = await createSavedView(githubSession(), {
      name: "Ignored retry name",
      state: backlogState,
      idempotencyKey: "same-create",
    });
    expect(replay).toMatchObject({ idempotentReplay: true, savedView: { id: first.savedView.id } });
    expect((await listSavedViews(githubSession())).savedViews).toHaveLength(1);

    const updated = await patchSavedView(githubSession(), first.savedView.id, {
      name: "Renamed",
      expectedRevision: 1,
    });
    expect(updated.savedView).toMatchObject({ name: "Renamed", revision: 2 });
    await expect(patchSavedView(githubSession(), first.savedView.id, {
      state: backlogState,
      expectedRevision: 1,
    })).rejects.toMatchObject({ statusCode: 409 });
    await expect(deleteSavedView(githubSession(), first.savedView.id, { expectedRevision: 1 })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(await deleteSavedView(githubSession(), first.savedView.id, { expectedRevision: 2 })).toEqual({
      id: first.savedView.id,
      deleted: true,
    });
    expect(await deleteSavedView(githubSession(), first.savedView.id, {})).toEqual({
      id: first.savedView.id,
      deleted: false,
    });
  });

  it("rejects CSC catalog ids and CSC packet language in saved state", () => {
    expect(() => normalizeSavedBacklogState({ repo: "csc-workspace" })).toThrow(/repository is invalid/);
    expect(() => normalizeSavedBacklogState({ repo: "regvault" })).toThrow(/repository is invalid/);
    expect(() => normalizeSavedBacklogState({ repo: "crm-deploy" })).toThrow(/repository is invalid/);
    expect(normalizeSavedBacklogState({ repo: "web-app", query: "TASK-101" })).toMatchObject({
      repo: "web-app",
      query: "TASK-101",
    });
  });

  it("isolates malformed records and refuses to overwrite a corrupt root", async () => {
    const created = await createSavedView(githubSession(), { name: "Valid", state: backlogState, idempotencyKey: "valid" });
    const statePath = path.join(dataDir, "saved-views.json");
    const stored = JSON.parse(await fs.readFile(statePath, "utf8"));
    stored.principals[0].views.push({ id: "bad" });
    await fs.writeFile(statePath, JSON.stringify(stored));

    const listed = await listSavedViews(githubSession());
    expect(listed.savedViews.map((view) => view.id)).toEqual([created.savedView.id]);
    expect(listed.warnings).toEqual(["1 saved view is unavailable because stored data is invalid."]);
    expect(JSON.stringify(listed)).not.toMatch(/Commerce Street|csc-workspace|CSC-|COM-|Harbor|RegVault/i);

    await fs.writeFile(statePath, JSON.stringify({ broken: true }));
    await expect(createSavedView(githubSession(), { name: "Blocked", state: backlogState })).rejects.toMatchObject({
      statusCode: 500,
    });
    expect(JSON.parse(await fs.readFile(statePath, "utf8"))).toEqual({ broken: true });
  });
});

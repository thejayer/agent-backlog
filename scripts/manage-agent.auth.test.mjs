import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "scripts", "manage-agent.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

describe("lifecycle CLI create and doctor", () => {
  it("dry-runs doctor against the local bootstrap route", () => {
    const result = runCli(["doctor", "--dry-run", "--json"]);
    const payload = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(payload.dryRun).toBe(true);
    expect(payload.request.method).toBe("GET");
    expect(payload.request.url).toBe("http://127.0.0.1:5186/api/agent/bootstrap");
  });

  it("dry-runs next-key against the local next-key route", () => {
    const result = runCli(["next-key", "--dry-run", "--json"]);
    const payload = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(payload.nextKey).toBe("TASK-??");
    expect(payload.request.url).toBe("http://127.0.0.1:5186/api/agent/next-key");
  });

  it("dry-runs create against the agent task route with public defaults", () => {
    const result = runCli([
      "create",
      "--dry-run",
      "--json",
      "--title",
      "Harden login rate limits",
      "--summary",
      "Add rate limits to the public login path.",
      "--ready",
    ]);
    const payload = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(payload.request.method).toBe("POST");
    expect(payload.request.url).toBe("http://127.0.0.1:5186/api/agent/tasks");
    expect(payload.request.body).toMatchObject({
      title: "Harden login rate limits",
      summary: "Add rate limits to the public login path.",
      repo: "web-app",
      project: "Agent Backlog",
      ready: true,
      status: "ready_for_agent",
    });
    expect(JSON.stringify(payload)).not.toMatch(/commercestreet|csc-crm-io|csc-workspace|CSC-/i);
  });
});

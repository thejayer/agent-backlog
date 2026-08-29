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

describe("lifecycle CLI recovery commands", () => {
  it("prints recovery commands in help without CSC defaults", () => {
    const result = runCli(["help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("extend <KEY>");
    expect(result.stdout).toContain("reclaim <KEY>");
    expect(result.stdout).toContain("release <KEY>");
    expect(result.stdout).toContain("doctor");
    expect(result.stdout).toContain("create");
    expect(result.stdout).toContain("next-key");
    expect(result.stdout).toContain("http://127.0.0.1:5186");
    expect(result.stdout).toContain("MANAGE_AUTH_TOKEN");
    expect(result.stdout).toContain("TASK-113");
    expect(result.stdout).not.toMatch(/commercestreet|csc-crm-io|CSC-|gcloud|origin\/master|update csc-workspace/i);
  });

  it("dry-runs extend against the local recovery route", () => {
    const result = runCli(["extend", "TASK-101", "--dry-run", "--json", "--lease-minutes", "45"]);
    const payload = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(payload.dryRun).toBe(true);
    expect(payload.request.method).toBe("POST");
    expect(payload.request.url).toBe("http://127.0.0.1:5186/api/agent/tasks/TASK-101/recovery");
    expect(payload.request.body).toMatchObject({
      action: "extend",
      agent: "Codex",
      agentRunId: "",
      leaseMinutes: 45,
    });
  });

  it("dry-runs reclaim and release with the observed run id when provided", () => {
    const reclaim = JSON.parse(runCli([
      "reclaim",
      "TASK-102",
      "--dry-run",
      "--json",
      "--agent-run-id",
      "TASK-102-observed",
    ]).stdout);
    const release = JSON.parse(runCli([
      "release",
      "TASK-102",
      "--dry-run",
      "--json",
      "--agent-run-id",
      "TASK-102-observed",
    ]).stdout);

    expect(reclaim.request.body).toMatchObject({
      action: "reclaim",
      agentRunId: "TASK-102-observed",
      leaseMinutes: 90,
    });
    expect(release.request.body).toMatchObject({
      action: "release",
      agentRunId: "TASK-102-observed",
    });
    expect(release.request.body.leaseMinutes).toBeUndefined();
  });
});

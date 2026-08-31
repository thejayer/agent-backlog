#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import {
  AGENT_RUN_EXTEND_LEASE_MINUTES,
  AGENT_RUN_RECLAIM_LEASE_MINUTES,
  evaluateAgentCompatibility,
} from "../manage/src/lib/agentRunContract.mjs";

const DEFAULT_BASE_URL = process.env.MANAGE_BASE_URL || "http://127.0.0.1:5186";
const DEFAULT_AGENT = "Codex";
const DEFAULT_OWNER = "your-org";
const REPEATABLE_OPTIONS = new Set(["test", "testsRun", "file", "filesChanged", "blocker", "blockers", "next", "nextSteps", "cmd", "label", "labels"]);

function usage() {
  return `Agent Backlog agent lifecycle helper

Usage:
  npm run manage:agent -- <command> [options]

Commands:
  claim-next              Claim the next ready packet.
  claim <KEY>             Claim a specific packet.
  extend <KEY>            Extend an active run lease (operator session).
  reclaim <KEY>           Reclaim a stale, incomplete, or failed run (operator session).
  release <KEY>           Release the observed run to the ready queue (operator session).
  progress <KEY>          Write status=in_progress.
  heartbeat <KEY>         Record an append-only run heartbeat without extending the lease.
  review <KEY>            Write status=needs_review.
  blocked <KEY>           Write status=blocked.
  status <KEY>            Write an explicit status with --status.
  closeout <KEY>          Verify a merged PR with gh and write status=done.
  validate                Run local validation commands and print testsRun lines.
  doctor                  Verify CLI/server compatibility and agent authentication.
  next-key                Print the next available TASK- key.
  create                  Create a new work packet via the agent API.

Common options:
  --base-url <url>        Agent Backlog base URL. Default: ${DEFAULT_BASE_URL}
  --agent <name>          Agent name. Default: ${DEFAULT_AGENT}
  --lease-minutes <n>     Claim lease length. Default: 90
  --repo <repo>           Repo filter, or GitHub owner/repo for closeout.
  --label <label>         Label filter for claim-next.
  --agent-run-id <id>     Agent run id for status writes. Defaults to current task value.
  --note <text>           Status note.
  --state <state>         Heartbeat state: running, waiting, blocked, idle, failed.
  --step <text>           Heartbeat current step.
  --branch <name>         GitHub branch recorded on the packet.
  --pr <url|number>       GitHub PR URL/number/ref recorded on the packet.
  --test <text>           Repeatable testsRun entry.
  --file <path>           Repeatable filesChanged entry.
  --blocker <text>        Repeatable blocker entry.
  --next <text>           Repeatable nextSteps entry.
  --cmd <command>         Repeatable command for validate.
  --json                  Print JSON output.
  --dry-run               Print the request/payload without network writes.

Auth options:
  --token-env <name>      Env var containing the bearer token. Default: MANAGE_AUTH_TOKEN

The bearer token is read from the MANAGE_AUTH_TOKEN environment variable (or the
var named by --token-env). Set it before running write commands.

Examples:
  npm run manage:agent -- claim-next --repo web-app
  npm run manage:agent -- extend TASK-113 --lease-minutes 60
  npm run manage:agent -- reclaim TASK-113
  npm run manage:agent -- release TASK-113
  npm run manage:agent -- progress TASK-113 --note "Implementation started"
  npm run manage:agent -- heartbeat TASK-113 --state running --step "Writing tests"
  npm run manage:agent -- review TASK-113 --branch codex/foo --pr https://github.com/your-org/web-app/pull/107 --test "npm test - passed" --file src/App.jsx
  npm run manage:agent -- closeout TASK-113 --repo your-org/web-app --pr 107
  npm run manage:agent -- validate --cmd "npm test" --cmd "npm run build"
  npm run manage:agent -- next-key
  npm run manage:agent -- doctor
  npm run manage:agent -- create --title "Harden login rate limits" --summary "..." --repo web-app --priority high --ready
`;
}

function toCamel(value) {
  return String(value).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  const positionals = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf("=");
    const rawName = equalsIndex === -1 ? raw : raw.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : raw.slice(equalsIndex + 1);
    const name = toCamel(rawName);

    if (["dryRun", "json", "noSecret", "help", "ready"].includes(name)) {
      options[name] = true;
      continue;
    }

    const value = inlineValue !== undefined ? inlineValue : rest[index + 1];

    if (inlineValue === undefined) {
      index += 1;
    }

    if (value === undefined) {
      throw new Error(`Missing value for --${rawName}`);
    }

    if (REPEATABLE_OPTIONS.has(name)) {
      options[name] = [...(options[name] || []), value];
    } else {
      options[name] = value;
    }
  }

  return { command, positionals, options };
}

function asList(...values) {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : value == null ? [] : [value]))
    .flatMap((value) => String(value).split("\n"))
    .map((value) => value.trim())
    .filter(Boolean);
}

function numberOption(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseUrl(options) {
  return String(options.baseUrl || process.env.MANAGE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function loadToken(options) {
  const tokenEnv = options.tokenEnv || "MANAGE_AUTH_TOKEN";
  const existing = String(process.env[tokenEnv] || "").trim();

  if (existing) {
    return existing;
  }

  throw new Error(
    `${tokenEnv} is not set. Export your Agent Backlog bearer token first, e.g. export ${tokenEnv}="<token>".`,
  );
}

function buildUrl(path, options) {
  return `${normalizeBaseUrl(options)}${path}`;
}

async function requestManage(path, { method = "GET", body } = {}, options = {}) {
  const url = buildUrl(path, options);
  const request = {
    method,
    url,
    body: body || null,
  };

  if (options.dryRun) {
    return { dryRun: true, request };
  }

  const token = loadToken(options);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = payload.error || `Request failed with ${response.status}`;
    throw Object.assign(new Error(message), { statusCode: response.status, payload });
  }

  return payload;
}

async function doctor(options) {
  const payload = await requestManage("/api/agent/bootstrap", { method: "GET" }, options);

  if (payload.dryRun) {
    print("Compatibility preflight", payload, options);
    return;
  }

  const result = {
    ...evaluateAgentCompatibility(payload.bootstrap),
    baseUrl: normalizeBaseUrl(options),
    authenticated: true,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Compatibility: OK");
  console.log(`Base URL: ${result.baseUrl}`);
  console.log(`CLI contract: ${result.cliContractVersion}`);
  console.log(`Server contract: ${result.serverContractVersion}`);
  console.log(`Create endpoint: ${result.createTaskPath}`);
}

function computeNextKey(items) {
  const maxNumber = items.reduce((max, item) => {
    const match = String(item.key || "").match(/^TASK-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 100);

  return `TASK-${maxNumber + 1}`;
}

async function nextKeyCommand(options) {
  const fs = await import("node:fs/promises");
  const pathMod = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  try {
    const payload = await requestManage("/api/agent/next-key", { method: "GET" }, options);

    if (payload.dryRun) {
      if (options.json) {
        console.log(JSON.stringify({ nextKey: "TASK-??", source: "dry-run", request: payload.request }, null, 2));
      } else {
        console.log("TASK-??? (dry-run)");
      }
      return;
    }

    const next = payload.nextKey;
    if (options.json) {
      console.log(JSON.stringify({ nextKey: next, source: payload.source || "remote" }, null, 2));
    } else {
      console.log(next);
    }
    return;
  } catch (remoteErr) {
    const statusCode = remoteErr?.statusCode;
    const canUseLocalFallback =
      statusCode >= 500 ||
      remoteErr?.cause?.code ||
      remoteErr?.name === "AbortError";

    if (!canUseLocalFallback && !options.dryRun) {
      throw remoteErr;
    }

    if (options.dryRun) {
      if (options.json) {
        console.log(JSON.stringify({ nextKey: "TASK-??", source: "dry-run" }, null, 2));
      } else {
        console.log("TASK-??? (dry-run)");
      }
      return;
    }

    let localData = null;
    const scriptDir = pathMod.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      pathMod.join(process.cwd(), "manage", "data", "work-items.json"),
      pathMod.join(scriptDir, "..", "manage", "data", "work-items.json"),
    ];

    for (const cand of candidates) {
      try {
        const content = await fs.readFile(cand, "utf8");
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          localData = parsed;
          break;
        }
      } catch {
        // try the next candidate
      }
    }

    if (localData) {
      const next = computeNextKey(localData);
      if (options.json) {
        console.log(JSON.stringify({ nextKey: next, source: "local-work-items.json" }, null, 2));
      } else {
        console.log(next);
      }
      return;
    }

    throw new Error("Could not determine next key (remote failed and no local data): " + remoteErr.message);
  }
}

async function createPacket(positionals, options) {
  const title = options.title || (positionals[0] || "Untitled work packet");
  const body = {
    title: String(title).trim(),
    summary: options.summary || "",
    desiredOutcome: options.desiredOutcome || options.outcome || "",
    project: options.project || "Agent Backlog",
    repo: options.repo || "web-app",
    priority: options.priority || "medium",
    status: options.status || (options.ready ? "ready_for_agent" : "draft"),
    labels: asList(options.labels, options.label),
    acceptanceCriteria: asList(options.acceptanceCriteria, options.criteria),
    relevantFiles: asList(options.relevantFiles, options.file),
    relevantUrls: asList(options.relevantUrls, options.url),
    implementationNotes: asList(options.implementationNotes, options.note),
    testCommands: asList(options.testCommands, options.testCmd),
    deployNotes: options.deployNotes || "",
    blockedBy: options.blockedBy || "",
    branch: options.branch || options.suggestedBranch || "",
  };

  if (options.ready) {
    body.ready = true;
  }

  const payload = await requestManage("/api/agent/tasks", { method: "POST", body }, options);
  if (options.json || options.dryRun) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    const item = payload.workItem || payload;
    console.log(`Created: ${item.key || "???"} - ${item.title || title}`);
    if (item.links?.markdown || payload.links?.markdown) {
      console.log(`Packet: ${item.links?.markdown || payload.links.markdown}`);
    }
  }
}

async function getTask(key, options) {
  const payload = await requestManage(`/api/agent/tasks/${encodeURIComponent(key)}`, {}, options);
  return payload.workItem;
}

function taskKey(positionals) {
  const key = String(positionals[0] || "").trim().toUpperCase();

  if (!key) {
    throw new Error("A work packet key is required.");
  }

  return key;
}

function statusBody(key, status, options, workItem = {}) {
  return {
    status,
    agent: options.agent || process.env.MANAGE_AGENT || DEFAULT_AGENT,
    agentRunId: options.agentRunId || workItem.agentRunId || "",
    note: options.note || defaultNote(status),
    githubBranch: options.githubBranch || options.branch || workItem.githubBranch || workItem.suggestedBranch || "",
    githubPrUrl: options.githubPrUrl || options.pr || workItem.githubPrUrl || "",
    testsRun: asList(options.testsRun, options.test),
    filesChanged: asList(options.filesChanged, options.file),
    blockers: asList(options.blockers, options.blocker),
    nextSteps: asList(options.nextSteps, options.next),
  };
}

function defaultNote(status) {
  if (status === "in_progress") return "Implementation in progress.";
  if (status === "needs_review") return "Ready for review.";
  if (status === "done") return "Merged and complete.";
  if (status === "blocked") return "Blocked pending external input.";
  return "Status update.";
}

function repoSlug(value, workItem = {}) {
  const repo = String(value || workItem.repo || "").trim();

  if (!repo) {
    throw new Error("GitHub repo is required for closeout, for example --repo your-org/web-app.");
  }

  return repo.includes("/") ? repo : `${DEFAULT_OWNER}/${repo}`;
}

function ghJson(args) {
  const output = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output);
}

function ghLines(args) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim() : error.message;
    return [`gh ${args.join(" ")} failed: ${detail}`];
  }
}

function print(label, payload, options = {}) {
  if (options.json || options.dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const item = payload.workItem;

  if (item) {
    console.log(`${label}: ${item.key} ${item.status}`);
    if (item.agentRunId) console.log(`Agent run ID: ${item.agentRunId}`);
    if (item.agentRunHealth?.state) console.log(`Run health: ${item.agentRunHealth.state} — ${item.agentRunHealth.summary}`);
    if (item.githubPrUrl) console.log(`PR: ${item.githubPrUrl}`);
    if (payload.links?.markdown) console.log(`Packet: ${payload.links.markdown}`);
    return;
  }

  console.log(`${label}: OK`);
}

async function claimNext(options) {
  const body = {
    repo: options.repo || undefined,
    label: options.label || undefined,
    agent: options.agent || process.env.MANAGE_AGENT || DEFAULT_AGENT,
    leaseMinutes: numberOption(options.leaseMinutes, 90),
  };
  const payload = await requestManage("/api/agent/next/claim", { method: "POST", body }, options);
  print("Claimed next packet", payload, options);
}

async function claim(positionals, options) {
  const key = taskKey(positionals);
  const body = {
    agent: options.agent || process.env.MANAGE_AGENT || DEFAULT_AGENT,
    leaseMinutes: numberOption(options.leaseMinutes, 90),
  };
  const payload = await requestManage(`/api/agent/tasks/${encodeURIComponent(key)}/claim`, { method: "POST", body }, options);
  print("Claimed packet", payload, options);
}

async function recover(positionals, options, action) {
  const key = taskKey(positionals);
  const workItem = options.dryRun ? {} : await getTask(key, options);
  const body = {
    action,
    agent: options.agent || process.env.MANAGE_AGENT || DEFAULT_AGENT,
    agentRunId: options.agentRunId === undefined ? workItem.agentRunId || "" : String(options.agentRunId || "").trim(),
    note: options.note || undefined,
    ...(action === "extend" ? { leaseMinutes: numberOption(options.leaseMinutes, AGENT_RUN_EXTEND_LEASE_MINUTES) } : {}),
    ...(action === "reclaim" ? { leaseMinutes: numberOption(options.leaseMinutes, AGENT_RUN_RECLAIM_LEASE_MINUTES) } : {}),
  };
  const payload = await requestManage(`/api/agent/tasks/${encodeURIComponent(key)}/recovery`, { method: "POST", body }, options);
  print(`${action[0].toUpperCase()}${action.slice(1)} recovery`, payload, options);
}

async function heartbeat(positionals, options) {
  const key = taskKey(positionals);
  const workItem = options.dryRun ? {} : await getTask(key, options);
  const body = {
    agent: options.agent || process.env.MANAGE_AGENT || DEFAULT_AGENT,
    agentRunId: options.agentRunId || workItem.agentRunId || "",
    state: options.state || "running",
    currentStep: options.step || options.currentStep || "",
    note: options.note || options.step || options.currentStep || "",
  };
  const payload = await requestManage(`/api/agent/tasks/${encodeURIComponent(key)}/heartbeat`, { method: "POST", body }, options);
  print("Recorded heartbeat", payload, options);
}

async function writeStatus(positionals, options, explicitStatus) {
  const key = taskKey(positionals);
  const status = explicitStatus || options.status;

  if (!status) {
    throw new Error("Status is required. Use status <KEY> --status <value>, or use progress/review/blocked.");
  }

  const workItem = options.dryRun ? {} : await getTask(key, options);
  const body = statusBody(key, status, options, workItem);
  const payload = await requestManage(`/api/agent/tasks/${encodeURIComponent(key)}/status`, { method: "POST", body }, options);
  print(`Wrote ${status}`, payload, options);
}

async function closeout(positionals, options) {
  const key = taskKey(positionals);
  const workItem = options.dryRun ? {} : await getTask(key, options);
  const slug = repoSlug(options.repo, workItem);
  const prRef = options.pr || workItem.githubPrUrl || workItem.githubBranch || options.branch;

  if (!prRef) {
    throw new Error("A PR ref is required for closeout. Pass --pr <number|url|branch> or ensure the task has githubPrUrl/githubBranch.");
  }

  if (options.dryRun) {
    const body = statusBody(key, "done", options, workItem);
    body.note = `Dry run closeout for PR ${prRef} in ${slug}.`;
    const payload = await requestManage(`/api/agent/tasks/${encodeURIComponent(key)}/status`, { method: "POST", body }, options);
    print("Dry run closeout", payload, options);
    return;
  }

  const pr = ghJson(["pr", "view", String(prRef), "--repo", slug, "--json", "number,url,state,mergedAt,mergeCommit,headRefName,baseRefName,isDraft"]);

  if (pr.state !== "MERGED") {
    throw new Error(`PR #${pr.number} is ${pr.state}, not MERGED. Refusing to write status=done.`);
  }

  const mergeCommit = pr.mergeCommit?.oid || "unknown";
  const checkLines = ghLines(["pr", "checks", String(pr.number), "--repo", slug]);
  const fileLines = ghLines(["pr", "diff", String(pr.number), "--repo", slug, "--name-only"]);
  const body = {
    status: "done",
    agent: options.agent || process.env.MANAGE_AGENT || DEFAULT_AGENT,
    agentRunId: options.agentRunId || workItem.agentRunId || "",
    note: `Merged PR #${pr.number}. Merge commit ${mergeCommit}.`,
    githubBranch: pr.headRefName || workItem.githubBranch || "",
    githubPrUrl: pr.url,
    testsRun: [
      `GitHub PR #${pr.number} merged at ${pr.mergedAt}`,
      `Merge commit ${mergeCommit}`,
      ...checkLines,
    ],
    filesChanged: fileLines,
    blockers: [],
    nextSteps: [`Pull ${pr.baseRefName || "the base branch"} before starting the next packet.`],
  };
  const payload = await requestManage(`/api/agent/tasks/${encodeURIComponent(key)}/status`, { method: "POST", body }, options);
  print("Closed out merged packet", payload, options);
}

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function validate(options) {
  const commands = asList(options.cmd);

  if (commands.length === 0) {
    throw new Error("validate requires at least one --cmd value.");
  }

  const results = [];
  let failed = false;

  for (const command of commands) {
    const started = performance.now();
    console.log(`\n> ${command}`);
    const result = spawnSync(command, { shell: true, stdio: "inherit" });
    const duration = formatDuration(performance.now() - started);
    const passed = result.status === 0;
    results.push(`${command} - ${passed ? "passed" : `failed (${result.status ?? "unknown"})`} in ${duration}`);
    failed ||= !passed;
  }

  const payload = { testsRun: results, ok: !failed };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("\nTestsRun entries:");
    for (const line of results) {
      console.log(`- ${line}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

async function main() {
  const { command, positionals, options } = parseArgs(process.argv.slice(2));

  if (!command || command === "help" || options.help || command === "-h" || command === "--help") {
    console.log(usage());
    return;
  }

  if (command === "claim-next") return claimNext(options);
  if (command === "claim") return claim(positionals, options);
  if (command === "extend") return recover(positionals, options, "extend");
  if (command === "reclaim") return recover(positionals, options, "reclaim");
  if (command === "release") return recover(positionals, options, "release");
  if (command === "progress") return writeStatus(positionals, options, "in_progress");
  if (command === "heartbeat") return heartbeat(positionals, options);
  if (command === "review") return writeStatus(positionals, options, "needs_review");
  if (command === "blocked") return writeStatus(positionals, options, "blocked");
  if (command === "status") return writeStatus(positionals, options);
  if (command === "closeout") return closeout(positionals, options);
  if (command === "validate") return validate(options);
  if (command === "doctor") return doctor(options);
  if (command === "next-key") return nextKeyCommand(options);
  if (command === "create") return createPacket(positionals, options);

  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(error.message);

  if (error.payload) {
    console.error(JSON.stringify(error.payload, null, 2));
  }

  process.exitCode = 1;
});

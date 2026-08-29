const priorityRank = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

function listBlock(items) {
  const list = Array.isArray(items)
    ? items
    : String(items || "")
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);

  if (list.length === 0) {
    return "- None recorded";
  }

  return list.map((item) => `- ${item}`).join("\n");
}

function lineItems(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function field(value, fallback = "Not recorded") {
  return value && String(value).trim() ? value : fallback;
}

function jsonBlock(value) {
  return JSON.stringify(value, null, 2);
}

function normalizeLabel(value) {
  return String(value || "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function itemLabels(workItem) {
  const labels = Array.isArray(workItem?.labels) ? workItem.labels : String(workItem?.labels || "").split(/[,\n]/);
  return [...new Set(labels.map(normalizeLabel).filter(Boolean))];
}

function labelLine(workItem) {
  const labels = itemLabels(workItem);
  return labels.length > 0 ? labels.map((label) => `#${label}`).join(", ") : "None recorded";
}

function compactEventLog(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return "- None recorded";
  }

  return events
    .slice(-5)
    .map((event) => {
      const parts = [event.type || "event", event.agent || "agent", event.status || "", event.note || ""].filter(Boolean);
      const testsRun = lineItems(event.testsRun);
      const filesChanged = lineItems(event.filesChanged);
      const blockers = lineItems(event.blockers);
      const nextSteps = lineItems(event.nextSteps);
      const details = [
        event.githubBranch ? `branch ${event.githubBranch}` : "",
        event.githubPrUrl ? `PR ${event.githubPrUrl}` : "",
        testsRun.length > 0 ? `tests ${testsRun.join("; ")}` : "",
        filesChanged.length > 0 ? `files ${filesChanged.join("; ")}` : "",
        blockers.length > 0 ? `blockers ${blockers.join("; ")}` : "",
        nextSteps.length > 0 ? `next ${nextSteps.join("; ")}` : "",
      ].filter(Boolean);
      return `- ${field(event.at)}: ${parts.join(" - ")}${details.length > 0 ? ` (${details.join(" | ")})` : ""}`;
    })
    .join("\n");
}

function compactGithubLinks(githubLinks) {
  if (!githubLinks) {
    return "- None recorded";
  }

  const lines = [];

  for (const pr of githubLinks.pullRequests || []) {
    lines.push(`- PR #${pr.number}: ${pr.title} (${pr.url})`);
  }

  for (const branch of githubLinks.branches || []) {
    lines.push(`- Branch: ${branch.name}`);
  }

  for (const issue of githubLinks.issues || []) {
    lines.push(`- Issue #${issue.number}: ${issue.title} (${issue.url})`);
  }

  for (const run of githubLinks.workflowRuns || []) {
    lines.push(`- Workflow: ${run.name} on ${run.branch} (${run.url})`);
  }

  return lines.length > 0 ? lines.join("\n") : "- None recorded";
}

function isExpiredLease(workItem, now = Date.now()) {
  if (!workItem.leaseExpiresAt) {
    return false;
  }

  const expiresAt = Date.parse(workItem.leaseExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

function endpoint(baseUrl, path) {
  return `${String(baseUrl || "").replace(/\/$/, "")}${path}`;
}

function workItemKey(workItem) {
  const key = workItem?.key || "{key}";
  return String(key).includes("{") ? key : encodeURIComponent(key);
}

function powerShellString(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function powerShellArray(items) {
  const values = lineItems(items);

  if (values.length === 0) {
    return "@()";
  }

  return `@(${values.map(powerShellString).join(", ")})`;
}

function suggestedBranch(workItem) {
  return workItem?.githubBranch || workItem?.suggestedBranch || `codex/${String(workItem?.key || "task-###").toLowerCase()}-short-name`;
}

function repoSlug(workItem = {}, repository = {}) {
  const owner = repository.owner || "your-org";
  const name = repository.name || workItem.repo || "repo";
  return `${owner}/${name}`;
}

function repoUrl(workItem = {}, repository = {}) {
  const urls = lineItems(workItem.relevantUrls);
  const githubUrl = urls.find((url) => /^https:\/\/github\.com\/[^/]+\/[^/\s]+/.test(url));

  if (githubUrl) {
    const match = githubUrl.match(/^https:\/\/github\.com\/[^/]+\/[^/\s]+/);
    return match ? match[0] : githubUrl;
  }

  return `https://github.com/${repoSlug(workItem, repository)}`;
}

function agentStatusPayload(workItem = {}, agent = "Codex", status = "in_progress") {
  const statusCopy = {
    in_progress: {
      note: "Progress update summary.",
      nextSteps: ["Continue implementation."],
    },
    needs_review: {
      note: "Ready for review. Summarize what changed, what was tested, PR readiness, and any reviewer notes.",
      nextSteps: ["Reviewer should inspect the linked PR and run or inspect the listed checks."],
    },
    done: {
      note: "Merged PR. Include the merge commit, final check state, deployment note, and anything skipped.",
      nextSteps: ["Pull the target branch before starting the next packet."],
    },
    blocked: {
      note: "Blocked. State the exact external input or system change required.",
      nextSteps: ["Resolve the blocker before continuing implementation."],
    },
  };
  const copy = statusCopy[status] || statusCopy.in_progress;

  return {
    status,
    agent,
    agentRunId: workItem.agentRunId || "returned-agent-run-id",
    note: copy.note,
    githubBranch: workItem.githubBranch || workItem.suggestedBranch || "codex/task-###-short-name",
    githubPrUrl: workItem.githubPrUrl || "https://github.com/your-org/repo/pull/123",
    testsRun: ["npm.cmd test"],
    filesChanged: ["path/to/file"],
    blockers: [],
    nextSteps: copy.nextSteps,
  };
}

function tokenBootstrapScript({ onlyIfMissing = false } = {}) {
  const guard = `if ([string]::IsNullOrWhiteSpace($env:MANAGE_AUTH_TOKEN)) {
  throw "MANAGE_AUTH_TOKEN is not set. Set it to your Agent Backlog bearer token first, e.g. \\$env:MANAGE_AUTH_TOKEN = '<token>' (PowerShell) or export MANAGE_AUTH_TOKEN='<token>' (bash)."
}`;

  if (onlyIfMissing) {
    return guard;
  }

  return `# Set your Agent Backlog agent token (bearer) for this shell.
# PowerShell:
$env:MANAGE_AUTH_TOKEN = "<token>"
# bash/zsh:
#   export MANAGE_AUTH_TOKEN="<token>"`;
}

export function buildAgentClaimCommand({
  baseUrl = "http://127.0.0.1:5186",
  workItem = {},
  agent = "Codex",
  tokenHint = "$MANAGE_AUTH_TOKEN",
  leaseMinutes = 90,
} = {}) {
  return `Claim this Agent Backlog packet before editing code.

Endpoint: POST ${endpoint(baseUrl, `/api/agent/tasks/${workItemKey(workItem)}/claim`)}
Headers:
Authorization: Bearer ${tokenHint}
Content-Type: application/json

Body:
${jsonBlock({
  agent,
  leaseMinutes,
})}`;
}

export function buildAgentTokenBootstrapCommand() {
  return tokenBootstrapScript({});
}

export function buildAgentClaimPowerShellCommand({
  baseUrl = "http://127.0.0.1:5186",
  workItem = {},
  agent = "Codex",
  leaseMinutes = 90,
  secretName = "MANAGE_AUTH_TOKEN",
} = {}) {
  return `# Claim ${workItem.key || "{key}"} before editing code.
${tokenBootstrapScript({ onlyIfMissing: true })}
$headers = @{ Authorization = "Bearer $env:MANAGE_AUTH_TOKEN" }
$body = @{
  agent = ${powerShellString(agent)}
  leaseMinutes = ${Number(leaseMinutes) || 90}
} | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri ${powerShellString(endpoint(baseUrl, `/api/agent/tasks/${workItemKey(workItem)}/claim`))} -Headers $headers -ContentType "application/json" -Body $body`;
}

export function buildAgentStatusCommand({
  baseUrl = "http://127.0.0.1:5186",
  workItem = {},
  agent = "Codex",
  tokenHint = "$MANAGE_AUTH_TOKEN",
  status = "in_progress",
} = {}) {
  const body = agentStatusPayload(workItem, agent, status);

  return `Write back ${status} for Agent Backlog packet ${workItem.key || "{key}"}.

Endpoint: POST ${endpoint(baseUrl, `/api/agent/tasks/${workItemKey(workItem)}/status`)}
Headers:
Authorization: Bearer ${tokenHint}
Content-Type: application/json

Body:
${jsonBlock(body)}`;
}

export function buildAgentStatusPowerShellCommand({
  baseUrl = "http://127.0.0.1:5186",
  workItem = {},
  agent = "Codex",
  status = "in_progress",
  secretName = "MANAGE_AUTH_TOKEN",
} = {}) {
  const body = agentStatusPayload(workItem, agent, status);

  return `# Write back ${status} for ${workItem.key || "{key}"}.
${tokenBootstrapScript({ onlyIfMissing: true })}
$headers = @{ Authorization = "Bearer $env:MANAGE_AUTH_TOKEN" }
$body = @{
  status = ${powerShellString(body.status)}
  agent = ${powerShellString(body.agent)}
  agentRunId = ${powerShellString(body.agentRunId)}
  note = ${powerShellString(body.note)}
  githubBranch = ${powerShellString(body.githubBranch)}
  githubPrUrl = ${powerShellString(body.githubPrUrl)}
  testsRun = ${powerShellArray(body.testsRun)}
  filesChanged = ${powerShellArray(body.filesChanged)}
  blockers = ${powerShellArray(body.blockers)}
  nextSteps = ${powerShellArray(body.nextSteps)}
} | ConvertTo-Json -Depth 4
Invoke-RestMethod -Method Post -Uri ${powerShellString(endpoint(baseUrl, `/api/agent/tasks/${workItemKey(workItem)}/status`))} -Headers $headers -ContentType "application/json" -Body $body`;
}

export function buildAgentPrReadyPowerShellCommand({
  workItem = {},
  repository = {},
} = {}) {
  const slug = repoSlug(workItem, repository);

  return `# Mark the current branch PR ready and inspect checks.
$repo = ${powerShellString(slug)}
$branch = (git branch --show-current).Trim()
if ([string]::IsNullOrWhiteSpace($branch)) { throw "No current git branch found" }
$pr = gh pr view $branch --repo $repo --json number,url,isDraft,state | ConvertFrom-Json
if ($pr.isDraft) {
  gh pr ready $pr.number --repo $repo
  $pr = gh pr view $pr.number --repo $repo --json number,url,isDraft,state | ConvertFrom-Json
}
Write-Host "PR #$($pr.number): $($pr.url)"
Write-Host "Draft: $($pr.isDraft)"
gh pr checks $pr.number --repo $repo`;
}

export function buildAgentReviewPollPowerShellCommand({
  workItem = {},
  repository = {},
  timeoutMinutes = 20,
} = {}) {
  const slug = repoSlug(workItem, repository);
  const minutes = Number(timeoutMinutes) || 20;

  return `# Poll PR checks after marking ready for review.
# Record CodeRabbit exactly as GitHub reports it: pass, fail, pending, skipped, or review in progress.
$repo = ${powerShellString(slug)}
$branch = (git branch --show-current).Trim()
$pr = gh pr view $branch --repo $repo --json number,url,state,isDraft | ConvertFrom-Json
$deadline = (Get-Date).AddMinutes(${minutes})
do {
  $checks = gh pr checks $pr.number --repo $repo 2>&1
  $checks
  $text = $checks -join "\`n"
  if ($text -match "CodeRabbit\\s+(pass|fail|skipping|cancelled)") { break }
  if ($text -notmatch "CodeRabbit\\s+pending") { break }
  Start-Sleep -Seconds 15
} while ((Get-Date) -lt $deadline)
Write-Host "Final PR state:"
gh pr view $pr.number --repo $repo --json number,url,state,isDraft,mergedAt,mergeCommit`;
}

export function buildAgentPostMergeCloseoutPowerShellCommand({
  baseUrl = "http://127.0.0.1:5186",
  workItem = {},
  repository = {},
  agent = "Codex",
  secretName = "MANAGE_AUTH_TOKEN",
} = {}) {
  const slug = repoSlug(workItem, repository);
  const key = workItemKey(workItem);
  const prUrl = String(workItem.githubPrUrl || "").trim();
  const agentRunId = String(workItem.agentRunId || "returned-agent-run-id").trim();

  return `# Post-merge closeout for ${workItem.key || "{key}"}.
# Verifies the PR is merged, gathers merge/check/file details, then writes status=done to Manage.
${tokenBootstrapScript({ onlyIfMissing: true })}
$repo = ${powerShellString(slug)}
$taskKey = ${powerShellString(key)}
$agentRunId = ${powerShellString(agentRunId)}
$prRef = ${powerShellString(prUrl)}
if ([string]::IsNullOrWhiteSpace($prRef)) {
  $branch = (git branch --show-current).Trim()
  if ([string]::IsNullOrWhiteSpace($branch)) { throw "No PR URL or current git branch found" }
  $prRef = $branch
}

$pr = gh pr view $prRef --repo $repo --json number,url,state,mergedAt,mergeCommit,headRefName,baseRefName,headRefOid,isDraft | ConvertFrom-Json
if ($pr.state -ne "MERGED") {
  throw "PR #$($pr.number) is $($pr.state), not MERGED. Do not write done yet."
}

$mergeCommit = if ($pr.mergeCommit -and $pr.mergeCommit.oid) { $pr.mergeCommit.oid } else { "unknown" }
$checkLines = @()
try {
  $checkLines = @(gh pr checks $pr.number --repo $repo 2>&1 | Where-Object { $_ })
} catch {
  $checkLines = @("gh pr checks failed: $($_.Exception.Message)")
}
$fileLines = @()
try {
  $fileLines = @(gh pr diff $pr.number --repo $repo --name-only | Where-Object { $_ })
} catch {
  $fileLines = @("gh pr diff failed: $($_.Exception.Message)")
}
if ($fileLines.Count -eq 0) { $fileLines = @("No changed files reported by gh pr diff") }

$checkSummary = if ($checkLines.Count) { $checkLines -join "; " } else { "No PR checks reported" }
$testsRun = @(
  "GitHub PR #$($pr.number) merged at $($pr.mergedAt)",
  "Merge commit $mergeCommit"
) + $checkLines

$headers = @{ Authorization = "Bearer $env:MANAGE_AUTH_TOKEN" }
$body = @{
  status = "done"
  agent = ${powerShellString(agent)}
  agentRunId = $agentRunId
  note = "Merged PR #$($pr.number). Merge commit $mergeCommit. Final checks: $checkSummary"
  githubBranch = $pr.headRefName
  githubPrUrl = $pr.url
  testsRun = $testsRun
  filesChanged = $fileLines
  blockers = @()
  nextSteps = @("Pull $($pr.baseRefName) before starting the next packet.")
} | ConvertTo-Json -Depth 6

Write-Host "Done payload for $taskKey:"
Write-Host $body
Invoke-RestMethod -Method Post -Uri ${powerShellString(endpoint(baseUrl, `/api/agent/tasks/${key}/status`))} -Headers $headers -ContentType "application/json" -Body $body`;
}

export function buildAgentVisualQaFallbackCommand() {
  return `# Visual QA fallback when the in-app browser cannot start.
# Use this only after the Browser plugin/in-app browser path fails.
npm.cmd exec playwright -- --version
# Start the app's normal dev or mock server in a hidden process, then run focused Playwright checks/screenshots.
# Record the fallback in testsRun, including viewport coverage and any console/runtime errors.`;
}

export function buildAgentRepoHandoffCommand({
  workItem = {},
  repository = {},
} = {}) {
  const branch = suggestedBranch(workItem);
  const slug = repoSlug(workItem, repository);
  const checkoutName = repository.name || workItem.repo || "repo";

  return `# Prepare the repository for ${workItem.key || "{key}"}.
# Repo: https://github.com/${slug}
# Suggested branch: ${branch}
# Use the current repo when already inside it; otherwise clone or enter the repo folder.
if (-not (Test-Path ".git")) {
  if (-not (Test-Path ${powerShellString(`.\\${checkoutName}\\.git`)})) { gh repo clone ${slug} }
  Set-Location ${powerShellString(`.\\${checkoutName}`)}
}

git fetch origin
$baseBranch = "origin/main"
if (-not (git rev-parse --verify --quiet $baseBranch)) { $baseBranch = "origin/master" }
git checkout -B ${powerShellString(branch)} $baseBranch`;
}

export function buildAgentRunbook({
  baseUrl = "http://127.0.0.1:5186",
  workItem = {},
  repository = {},
  agent = "Codex",
  secretName = "MANAGE_AUTH_TOKEN",
} = {}) {
  const key = workItem.key || "{key}";
  const tests = lineItems(workItem.testCommands);

  return `# ${key} Agent Runbook

Source of truth: ${endpoint(baseUrl, `/agent/${workItemKey(workItem)}.md`)}
JSON packet: ${endpoint(baseUrl, `/api/agent/tasks/${workItemKey(workItem)}`)}
Repo: ${repoUrl(workItem, repository)}
Agent: ${agent}
Token: set ${secretName} to your bearer token (Authorization: Bearer ...).

## Flow
1. Set ${secretName} in your shell to your Agent Backlog bearer token.
2. Claim ${key} before editing code.
3. Prepare ${repository.name || workItem.repo || "the target repo"} on branch ${suggestedBranch(workItem)}.
4. Run packet verification${tests.length > 0 ? `: ${tests.join(", ")}` : " when available"}.
5. Run visual QA. If the in-app browser fails on Windows, use the Playwright fallback and record that in testsRun.
6. Open a draft PR and write back needs_review with branch, PR, checks, and reviewer notes.
7. Mark the PR ready when review should start, then poll GitHub checks and record CodeRabbit exactly as reported.
8. After merge, run the post-merge closeout command to verify the PR and write back done with merge/check details.

## Token Bootstrap
\`\`\`powershell
${tokenBootstrapScript({})}
\`\`\`

## Claim
\`\`\`powershell
${buildAgentClaimPowerShellCommand({ baseUrl, workItem, agent, secretName })}
\`\`\`

## Repo Handoff
\`\`\`powershell
${buildAgentRepoHandoffCommand({ workItem, repository })}
\`\`\`

## Needs Review Writeback
\`\`\`powershell
${buildAgentStatusPowerShellCommand({ baseUrl, workItem, agent, status: "needs_review", secretName })}
\`\`\`

## Mark PR Ready And Check Review
\`\`\`powershell
${buildAgentPrReadyPowerShellCommand({ workItem, repository })}
\`\`\`

## Poll Checks
\`\`\`powershell
${buildAgentReviewPollPowerShellCommand({ workItem, repository })}
\`\`\`

## Visual QA Fallback
\`\`\`powershell
${buildAgentVisualQaFallbackCommand()}
\`\`\`

## Post-Merge Closeout
\`\`\`powershell
${buildAgentPostMergeCloseoutPowerShellCommand({ baseUrl, workItem, repository, agent, secretName })}
\`\`\`

## Done Writeback
\`\`\`powershell
${buildAgentStatusPowerShellCommand({ baseUrl, workItem, agent, status: "done", secretName })}
\`\`\``;
}

export function buildAgentInstructions({ baseUrl = "http://127.0.0.1:5186", tokenHint = "$MANAGE_AUTH_TOKEN" } = {}) {
  return `# Agent Backlog — Agent Instructions

Agent Backlog is the source of truth for work packets. Use it before starting implementation work.

Base URL: ${baseUrl}
Authorization: Bearer ${tokenHint}
Token: set MANAGE_AUTH_TOKEN to your bearer token and send it as Authorization: Bearer <token>.

## Pickup Flow
- Read these instructions: GET ${endpoint(baseUrl, "/agent/instructions.md")}
- Inspect available repos and endpoints: GET ${endpoint(baseUrl, "/api/agent/bootstrap")}
- If the session is inside the agent-backlog repo, prefer the lifecycle CLI: \`npm run manage:agent -- claim-next --repo web-app\`.
- Claim one ready packet before editing code: POST ${endpoint(baseUrl, "/api/agent/next/claim")}
- Optional filters are repo and label, for example GET ${endpoint(baseUrl, "/api/agent/next?repo=web-app&label=bug")}
- For a specific packet, read GET ${endpoint(baseUrl, "/agent/TASK-101.md")} or GET ${endpoint(baseUrl, "/api/agent/tasks/TASK-101")}
- Use the returned prompt as the working brief.
- Keep the returned agentRunId and include it in status updates.
- If claim returns 409, another active lease exists. Do not work that packet unless the operator asks you to force-claim it.

## Claim Next Packet
\`\`\`json
{
  "repo": "web-app",
  "agent": "Codex",
  "leaseMinutes": 90
}
\`\`\`

## Write Back Status
\`\`\`json
{
  "status": "needs_review",
  "agent": "Codex",
  "agentRunId": "returned-agent-run-id",
  "note": "What changed, what was tested, and anything the reviewer should know.",
  "githubBranch": "codex/task-###-short-name",
  "githubPrUrl": "https://github.com/your-org/repo/pull/123",
  "testsRun": ["npm.cmd test", "npm.cmd run build"],
  "filesChanged": ["repo/path/file.js"],
  "blockers": [],
  "nextSteps": ["Reviewer should inspect the linked PR."]
}
\`\`\`

## Agent Rules
- Work only from claimed packets unless the operator gives a direct override.
- Keep branch and PR names tied to the task key.
- Run listed verification commands when possible.
- If in-app browser verification fails to start, run focused Playwright visual QA and record the fallback in testsRun.
- Update status to needs_review after opening the PR and listing checks.
- Mark the PR ready when review should start, then poll GitHub checks until CodeRabbit is pass/fail/skipped or clearly still pending.
- After merge, run the post-merge closeout command so Manage gets the PR URL, branch, merge commit, final check state, and changed files without hand-filling.
- Update status to blocked when external input is required.
`;
}

export function buildAgentLifecycleCliCommand({ repo = "web-app", agent = "Codex", leaseMinutes = 90 } = {}) {
  return `Use this from the agent-backlog repo after dependencies are installed.

Claim next:
\`\`\`bash
npm run manage:agent -- claim-next --repo ${repo} --agent "${agent}" --lease-minutes ${leaseMinutes}
\`\`\`

Status flow:
\`\`\`bash
npm run manage:agent -- progress TASK-### --note "Implementation started"
npm run manage:agent -- validate --cmd "npm.cmd test" --cmd "npm.cmd run build"
npm run manage:agent -- review TASK-### --branch codex/task-###-short-name --pr https://github.com/your-org/repo/pull/123 --test "npm.cmd test - passed" --file path/to/file
npm run manage:agent -- closeout TASK-### --repo your-org/repo --pr 123
\`\`\`

Recover a stuck claim:
\`\`\`bash
npm run manage:agent -- extend TASK-### --lease-minutes 60
npm run manage:agent -- reclaim TASK-###
npm run manage:agent -- release TASK-###
\`\`\``;
}

export function buildAgentPickupCommand({
  baseUrl = "http://127.0.0.1:5186",
  repo = "web-app",
  agent = "Codex",
  tokenHint = "$MANAGE_AUTH_TOKEN",
  leaseMinutes = 90,
} = {}) {
  return `Use Agent Backlog to pick up your next work packet.

Base URL: ${baseUrl}
Auth header: Authorization: Bearer ${tokenHint}

1. Read ${endpoint(baseUrl, "/agent/instructions.md")}.
2. If you are inside the agent-backlog repo, prefer \`npm run manage:agent -- claim-next --repo ${repo} --agent "${agent}" --lease-minutes ${leaseMinutes}\`.
3. Otherwise, claim the next ready packet by POSTing to ${endpoint(baseUrl, "/api/agent/next/claim")} with:
{"repo":"${repo}","agent":"${agent}","leaseMinutes":${leaseMinutes}}
4. Treat the returned prompt as the source of truth.
5. Echo the returned agentRunId in every status writeback.
6. When ready for review, use \`npm run manage:agent -- review\` or POST /api/agent/tasks/{key}/status with status needs_review, a concise note, githubBranch, githubPrUrl, testsRun, filesChanged, blockers, and nextSteps if available.
7. Mark the PR ready when review should start, poll checks, and record CodeRabbit exactly as GitHub reports it.
8. After merge, run \`npm run manage:agent -- closeout\` or post-merge closeout to verify the merged PR and POST status done with merge/check/file details.`;
}

export function buildAgentBootstrap({
  baseUrl = "http://127.0.0.1:5186",
  repositories = [],
  statusOptions = [],
  labelOptions = [],
  tokenHint = "$MANAGE_AUTH_TOKEN",
} = {}) {
  const endpoints = {
    instructions: endpoint(baseUrl, "/agent/instructions.md"),
    next: endpoint(baseUrl, "/api/agent/next?repo={repo}"),
    nextByLabel: endpoint(baseUrl, "/api/agent/next?label={label}"),
    nextClaim: endpoint(baseUrl, "/api/agent/next/claim"),
    taskJson: endpoint(baseUrl, "/api/agent/tasks/{key}"),
    taskMarkdown: endpoint(baseUrl, "/agent/{key}.md"),
    claim: endpoint(baseUrl, "/api/agent/tasks/{key}/claim"),
    status: endpoint(baseUrl, "/api/agent/tasks/{key}/status"),
    recovery: endpoint(baseUrl, "/api/agent/tasks/{key}/recovery"),
  };

  return {
    name: "Agent Backlog",
    baseUrl,
    auth: {
      type: "bearer",
      header: "Authorization",
      tokenHint,
    },
    agents: ["Codex", "Claude Code"],
    lease: {
      defaultMinutes: 90,
      conflictStatus: 409,
    },
    endpoints,
    repositories: repositories.map((repo) => ({
      id: repo.id,
      name: repo.name,
      owner: repo.owner,
      domain: repo.domain,
      description: repo.description,
    })),
    statuses: statusOptions.map((status) => ({
      id: status.id,
      label: status.label,
    })),
    labels: labelOptions.map((label) => ({
      id: label.id,
      label: label.label,
    })),
    commandTemplates: {
      tokenBootstrap: buildAgentTokenBootstrapCommand(),
      lifecycleCli: buildAgentLifecycleCliCommand({ repo: repositories[0]?.id || "web-app", agent: "Codex" }),
      visualQaFallback: buildAgentVisualQaFallbackCommand(),
      prReadyAndChecks: buildAgentPrReadyPowerShellCommand({ repository: repositories[0] }),
      pollReviewChecks: buildAgentReviewPollPowerShellCommand({ repository: repositories[0] }),
      postMergeCloseout: buildAgentPostMergeCloseoutPowerShellCommand({ repository: repositories[0] }),
      doneWriteback: buildAgentStatusPowerShellCommand({ status: "done" }),
      codex: buildAgentPickupCommand({ baseUrl, repo: repositories[0]?.id || "web-app", agent: "Codex", tokenHint }),
      claudeCode: buildAgentPickupCommand({
        baseUrl,
        repo: repositories[0]?.id || "web-app",
        agent: "Claude Code",
        tokenHint,
      }),
    },
  };
}

export function buildAgentPrompt(workItem) {
  return `# ${workItem.key}: ${workItem.title}

You are working on work packet ${workItem.key}.

Repo: ${field(workItem.repo)}
Suggested branch: ${field(workItem.suggestedBranch)}
Status: ${field(workItem.status)}
Priority: ${field(workItem.priority)}
Project: ${field(workItem.project)}
Labels: ${labelLine(workItem)}
Preferred agent: ${field(workItem.agent, "Any coding agent")}
Claimed by: ${field(workItem.claimedBy, "Not claimed")}
Agent run ID: ${field(workItem.agentRunId)}
Lease expires: ${field(workItem.leaseExpiresAt)}

## Problem
${field(workItem.summary)}

## Desired Outcome
${field(workItem.desiredOutcome)}

## Acceptance Criteria
${listBlock(workItem.acceptanceCriteria)}

## Relevant Files
${listBlock(workItem.relevantFiles)}

## Relevant URLs
${listBlock(workItem.relevantUrls)}

## Implementation Notes
${listBlock(workItem.implementationNotes)}

## Test Commands
${listBlock(workItem.testCommands)}

## Deploy Notes
${field(workItem.deployNotes)}

## Blockers
${field(workItem.blockedBy, "None recorded")}

## Latest Agent Update
${workItem.lastAgentUpdate?.note ? `${field(workItem.lastAgentUpdate.agent)} set status to ${field(workItem.lastAgentUpdate.status)}: ${workItem.lastAgentUpdate.note}` : "None recorded"}

## Agent Event Log
${compactEventLog(workItem.agentEvents)}

## GitHub Handoff
- Branch: ${field(workItem.githubBranch)}
- PR: ${field(workItem.githubPrUrl)}
- Issue: ${field(workItem.githubIssueUrl)}

## Matched GitHub Activity
${compactGithubLinks(workItem.githubLinks)}

## Manage Writeback
- Claim next ready packet: POST /api/agent/next/claim with {"repo":"${field(workItem.repo)}","agent":"Codex","leaseMinutes":90}
- Claim this packet: POST /api/agent/tasks/${workItem.key}/claim with {"agent":"Codex","leaseMinutes":90}
- Update status: POST /api/agent/tasks/${workItem.key}/status with {"status":"needs_review","agent":"Codex","agentRunId":"${field(workItem.agentRunId, "optional-run-id")}","note":"summary","githubBranch":"branch-name","githubPrUrl":"https://...","testsRun":["npm.cmd test"],"filesChanged":["path/to/file"],"blockers":[],"nextSteps":["review PR"]}
- Review gate: mark the PR ready when review should start, poll GitHub checks, and record CodeRabbit exactly as GitHub reports it.
- Done update: after merge, verify the merged PR and POST status done with the merge commit.
- If claim returns 409, another active agent lease exists. Pick a different packet or wait until the lease expires.

When complete:
- Run the listed verification commands when possible.
- Link the resulting branch or PR back to ${workItem.key}.
- Update status to needs_review with any notes that matter for the reviewer.
- After merge, update status to done with final checks and merge commit.
`;
}

export function readinessScore(workItem) {
  const checks = [
    Boolean(workItem.title),
    Boolean(workItem.repo),
    Boolean(workItem.summary),
    Boolean(workItem.desiredOutcome),
    Array.isArray(workItem.acceptanceCriteria) && workItem.acceptanceCriteria.length > 0,
    Array.isArray(workItem.relevantFiles) && workItem.relevantFiles.length > 0,
    Array.isArray(workItem.testCommands) && workItem.testCommands.length > 0,
    Boolean(workItem.suggestedBranch),
  ];

  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function findNextWorkItem(items, { repo, label } = {}) {
  return findNextMatchingWorkItem(items, { repo, label });
}

export function findNextMatchingWorkItem(items, { repo, label } = {}) {
  const normalizedLabel = normalizeLabel(label);

  return [...items]
    .filter((item) => item.status === "ready_for_agent" || isExpiredLease(item))
    .filter((item) => (repo ? item.repo === repo : true))
    .filter((item) => (normalizedLabel ? itemLabels(item).includes(normalizedLabel) : true))
    .sort((a, b) => {
      const priorityDelta = (priorityRank[a.priority] || 99) - (priorityRank[b.priority] || 99);

      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return readinessScore(b) - readinessScore(a);
    })[0];
}

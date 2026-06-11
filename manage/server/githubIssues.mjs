import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    "User-Agent": "agent-backlog",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function rootUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/$/, "");
}

function listBlock(items) {
  const lines = Array.isArray(items) ? items : String(items || "").split("\n");
  const cleaned = lines.map((line) => String(line || "").trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned.map((line) => `- ${line}`).join("\n") : "- Not recorded";
}

function labelLine(labels) {
  const cleaned = (Array.isArray(labels) ? labels : []).map((label) => `#${label}`);
  return cleaned.length > 0 ? cleaned.join(", ") : "None recorded";
}

function buildIssueTitle(workItem) {
  const key = String(workItem.key || "").trim();
  const title = String(workItem.title || "Untitled work packet").trim();
  return title.startsWith(`${key}:`) ? title : `${key}: ${title}`;
}

export function buildGithubIssueBody(workItem, { baseUrl = "" } = {}) {
  const taskUrl = `${rootUrl(baseUrl)}/agent/${encodeURIComponent(workItem.key)}.md`;
  const jsonUrl = `${rootUrl(baseUrl)}/api/agent/tasks/${encodeURIComponent(workItem.key)}`;

  return `Created from Agent Backlog work packet ${workItem.key}.

Manage task: ${taskUrl}
Task JSON: ${jsonUrl}

## Summary
${workItem.summary || "Not recorded"}

## Desired Outcome
${workItem.desiredOutcome || "Not recorded"}

## Labels
${labelLine(workItem.labels)}

## Acceptance Criteria
${listBlock(workItem.acceptanceCriteria)}

## Relevant Files
${listBlock(workItem.relevantFiles)}

## Test Commands
${listBlock(workItem.testCommands)}

## Agent Handoff
- Preferred agent: ${workItem.agent || "Any coding agent"}
- Suggested branch: ${workItem.suggestedBranch || "Not recorded"}
- Status in Manage: ${workItem.status || "Not recorded"}
`;
}

async function postIssueWithToken(repo, payload) {
  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/issues`, {
    method: "POST",
    headers: githubHeaders(),
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw Object.assign(new Error(body.message || `GitHub issue creation failed: ${response.status}`), {
      statusCode: response.status,
    });
  }

  return body;
}

async function postIssueWithCli(repo, payload) {
  const { stdout } = await execFileAsync(
    "gh",
    ["api", `/repos/${repo.owner}/${repo.name}/issues`, "--method", "POST", "-f", `title=${payload.title}`, "-f", `body=${payload.body}`],
    {
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    },
  );
  return JSON.parse(stdout);
}

export async function createGithubIssueForWorkItem(workItem, repo, { baseUrl = "", mock = false } = {}) {
  const title = buildIssueTitle(workItem);
  const body = buildGithubIssueBody(workItem, { baseUrl });

  if (mock) {
    const numericKey = Number(String(workItem.key || "").replace(/\D/g, "")) || 0;
    const number = 9000 + numericKey;

    return {
      number,
      title,
      url: `https://github.com/${repo.owner}/${repo.name}/issues/${number}`,
      source: "mock",
    };
  }

  const issue = process.env.GITHUB_TOKEN
    ? await postIssueWithToken(repo, { title, body })
    : await postIssueWithCli(repo, { title, body });

  return {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    source: process.env.GITHUB_TOKEN ? "github-token" : "gh-cli",
  };
}

import { expect, request as playwrightRequest, test } from "@playwright/test";

const manageAuthToken = process.env.MANAGE_PLAYWRIGHT_AUTH_TOKEN || "manage-playwright-local-agent-token";
const manageOperatorToken = process.env.MANAGE_PLAYWRIGHT_OPERATOR_TOKEN || "manage-playwright-local-operator-token";

test.beforeEach(async ({ page, request }) => {
  await Promise.all([
    page.request.post("/api/auth/login", { data: { token: manageOperatorToken } }),
    request.post("/api/auth/login", { data: { token: manageOperatorToken } }),
  ]);
  const reset = await page.request.post("/api/agent/reset", {
    headers: { "x-csrf-protection": "1" },
    data: { confirmation: "RESET MANAGE" },
  });
  expect(reset.ok(), "setup reset").toBe(true);
});

test.afterEach(async ({ page }) => {
  const reset = await page.request.post("/api/agent/reset", {
    headers: { "x-csrf-protection": "1" },
    data: { confirmation: "RESET MANAGE" },
  });
  expect(reset.ok(), "teardown reset").toBe(true);
});

test("renders backlog and agent prompt", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "AI-ready backlog" })).toBeVisible();
  const firstWorkRow = page.locator(".work-list").getByRole("button", { name: /TASK-101/ });
  await expect(firstWorkRow).toBeVisible();
  await expect(firstWorkRow).toContainText("Urgent");
  await expect(firstWorkRow).toContainText("web-app");
  await expect(firstWorkRow.locator(".readiness")).toContainText("%");
  await expect(page.locator(".field-card")).toHaveCount(3);
  await expect(page.getByText("Agent prompt")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy Codex command" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy Claude command" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy task URL" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create issue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy claim command" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy progress update" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy review update" })).toBeVisible();
  await expect(page.getByLabel("Agent runbook")).toContainText("MANAGE_AUTH_TOKEN");
  await expect(page.getByLabel("Agent runbook")).toContainText("CodeRabbit");
  await expect(page.getByLabel("Agent runbook")).toContainText("write back done");
  await expect(page.getByLabel("Agent runbook")).toContainText("post-merge closeout");
  await expect(page.getByLabel("Agent runbook")).toContainText("Invoke-RestMethod");
  await expect(page.getByRole("button", { name: "Token bootstrap" })).toBeVisible();
  await expect(page.getByRole("button", { name: "PS claim" })).toBeVisible();
  await expect(page.getByRole("button", { name: "PS progress" })).toBeVisible();
  await expect(page.getByRole("button", { name: "PS review" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Repo handoff" })).toBeVisible();
  await expect(page.getByRole("button", { name: "PR ready/checks" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Poll review" })).toBeVisible();
  await expect(page.getByRole("button", { name: "QA fallback" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Post-merge closeout" })).toBeVisible();
  await expect(page.getByRole("button", { name: "PS done" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy full runbook" })).toBeVisible();
  await expect(page.getByLabel("Selected task URL")).toContainText("http://127.0.0.1:5186/agent/TASK-101.md");
  await expect(page.locator(".work-list")).toContainText("#data-quality");
  await expect(page.getByLabel("System status")).toContainText("File store");
  await expect(page.getByLabel("System status")).toContainText("Break-glass on");
  await expect(page.locator(".endpoint-list").getByText("Task URL", { exact: true })).toBeVisible();
  await expect(page.locator(".endpoint-list").getByText("/agent/instructions.md", { exact: true })).toBeVisible();
  await expect(page.locator(".endpoint-list").getByText("/api/agent/bootstrap", { exact: true })).toBeVisible();
  await expect(page.locator(".endpoint-list").getByText("/api/agent/tasks/TASK-101", { exact: true })).toBeVisible();
});

test("persists shell theme and density controls for the session", async ({ page }) => {
  await page.goto("/");

  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-manage-theme", "light");
  await expect(root).toHaveAttribute("data-manage-density", "regular");

  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.getByLabel("Density").selectOption("compact");

  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(root).toHaveAttribute("data-manage-theme", "dark");
  await expect(root).toHaveAttribute("data-density", "compact");
  await expect(root).toHaveAttribute("data-manage-density", "compact");

  await page.reload();

  await expect(root).toHaveAttribute("data-manage-theme", "dark");
  await expect(root).toHaveAttribute("data-manage-density", "compact");
  await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
});

test("Today dashboard claims the next packet and shows activity", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today" }).click();

  await expect(page.getByLabel("Today attention inbox")).toBeVisible();
  await expect(page.getByLabel("Today overview")).toContainText("TASK-101");
  await expect(page.getByRole("button", { name: "Claim for agent" })).toBeVisible();
  await expect(page.getByLabel("Recent agent activity")).toContainText("No agent events yet");
  await expect(page.getByLabel("Mini repo health")).toContainText("web-app");
  await expect(page.getByLabel("Mini repo health")).toContainText("failed");

  await page.getByRole("button", { name: "Claim for agent" }).click();

  await expect(page.getByLabel("Recent agent activity")).toContainText("TASK-101");
  await expect(page.getByLabel("Recent agent activity")).toContainText("Claimed");

  const payload = await (await request.get("/api/work-items")).json();
  const claimed = payload.workItems.find((item) => item.key === "TASK-101");
  expect(claimed.status).toBe("claimed");
  expect(claimed.agentEvents.at(-1)).toMatchObject({ type: "claimed", agent: "Codex" });
});

test("Today attention inbox groups exceptions, deep-links, and has no CSC leakage", async ({ page, request }) => {
  const failedClaim = await request.post("/api/agent/tasks/TASK-101/claim", {
    data: { agent: "Codex", leaseMinutes: 45 },
  });
  const failedClaimPayload = await failedClaim.json();
  await request.post("/api/agent/tasks/TASK-101/status", {
    data: {
      status: "blocked",
      agent: "Codex",
      agentRunId: failedClaimPayload.workItem.agentRunId,
      note: "The agent run failed during verification.",
      blockers: ["Manage checks failed"],
    },
  });

  await request.patch("/api/work-items/TASK-102", {
    data: {
      status: "in_progress",
      agent: "Claude Code",
      claimedBy: "",
      claimedAt: "",
      agentRunId: "",
      leaseExpiresAt: "",
    },
  });

  await request.patch("/api/work-items/TASK-103", {
    data: {
      status: "in_progress",
      agent: "Codex",
      claimedBy: "Codex",
      claimedAt: new Date(Date.now() - 61 * 60_000).toISOString(),
      agentRunId: "TASK-103-today-stale",
      leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      githubBranch: "codex/task-103-today-stale",
    },
  });

  await request.patch("/api/work-items/TASK-104", {
    data: { status: "needs_review", agent: "Codex", claimedBy: "Codex" },
  });
  await request.post("/api/github/sync", { data: { mock: true } });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today" }).click();

  const inbox = page.getByLabel("Today attention inbox");
  await expect(inbox.getByRole("heading", { name: "Attention inbox" })).toBeVisible();
  const attentionCards = inbox.locator(".attention-item");
  await expect(attentionCards.first()).toContainText("Failed run");
  await expect(attentionCards.first()).toContainText("TASK-101");
  await expect(inbox).toContainText("Stale run");
  await expect(inbox).toContainText("Review handoff is incomplete");
  await expect(inbox).toContainText("Merged PR is not linked");
  await expect(inbox.getByText(/old$/).first()).toBeVisible();
  await expect(inbox).not.toContainText("Commerce Street");
  await expect(inbox).not.toContainText("CSC-");
  await expect(inbox).not.toContainText("Harbor");
  await expect(inbox).not.toContainText("RegVault");

  await inbox.getByRole("button", { name: /Agent/ }).click();
  await expect(inbox.locator(".attention-item")).toHaveCount(3);
  const staleCard = inbox.locator(".attention-item").filter({ hasText: "TASK-103" });
  await staleCard.getByRole("button", { name: "TASK-103" }).click();
  await expect(page.getByRole("heading", { name: "Agent activity" })).toBeVisible();
  await expect(page.getByLabel("Agent activity")).toContainText("TASK-103");

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today" }).click();
  await inbox.getByRole("button", { name: /Agent/ }).click();
  await staleCard.getByRole("button", { name: "Reclaim" }).click();
  await expect(staleCard).toHaveCount(0);
  await expect(inbox).toContainText("Reclaimed TASK-103");

  await inbox.getByRole("button", { name: /GitHub/ }).click();
  const githubCard = inbox.locator(".attention-item").filter({ hasText: "#101" });
  await expect(githubCard).toBeVisible();
  await githubCard.getByRole("button", { name: "Link TASK-101" }).click();
  await expect(inbox).toContainText("Linked TASK-101 to web-app #101");

  await inbox.getByRole("button", { name: /Handoff/ }).click();
  const handoffCard = inbox.locator(".attention-item").filter({ hasText: "TASK-104" });
  await handoffCard.getByRole("button", { name: "Complete handoff" }).click();
  await expect(page.getByRole("heading", { name: "Review queue", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Review queue")).toContainText("TASK-104");
});

test("Today attention inbox empty state stays generic", async ({ page, request }) => {
  await request.patch("/api/work-items/TASK-103", {
    data: {
      status: "ready_for_agent",
      agent: "",
      claimedBy: "",
      claimedAt: "",
      agentRunId: "",
      leaseExpiresAt: "",
      githubBranch: "",
    },
  });
  await request.patch("/api/work-items/TASK-106", { data: { status: "draft" } });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today" }).click();

  const inbox = page.getByLabel("Today attention inbox");
  await inbox.getByRole("button", { name: /Agent/ }).click();
  await expect(inbox).toContainText("No agent exceptions");
  await inbox.getByRole("button", { name: /Review/ }).click();
  await expect(inbox).toContainText("No review exceptions");
  await inbox.getByRole("button", { name: /Handoff/ }).click();
  await expect(inbox).toContainText("No handoff exceptions");
  await inbox.getByRole("button", { name: /All/ }).click();
  const leftoverGithub = await inbox.locator(".attention-item").count();
  if (leftoverGithub === 0) {
    await expect(inbox).toContainText("The attention queue is clear");
    await expect(inbox).toContainText("No packets need operator intervention right now.");
  }
  await expect(inbox).not.toContainText("Commerce Street");
  await expect(inbox).not.toContainText("CSC-");
});

test("Today attention inbox exposes a loading state", async ({ page }) => {
  let releaseWorkItems;
  const waitForRelease = new Promise((resolve) => {
    releaseWorkItems = resolve;
  });

  await page.route("**/api/work-items", async (route) => {
    await waitForRelease;
    await route.continue();
  });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today" }).click();
  await expect(page.getByLabel("Loading attention inbox")).toBeVisible();
  releaseWorkItems();
  await expect(page.getByLabel("Loading attention inbox")).toHaveCount(0);
});

test("Today keeps action failures separate from reconciliation sync health", async ({ page, request }) => {
  await request.post("/api/github/sync", { data: { mock: true } });
  await page.route("**/api/github/reconciliation", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unable to link this merged pull request" }),
      });
      return;
    }

    await route.continue();
  });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today" }).click();
  const inbox = page.getByLabel("Today attention inbox");
  await inbox.getByRole("button", { name: /GitHub/ }).click();
  await inbox.getByRole("button", { name: "Link TASK-101" }).click();

  await expect(inbox).toContainText("Unable to link this merged pull request");
  await expect(inbox.locator(".attention-action-message.is-failed")).toBeVisible();
  await expect(inbox).not.toContainText("GitHub reconciliation is degraded");
});

test("Today shows degraded reconciliation without hiding other inbox signals", async ({ page }) => {
  await page.route("**/api/github/reconciliation", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Reconciliation temporarily unavailable" }),
      });
    }

    return route.continue();
  });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today" }).click();

  const inbox = page.getByLabel("Today attention inbox");
  await expect(inbox).toContainText("GitHub reconciliation is degraded");
  await expect(inbox).toContainText("Agent, review, and handoff signals remain available");
  await expect(inbox).toContainText("Review handoff is incomplete");
  await expect(inbox).not.toContainText("Commerce Street");
});

test("Agents view shows active claims, leases, roster, and recent activity", async ({ page, request }) => {
  const claim = await request.post("/api/agent/tasks/TASK-101/claim", {
    data: { agent: "Codex", leaseMinutes: 45 },
  });
  expect(claim.ok()).toBe(true);
  const claimedPayload = await claim.json();

  const status = await request.post("/api/agent/tasks/TASK-101/status", {
    data: {
      status: "in_progress",
      agent: "Codex",
      agentRunId: claimedPayload.workItem.agentRunId,
      note: "Working through the Agents view.",
      githubBranch: "codex/task-101-contact-import-dedupe",
    },
  });
  expect(status.ok()).toBe(true);

  const setupPatch = await request.patch("/api/work-items/TASK-102", {
    data: {
      status: "in_progress",
      agent: "Claude Code",
      claimedBy: "",
      claimedAt: "",
      leaseExpiresAt: "",
    },
  });
  expect(setupPatch.ok()).toBe(true);
  expect((await setupPatch.json()).workItem).toMatchObject({
    key: "TASK-102",
    status: "in_progress",
    agent: "Claude Code",
  });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Agents" }).click();

  const claimedCard = page.locator(".claim-card").filter({ hasText: "TASK-101" });
  await expect(page.getByLabel("Agent activity")).toContainText("TASK-101");
  await expect(page.getByLabel("Agent activity")).toContainText(claimedPayload.workItem.agentRunId);
  await expect(page.getByLabel("Agent activity")).toContainText("web-app");
  await expect(claimedCard.locator(".lease-bar")).toBeVisible();
  await expect(claimedCard).toContainText("Healthy run");
  await expect(claimedCard.getByRole("button", { name: "Extend 60m" })).toBeVisible();
  await expect(claimedCard.getByRole("button", { name: "Release" })).toBeVisible();
  await expect(page.getByLabel("Agent activity")).toContainText("Codex");
  const unleasedProgressCard = page.locator(".claim-card").filter({ hasText: "TASK-102" });
  await expect(unleasedProgressCard).toContainText("Claude Code");
  await expect(unleasedProgressCard).toContainText("not recorded");
  await expect(page.getByLabel("Agent recent activity")).toContainText("Progress update");
  await expect(page.getByLabel("Agent recent activity")).toContainText("Working through the Agents view.");

  await claimedCard.getByRole("button", { name: "Open packet" }).click();
  await expect(page.getByRole("heading", { name: "AI-ready backlog" })).toBeVisible();
  await expect(page.locator(".detail-panel")).toContainText("TASK-101");
  await expect(page.locator(".detail-panel")).toContainText("Healthy run");
});

test("Agents view recovers stuck claims with extend, reclaim, and release", async ({ page, request }) => {
  const claim = await request.post("/api/agent/tasks/TASK-101/claim", {
    data: { agent: "Codex", leaseMinutes: 45 },
  });
  expect(claim.ok()).toBe(true);
  const claimedPayload = await claim.json();

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Agents" }).click();

  const claimedCard = page.locator(".claim-card").filter({ hasText: "TASK-101" });
  await expect(claimedCard).toContainText("Healthy run");
  await claimedCard.getByRole("button", { name: "Extend 60m" }).click();
  await expect(claimedCard).toContainText("Extended the lease by 60 minutes.");

  const afterExtend = await (await request.get("/api/work-items")).json();
  const extended = afterExtend.workItems.find((item) => item.key === "TASK-101");
  expect(Date.parse(extended.leaseExpiresAt)).toBeGreaterThan(Date.parse(claimedPayload.workItem.leaseExpiresAt));
  expect(extended.agentEvents.at(-1)).toMatchObject({ type: "recovery", action: "extend" });

  await claimedCard.getByRole("button", { name: "Release" }).click();
  await expect(page.locator(".claim-card").filter({ hasText: "TASK-101" })).toHaveCount(0);

  const afterRelease = await (await request.get("/api/work-items")).json();
  expect(afterRelease.workItems.find((item) => item.key === "TASK-101").status).toBe("ready_for_agent");

  const staleClaim = await request.post("/api/agent/tasks/TASK-102/claim", {
    data: { agent: "Codex", leaseMinutes: 30 },
  });
  expect(staleClaim.ok()).toBe(true);
  const stalePayload = await staleClaim.json();
  await request.patch("/api/work-items/TASK-102", {
    data: { leaseExpiresAt: "2020-01-01T00:00:00.000Z" },
  });

  await page.reload();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Agents" }).click();
  const staleCard = page.locator(".claim-card").filter({ hasText: "TASK-102" });
  await expect(staleCard).toContainText("Stale run");
  await staleCard.getByRole("button", { name: "Reclaim" }).click();
  await expect(staleCard).toContainText("Healthy run");

  const afterReclaim = await (await request.get("/api/work-items")).json();
  const reclaimed = afterReclaim.workItems.find((item) => item.key === "TASK-102");
  expect(reclaimed.status).toBe("claimed");
  expect(reclaimed.agentRunId).not.toBe(stalePayload.workItem.agentRunId);
});

test("creates a draft work packet", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New packet" }).click();
  const composer = page.locator(".composer");

  await composer.getByLabel("Title").fill("Document Manage deploy path");
  await composer.getByLabel("Problem statement").fill("Manage needs a documented deploy path before the domain is wired.");
  await composer.getByLabel("Desired outcome").fill("A reviewer can see the hosting and domain steps for agent-backlog.example.com.");
  await composer.getByLabel("Labels").fill("docs, deploy");
  await composer.getByLabel("Acceptance criteria").fill("Document hosting target\nDocument domain DNS expectation");
  await composer.getByLabel("Relevant files").fill("agent-backlog/manage/server.mjs\nagent-backlog/package.json");
  await composer.getByRole("button", { name: "Create packet" }).click();

  await expect(page.locator(".work-list").getByRole("button", { name: /TASK-107/ })).toBeVisible();
  await expect(page.getByLabel("Selected work packet").getByText("Document Manage deploy path")).toBeVisible();

  await page.reload();
  await expect(page.locator(".work-list").getByRole("button", { name: /TASK-107/ })).toBeVisible();
});

test("edits selected packet details and persists them", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Edit packet" }).click();

  const editor = page.locator(".packet-editor");
  await editor.getByRole("textbox", { name: "Title", exact: true }).fill("Fix contact import duplicate handling updated");
  await editor.getByLabel("Labels").fill("bug, import, customer-data");
  await editor.getByLabel("Desired outcome").fill("Imports merge normalized duplicates and the reviewer can verify the summary counts.");
  await editor.getByLabel("Relevant URLs").fill("https://github.com/your-org/web-app\nhttps://example.com/import-review");
  await editor.getByRole("button", { name: "Save edits" }).click();

  await expect(page.locator(".detail-panel")).toContainText("Fix contact import duplicate handling updated");

  await page.reload();
  await expect(page.locator(".detail-panel")).toContainText("Fix contact import duplicate handling updated");

  const payload = await (await request.get("/api/work-items")).json();
  const updated = payload.workItems.find((item) => item.key === "TASK-101");
  expect(updated.title).toBe("Fix contact import duplicate handling updated");
  expect(updated.labels).toContain("customer-data");
  expect(updated.relevantUrls).toContain("https://example.com/import-review");
});

test("creates packets from templates and duplicates packets", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New packet" }).click();
  const composer = page.locator(".composer");
  await composer.getByTestId("composer-template").selectOption("data-export");

  await expect(composer.getByLabel("Title")).toHaveValue("Refresh analytics export job");
  await expect(composer.getByTestId("composer-repo")).toHaveValue("data-pipeline");
  await expect(composer.getByLabel("Labels")).toHaveValue("template, reporting");
  await composer.getByRole("button", { name: "Create packet" }).click();

  await expect(page.locator(".work-list").getByRole("button", { name: /TASK-107/ })).toBeVisible();
  await expect(page.locator(".detail-panel")).toContainText("Refresh analytics export job");
  await expect(page.locator(".detail-panel")).toContainText("#reporting");

  await page.locator(".detail-panel").getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.locator(".work-list").getByRole("button", { name: /TASK-108/ })).toBeVisible();
  await expect(page.locator(".detail-panel")).toContainText("Copy of Refresh analytics export job");
});

test("review queue gates done until delivery evidence or an override exists", async ({ page, request }) => {
  const claim = await request.post("/api/agent/tasks/TASK-101/claim", {
    data: { agent: "Codex" },
  });
  expect(claim.ok()).toBe(true);
  const claimedPayload = await claim.json();

  const status = await request.post("/api/agent/tasks/TASK-101/status", {
    data: {
      status: "needs_review",
      agent: "Codex",
      agentRunId: claimedPayload.workItem.agentRunId,
      note: "Ready for reviewer sign-off.",
      githubBranch: "codex/task-101-contact-import-dedupe",
      githubPrUrl: "https://github.com/your-org/web-app/pull/101",
      testsRun: ["npm.cmd test"],
      filesChanged: ["web-app/src/lib/contactMatcher.js"],
    },
  });
  expect(status.ok()).toBe(true);

  const blockedDone = await request.post("/api/agent/tasks/TASK-104/status", {
    data: { status: "done", note: "Trying to close without verified evidence." },
  });
  expect(blockedDone.status()).toBe(409);
  expect((await blockedDone.json()).error).toContain("Completion evidence required");

  await request.post("/api/github/sync", { data: { mock: true } });
  const linked = await request.post("/api/work-items/TASK-101/link-github");
  expect(linked.ok()).toBe(true);

  await request.patch("/api/work-items/TASK-102", {
    data: { status: "needs_review", agent: "Claude Code", claimedBy: "Claude Code" },
  });
  await request.patch("/api/work-items/TASK-103", {
    data: { status: "needs_review", agent: "Codex", claimedBy: "Codex" },
  });
  await request.patch("/api/work-items/TASK-104", {
    data: { status: "needs_review", agent: "Codex", claimedBy: "Codex" },
  });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Review", exact: true }).click();

  const task101Card = page.locator(".review-card").filter({ hasText: "TASK-101" });
  await expect(task101Card).toContainText("Ready for reviewer sign-off.");
  await expect(task101Card).toContainText("codex/task-101-contact-import-dedupe");
  await expect(task101Card).toContainText("npm.cmd test");
  await expect(task101Card).toContainText("web-app/src/lib/contactMatcher.js");
  await expect(task101Card.getByText("Evidence complete")).toBeVisible();
  await expect(task101Card.getByText("Merged pull request", { exact: true })).toBeVisible();

  await task101Card.getByRole("button", { name: "Open packet" }).click();
  await expect(page.getByRole("heading", { name: "AI-ready backlog" })).toBeVisible();
  await expect(page.locator(".detail-panel")).toContainText("TASK-101");

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Review", exact: true }).click();
  const doneCard = page.locator(".review-card").filter({ hasText: "TASK-101" });
  await expect(doneCard.getByRole("button", { name: "Mark done" })).toBeEnabled();
  await doneCard.getByRole("button", { name: "Mark done" }).click();
  await expect(doneCard).toHaveCount(0);

  const changesCard = page.locator(".review-card").filter({ hasText: "TASK-102" });
  await expect(changesCard.getByText("Completion blocked")).toBeVisible();
  await expect(changesCard.getByRole("button", { name: "Mark done" })).toBeDisabled();
  await changesCard.getByRole("button", { name: "Needs changes" }).click();
  await expect(changesCard).toHaveCount(0);

  const overrideCard = page.locator(".review-card").filter({ hasText: "TASK-103" });
  await overrideCard.getByRole("button", { name: "Non-code override" }).click();
  await overrideCard.getByLabel("Completion override reason for TASK-103").fill("Planning packet completed without a code delivery.");
  await overrideCard.getByRole("button", { name: "Complete with override" }).click();
  await expect(overrideCard).toHaveCount(0);

  const blockedCard = page.locator(".review-card").filter({ hasText: "TASK-104" });
  await blockedCard.getByRole("button", { name: "Blocked" }).click();
  await expect(blockedCard).toHaveCount(0);

  await expect
    .poll(async () => {
      const payload = await (await request.get("/api/work-items")).json();
      return payload.workItems.find((item) => item.key === "TASK-101").status;
    })
    .toBe("done");
  await expect
    .poll(async () => {
      const payload = await (await request.get("/api/work-items")).json();
      return payload.workItems.find((item) => item.key === "TASK-102").status;
    })
    .toBe("ready_for_agent");
  let blocked;
  await expect
    .poll(async () => {
      const payload = await (await request.get("/api/work-items")).json();
      blocked = payload.workItems.find((item) => item.key === "TASK-104");
      return blocked.status;
    })
    .toBe("blocked");
  expect(blocked.blockedBy).toBeTruthy();
  const items = await (await request.get("/api/work-items")).json();
  expect(items.workItems.find((item) => item.key === "TASK-101").completionEvidence).toMatchObject({
    testsRun: ["Mock CI: success"],
    filesChanged: ["web-app/mock-delivery-file.js"],
  });
  expect(items.workItems.find((item) => item.key === "TASK-103").completionOverride).toMatchObject({
    reason: "Planning packet completed without a code delivery.",
  });
});

test("review evidence gate supports merged and override completion on a narrow viewport", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const claim = await request.post("/api/agent/tasks/TASK-101/claim", { data: { agent: "Codex" } });
  const claimed = await claim.json();
  await request.post("/api/agent/tasks/TASK-101/status", {
    data: {
      status: "needs_review",
      agent: "Codex",
      agentRunId: claimed.workItem.agentRunId,
      note: "Mobile review delivery is ready.",
      githubPrUrl: "https://github.com/your-org/web-app/pull/101",
      testsRun: ["npm.cmd test"],
      filesChanged: ["web-app/src/lib/contactMatcher.js"],
    },
  });
  await request.post("/api/github/sync", { data: { mock: true } });
  await request.post("/api/work-items/TASK-101/link-github");
  await request.patch("/api/work-items/TASK-102", { data: { status: "needs_review" } });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Review", exact: true }).click();

  const mergedCard = page.locator(".review-card").filter({ hasText: "TASK-101" });
  await expect(mergedCard.getByText("Ready to complete")).toBeVisible();
  await mergedCard.getByRole("button", { name: "Mark done" }).click();
  await expect(mergedCard).toHaveCount(0);

  const overrideCard = page.locator(".review-card").filter({ hasText: "TASK-102" });
  await expect(overrideCard.getByText("Completion blocked")).toBeVisible();
  await expect(overrideCard.getByRole("button", { name: "Mark done" })).toBeDisabled();
  await overrideCard.getByRole("button", { name: "Non-code override" }).click();
  await overrideCard.getByLabel("Completion override reason for TASK-102").fill("Mobile non-code review completed with documented rationale.");
  await overrideCard.getByRole("button", { name: "Complete with override" }).click();
  await expect(overrideCard).toHaveCount(0);
});

test("serves agent Markdown and next-task JSON", async ({ request }) => {
  const instructions = await request.get("/agent/instructions.md");
  expect(instructions.ok()).toBe(true);
  const instructionsText = await instructions.text();
  expect(instructionsText).toContain("Agent Backlog — Agent Instructions");
  expect(instructionsText).toContain("POST http://127.0.0.1:5186/api/agent/next/claim");
  expect(instructionsText).toContain("npm run manage:agent -- claim-next --repo web-app");
  expect(instructionsText).toContain("MANAGE_AUTH_TOKEN");
  expect(instructionsText).toContain("CodeRabbit");
  expect(instructionsText).toContain("post-merge closeout");

  const bootstrap = await request.get("/api/agent/bootstrap");
  expect(bootstrap.ok()).toBe(true);
  const bootstrapPayload = await bootstrap.json();
  expect(bootstrapPayload.bootstrap.endpoints.instructions).toBe("http://127.0.0.1:5186/agent/instructions.md");
  expect(bootstrapPayload.bootstrap.agents).toContain("Codex");
  expect(bootstrapPayload.bootstrap.labels.map((label) => label.id)).toContain("agent-handoff");
  expect(bootstrapPayload.bootstrap.repositories.length).toBeGreaterThan(0);
  expect(bootstrapPayload.bootstrap.commandTemplates.tokenBootstrap).toContain("MANAGE_AUTH_TOKEN");
  expect(bootstrapPayload.bootstrap.endpoints.recovery).toBe("http://127.0.0.1:5186/api/agent/tasks/{key}/recovery");
  expect(bootstrapPayload.bootstrap.commandTemplates.lifecycleCli).toContain("npm run manage:agent -- claim-next");
  expect(bootstrapPayload.bootstrap.commandTemplates.lifecycleCli).toContain("npm run manage:agent -- closeout");
  expect(bootstrapPayload.bootstrap.commandTemplates.lifecycleCli).toContain("npm run manage:agent -- extend");
  expect(bootstrapPayload.bootstrap.commandTemplates.lifecycleCli).toContain("npm run manage:agent -- reclaim");
  expect(bootstrapPayload.bootstrap.commandTemplates.lifecycleCli).toContain("npm run manage:agent -- release");
  expect(bootstrapPayload.bootstrap.commandTemplates.visualQaFallback).toContain("Playwright");
  expect(bootstrapPayload.bootstrap.commandTemplates.prReadyAndChecks).toContain("gh pr ready");
  expect(bootstrapPayload.bootstrap.commandTemplates.pollReviewChecks).toContain("CodeRabbit");
  expect(bootstrapPayload.bootstrap.commandTemplates.postMergeCloseout).toContain("Post-merge closeout");
  expect(bootstrapPayload.bootstrap.commandTemplates.postMergeCloseout).toContain("$pr.state -ne \"MERGED\"");
  expect(bootstrapPayload.bootstrap.commandTemplates.postMergeCloseout).toContain("gh pr diff");
  expect(bootstrapPayload.bootstrap.commandTemplates.postMergeCloseout).toContain("Invoke-RestMethod");
  expect(bootstrapPayload.bootstrap.commandTemplates.doneWriteback).toContain("status = 'done'");

  const markdown = await request.get("/agent/TASK-101.md");
  expect(markdown.ok()).toBe(true);
  const prompt = await markdown.text();
  expect(prompt).toContain("Repo: web-app");
  expect(prompt).toContain("Labels: #bug, #data-quality, #api");
  expect(prompt).toContain("Agent run ID:");
  expect(prompt).toContain("POST /api/agent/next/claim");
  expect(prompt).toContain("Review gate");
  expect(prompt).toContain("Done update");

  const next = await request.get("/api/agent/next?repo=web-app");
  expect(next.ok()).toBe(true);

  const payload = await next.json();
  expect(payload.workItem.key).toBe("TASK-101");
  expect(payload.workItem.labels).toContain("data-quality");
  expect(payload.prompt).toContain("Fix contact import duplicate handling");
  expect(payload.links.markdown).toBe("http://127.0.0.1:5186/agent/TASK-101.md");

  const nextByLabel = await request.get("/api/agent/next?label=data-quality");
  expect(nextByLabel.ok()).toBe(true);
  expect((await nextByLabel.json()).workItem.key).toBe("TASK-101");
});

test("filters backlog by label and updates the selected task URL", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Label").selectOption("agent-handoff");
  await expect(page.locator(".work-list").getByRole("button", { name: /TASK-103/ })).toBeVisible();
  await expect(page.locator(".work-list").getByRole("button", { name: /TASK-101/ })).toHaveCount(0);

  await page.locator(".work-list").getByRole("button", { name: /TASK-103/ }).click();
  await expect(page.getByLabel("Selected task URL")).toContainText("http://127.0.0.1:5186/agent/TASK-103.md");
  await expect(page.locator(".detail-panel")).toContainText("#agent-handoff");
});

test("routes shell navigation to focused workspaces", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByLabel("Today attention inbox")).toContainText("Attention inbox");
  await expect(page.getByLabel("Today overview")).toContainText("Next ready packet");

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Repos" }).click();
  await expect(page.getByRole("heading", { name: "Repository health" })).toBeVisible();
  await expect(page.getByLabel("Repository health")).toContainText("Sync GitHub");

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Agents" }).click();
  await expect(page.getByRole("heading", { name: "Agent activity" })).toBeVisible();
  await expect(page.getByLabel("Agent activity")).toContainText("Active claims");

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Backlog" }).click();
  await expect(page.getByRole("heading", { name: "AI-ready backlog" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Backlog", exact: true })).toContainText("TASK-101");
});

test("exposes deployment health and auth provider config", async ({ playwright, request }) => {
  const authenticatedSession = await request.get("/api/auth/session");
  expect(authenticatedSession.ok()).toBe(true);
  await expect(await authenticatedSession.json()).toMatchObject({
    authenticated: true,
    mode: "cookie",
  });

  const anonymous = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:5186",
    extraHTTPHeaders: {
      Authorization: "",
    },
  });

  const health = await anonymous.get("/api/health");
  expect(health.ok()).toBe(true);
  await expect(await health.json()).toMatchObject({
    ok: true,
    service: "manage",
    storage: "file",
  });

  const anonymousSession = await anonymous.get("/api/auth/session");
  expect(anonymousSession.ok()).toBe(true);
  const anonymousSessionPayload = await anonymousSession.json();
  expect(anonymousSessionPayload.authenticated).toBe(false);
  expect(anonymousSessionPayload.providers.token).toBe(true);
  expect(anonymousSessionPayload.providers.github).toBe(false);

  const agentLogin = await anonymous.post("/api/auth/login", {
    data: { token: manageAuthToken },
    failOnStatusCode: false,
  });
  expect(agentLogin.status()).toBe(401);

  const githubStart = await anonymous.get("/api/auth/github/start", {
    failOnStatusCode: false,
  });
  expect(githubStart.status()).toBe(503);

  await anonymous.dispose();

  const status = await request.get("/api/system/status");
  expect(status.ok()).toBe(true);
  const statusPayload = await status.json();
  expect(statusPayload.storage.kind).toBe("file");
  expect(statusPayload.storage.files.workItems).toContain("work-items.json");
  expect(statusPayload.storage.backups.enabled).toBe(true);
  expect(statusPayload.storage.backups.snapshotsDir).toContain("snapshots");
  expect(statusPayload.auth.github.available).toBe(false);
  expect(statusPayload.githubSync.freshness).toMatch(/fresh|stale|unknown/);
  expect(statusPayload.githubSync).toHaveProperty("syncState");
  expect(statusPayload.githubSync).toHaveProperty("lastSuccessAt");
  expect(JSON.stringify(statusPayload)).not.toMatch(/Commerce Street|csc-workspace|CSC-|COM-|Harbor|RegVault/i);
});

test("creates exports and restores backlog backups", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Repos" }).click();

  await expect(page.getByLabel("Backups")).toContainText("Create snapshot");
  await page.getByRole("button", { name: "Create snapshot" }).click();
  await expect(page.getByLabel("Backups")).toContainText("Snapshot saved");

  const listed = await request.get("/api/backups");
  expect(listed.ok()).toBe(true);
  const listedPayload = await listed.json();
  expect(listedPayload.backups.length).toBeGreaterThan(0);
  expect(listedPayload.backups[0].reason).toBe("manual");
  expect(listedPayload.backups[0].stats.workItems).toBe(6);

  const exported = await request.get("/api/backups/export");
  expect(exported.ok()).toBe(true);
  expect(exported.headers()["content-disposition"]).toContain("manage-backlog-");
  const exportedPayload = await exported.json();
  expect(exportedPayload.state["work-items"]).toHaveLength(6);
  expect(exportedPayload.state["github-cache"].repos.length).toBeGreaterThan(0);

  const snapshotId = listedPayload.backups[0].id;
  const originalTitle = exportedPayload.state["work-items"].find((item) => item.key === "TASK-101").title;
  const updated = await request.patch("/api/work-items/TASK-101", {
    data: { title: "Temporary backup restore title" },
  });
  expect(updated.ok()).toBe(true);
  expect((await updated.json()).workItem.title).toBe("Temporary backup restore title");

  const restored = await request.post(`/api/backups/${snapshotId}/restore`);
  expect(restored.ok()).toBe(true);
  const restoredPayload = await restored.json();
  expect(restoredPayload.restored).toContain("work-items");
  expect(restoredPayload.preRestoreSnapshot.reason).toContain("pre-restore:");
  expect(restoredPayload.workItems.find((item) => item.key === "TASK-101").title).toBe(originalTitle);

  await page.reload();
  await expect(page.locator(".detail-panel")).toContainText(originalTitle);
});

test("refreshes read-only GitHub cache", async ({ page, request }) => {
  const sync = await request.post("/api/github/sync", {
    data: { mock: true },
  });
  expect(sync.ok()).toBe(true);

  const payload = await sync.json();
  expect(payload.github.repos.length).toBeGreaterThan(0);
  expect(payload.github.repos[0]).toHaveProperty("openPrs");
  expect(payload.github.repos[0]).toHaveProperty("branches");
  expect(payload.github).toMatchObject({
    source: "mock",
    syncState: "current",
  });
  expect(payload.github.repos.every((repo) => repo.syncState === "current")).toBe(true);
  expect(JSON.stringify(payload)).not.toMatch(/Commerce Street|csc-workspace|CSC-|COM-|Harbor|RegVault/i);

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Repos" }).click();
  await expect(page.getByRole("button", { name: "Sync GitHub" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Link packets" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import issues" })).toBeVisible();
  await expect(page.locator(".repo-tile")).toHaveCount(6);
  await expect(page.getByLabel("System status")).toContainText("Fresh");
  await expect(page.getByLabel("Repository health")).toContainText("Fresh");

  const webAppTile = page.locator(".repo-tile").filter({ hasText: "web-app" });
  await expect(webAppTile).toContainText("PRs");
  await expect(webAppTile).toContainText("Issues");
  await expect(webAppTile).toContainText("Failed");
  await expect(webAppTile).toContainText("main");
  await expect(webAppTile).toContainText("Fresh");
  await expect(webAppTile.getByRole("link", { name: "Open repo" })).toHaveAttribute("href", /github\.com\/your-org\/web-app/);
  await expect(page.getByRole("region", { name: "Merged pull request reconciliation" })).toBeVisible();
});

test("reconciles merged PRs from the GitHub cache without CSC leakage", async ({ page, request }) => {
  const sync = await request.post("/api/github/sync", {
    data: { mock: true },
  });
  expect(sync.ok()).toBe(true);

  const listed = await request.get("/api/github/reconciliation");
  expect(listed.ok()).toBe(true);
  const listedPayload = await listed.json();
  expect(listedPayload.reconciliation.totalMergedPullRequests).toBeGreaterThan(0);
  const task101Match = listedPayload.reconciliation.unmatchedMergedPullRequests.find(
    (pull) => pull.repoId === "web-app" && pull.number === 101,
  );
  const unmatchedMarketing = listedPayload.reconciliation.unmatchedMergedPullRequests.find(
    (pull) => pull.repoId === "marketing-site" && pull.number === 88,
  );
  expect(task101Match.suggestedPacket).toMatchObject({ key: "TASK-101", confidence: "high" });
  expect(unmatchedMarketing.suggestedPacket).toBeNull();
  expect(JSON.stringify(listedPayload)).not.toMatch(/Commerce Street|csc-workspace|CSC-|COM-|Harbor|RegVault/i);

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Repos" }).click();
  const panel = page.getByRole("region", { name: "Merged pull request reconciliation" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Merged PRs without packets" })).toBeVisible();
  await expect(panel).toContainText("TASK-101");
  await expect(panel).toContainText("Refresh the public homepage hero");
  await expect(panel).not.toContainText("Commerce Street");
  await expect(panel).not.toContainText("CSC-");

  await panel.getByRole("button", { name: "Link TASK-101 to web-app PR #101" }).click();
  await expect(panel).toContainText("Linked TASK-101 to web-app #101");

  await panel.getByRole("button", { name: "Create follow-up for marketing-site PR #88" }).click();
  await expect(panel).toContainText(/Created TASK-\d+ for marketing-site #88/);

  const linkedPacket = await request.get("/api/work-items");
  const workItems = (await linkedPacket.json()).workItems;
  expect(workItems.find((item) => item.key === "TASK-101")?.githubPrUrl).toBe(task101Match.url);
  const followUpPacket = workItems.find((item) => item.githubPrUrl === unmatchedMarketing.url && item.key !== "TASK-101");
  expect(followUpPacket.key).toMatch(/^TASK-\d+$/);
  expect(followUpPacket.repo).toBe("marketing-site");
  expect(followUpPacket.labels).toEqual(expect.arrayContaining(["github-sync", "follow-up"]));
  expect(followUpPacket.project).toBe("Reconciliation");
  expect(JSON.stringify(workItems)).not.toMatch(/Commerce Street|csc-workspace|CSC-|COM-|Harbor|RegVault|Shipped reconciliation/i);
});

test("creates a GitHub issue handoff for a work packet", async ({ page, request }) => {
  const created = await request.post("/api/work-items/TASK-101/github-issue", {
    data: { mock: true },
  });
  expect(created.status()).toBe(201);

  const createdPayload = await created.json();
  expect(createdPayload.created).toBe(true);
  expect(createdPayload.issue.url).toBe("https://github.com/your-org/web-app/issues/9101");
  expect(createdPayload.workItem.githubIssueUrl).toBe(createdPayload.issue.url);
  expect(createdPayload.workItem.relevantUrls).toContain(createdPayload.issue.url);

  const duplicate = await request.post("/api/work-items/TASK-101/github-issue", {
    data: { mock: true },
  });
  expect(duplicate.ok()).toBe(true);
  expect((await duplicate.json()).created).toBe(false);

  const markdown = await request.get("/agent/TASK-101.md");
  expect(await markdown.text()).toContain("Issue: https://github.com/your-org/web-app/issues/9101");

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Open issue" })).toBeVisible();
  await expect(page.locator(".detail-panel")).toContainText("TASK-101: Fix contact import duplicate handling");
});

test("imports cached GitHub issues into draft packets", async ({ request }) => {
  const sync = await request.post("/api/github/sync", {
    data: { mock: true },
  });
  expect(sync.ok()).toBe(true);

  const imported = await request.post("/api/github/issues/import", {
    data: { repo: "web-app", limit: 1 },
  });
  expect(imported.ok()).toBe(true);

  const payload = await imported.json();
  expect(payload.imported).toHaveLength(1);
  expect(payload.imported[0]).toMatchObject({
    key: "TASK-107",
    repo: "web-app",
    issueNumber: 201,
    issueUrl: "https://github.com/your-org/web-app/issues/201",
  });

  const importedItem = payload.workItems.find((item) => item.key === "TASK-107");
  expect(importedItem.status).toBe("draft");
  expect(importedItem.title).toBe("Web app backlog grooming");
  expect(importedItem.labels).toContain("github-sync");
  expect(importedItem.githubLinks.issues).toHaveLength(1);

  const duplicate = await request.post("/api/github/issues/import", {
    data: { repo: "web-app", limit: 1 },
  });
  expect((await duplicate.json()).imported).toHaveLength(0);
});

test("claims the next ready packet with an agent lease", async ({ request }) => {
  const claim = await request.post("/api/agent/next/claim", {
    data: { repo: "web-app", agent: "Codex", leaseMinutes: 30 },
  });
  expect(claim.ok()).toBe(true);

  const payload = await claim.json();
  expect(payload.workItem.key).toBe("TASK-101");
  expect(payload.workItem.status).toBe("claimed");
  expect(payload.workItem.agentRunId).toContain("TASK-101-");
  expect(payload.workItem.leaseExpiresAt).toBeTruthy();
  expect(payload.prompt).toContain("Lease expires:");

  const duplicateClaim = await request.post("/api/agent/tasks/TASK-101/claim", {
    data: { agent: "Claude Code" },
  });
  expect(duplicateClaim.status()).toBe(409);
});

test("links cached GitHub branches and PRs to work packets", async ({ request }) => {
  const sync = await request.post("/api/github/sync", {
    data: { mock: true },
  });
  expect(sync.ok()).toBe(true);

  const link = await request.post("/api/work-items/TASK-101/link-github");
  expect(link.ok()).toBe(true);

  const payload = await link.json();
  expect(payload.workItem.githubBranch).toBe("codex/task-101-contact-import-dedupe");
  expect(payload.workItem.githubPrUrl).toContain("/pull/101");
  expect(payload.matches.pullRequests).toHaveLength(1);
  expect(payload.matches.branches).toHaveLength(1);
});

test("lets agents claim packets and write structured status back", async ({ page, request }) => {
  const claim = await request.post("/api/agent/tasks/TASK-101/claim", {
    data: { agent: "Codex" },
  });
  expect(claim.ok()).toBe(true);

  const claimedPayload = await claim.json();
  expect(claimedPayload.workItem.status).toBe("claimed");
  expect(claimedPayload.workItem.claimedBy).toBe("Codex");
  expect(claimedPayload.workItem.agentRunId).toContain("TASK-101-");

  const status = await request.post("/api/agent/tasks/TASK-101/status", {
    data: {
      status: "needs_review",
      agent: "Codex",
      agentRunId: claimedPayload.workItem.agentRunId,
      note: "Opened a PR and ran CRM tests.",
      githubBranch: "codex/task-101-contact-import-dedupe",
      githubPrUrl: "https://github.com/your-org/web-app/pull/101",
      testsRun: ["npm.cmd test", "npm.cmd run build"],
      filesChanged: ["web-app/src/lib/contactMatcher.js", "web-app/src/components/banker-crm/ImportViews.jsx"],
      blockers: [],
      nextSteps: ["Reviewer should inspect duplicate merge counts."],
    },
  });
  expect(status.ok()).toBe(true);

  const statusPayload = await status.json();
  expect(statusPayload.workItem.status).toBe("needs_review");
  expect(statusPayload.workItem.githubBranch).toBe("codex/task-101-contact-import-dedupe");
  expect(statusPayload.workItem.githubPrUrl).toContain("/pull/101");
  expect(statusPayload.workItem.lastAgentUpdate.testsRun).toContain("npm.cmd test");
  expect(statusPayload.workItem.lastAgentUpdate.filesChanged).toContain("web-app/src/lib/contactMatcher.js");
  expect(statusPayload.workItem.lastAgentUpdate.nextSteps).toContain("Reviewer should inspect duplicate merge counts.");
  expect(statusPayload.workItem.agentEvents.at(-1)).toMatchObject({
    type: "status",
    status: "needs_review",
    githubBranch: "codex/task-101-contact-import-dedupe",
  });
  expect(statusPayload.prompt).toContain("Opened a PR and ran CRM tests.");
  expect(statusPayload.prompt).toContain("tests npm.cmd test; npm.cmd run build");

  await page.goto("/");
  await expect(page.locator(".detail-panel")).toContainText("Agent timeline");
  await expect(page.locator(".detail-panel")).toContainText("Opened a PR and ran CRM tests.");
  await expect(page.locator(".detail-panel")).toContainText("npm.cmd test");
  await expect(page.locator(".detail-panel")).toContainText("web-app/src/lib/contactMatcher.js");
  await expect(page.locator(".detail-panel")).toContainText("Reviewer should inspect duplicate merge counts.");
});

test("enforces agent least privilege and browser write protection", async ({ baseURL }) => {
  expect(baseURL).toBeTruthy();
  const origin = new URL(baseURL).origin;
  const agent = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${manageAuthToken}` },
  });

  try {
    expect((await agent.get("/api/agent/bootstrap")).status()).toBe(200);
    expect((await agent.get("/api/agent/next")).status()).toBe(200);
    expect((await agent.get("/api/agent/next-key")).status()).toBe(200);
    const claimed = await agent.post("/api/agent/tasks/TASK-101/claim", { data: { agent: "Codex" } });
    expect(claimed.status()).toBe(200);
    const forced = await agent.post("/api/agent/tasks/TASK-101/claim", {
      data: { agent: "Claude Code", force: true },
    });
    expect(forced.status(), "agent force-claim of a healthy lease").toBe(403);
    const created = await agent.post("/api/agent/tasks", {
      data: {
        title: "Agent-created lifecycle packet",
        summary: "Exercise the least-privilege packet creation endpoint.",
        desiredOutcome: "The lifecycle CLI remains usable without operator workspace access.",
        repo: "web-app",
      },
    });
    expect(created.status()).toBe(201);
    const createdPayload = await created.json();
    expect(createdPayload.workItem.key).toMatch(/^TASK-\d+$/);
    expect(createdPayload.workItem.status).toBe("draft");

    for (const [method, path, data] of [
      ["post", "/api/agent/reset", { confirmation: "RESET MANAGE" }],
      ["post", "/api/backups", { reason: "agent-denied" }],
      ["post", "/api/github/sync", { mock: true }],
      ["get", "/api/github/reconciliation", undefined],
      ["post", "/api/github/reconciliation", { action: "follow_up", pullRequestUrl: "https://github.com/your-org/marketing-site/pull/88" }],
      ["get", "/api/work-items", undefined],
    ]) {
      const response = await agent[method](path, { data, failOnStatusCode: false });
      expect(response.status(), `${method.toUpperCase()} ${path}`).toBe(403);
    }
  } finally {
    await agent.dispose();
  }

  const browser = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { "x-csrf-protection": "0" },
  });

  try {
    const login = await browser.post("/api/auth/login", { data: { token: manageOperatorToken } });
    expect(login.ok()).toBe(true);

    const missingProtection = await browser.post("/api/backups", {
      data: { reason: "missing-csrf" },
      headers: { Origin: "null" },
      failOnStatusCode: false,
    });
    expect(missingProtection.status()).toBe(403);

    const hostileOrigin = await browser.post("/api/backups", {
      data: { reason: "hostile-origin" },
      headers: { Origin: "https://evil.example" },
      failOnStatusCode: false,
    });
    expect(hostileOrigin.status()).toBe(403);

    const sameOrigin = await browser.post("/api/backups", {
      data: { reason: "same-origin" },
      headers: { Origin: origin },
    });
    expect(sameOrigin.status()).toBe(201);
  } finally {
    await browser.dispose();
  }
});

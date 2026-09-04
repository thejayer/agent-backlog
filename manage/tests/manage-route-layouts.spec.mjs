import { expect, test } from "@playwright/test";

const CSC_LEAKAGE = /Commerce Street|csc-workspace|csc-crm|CSC-|COM-|commercestreet|Harbor|RegVault|gcloud|linear\.app\/.*COM-/i;

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

async function openReviewItem(page, key) {
  await page.locator(".review-inbox-list").getByRole("button", { name: new RegExp(key) }).click();
}

test("Today command center uses signal cards and the existing attention inbox without CSC leakage", async ({ page }) => {
  await page.goto("/?view=today");

  const overview = page.getByLabel("Today overview");
  await expect(overview).toBeVisible();
  await expect(page.locator(".today-command")).toBeVisible();
  await expect(page.locator(".today-next")).toContainText("Next ready packet");
  await expect(page.locator(".today-next")).toContainText("Keep delivery moving");
  await expect(page.getByRole("button", { name: "Open packet" })).toBeVisible();

  const signals = page.getByLabel("Operating signals");
  await expect(signals.locator(".signal-card")).toHaveCount(4);
  await expect(signals).toContainText("Review queue");
  await expect(signals).toContainText("Agent runs");
  await expect(signals).toContainText("Ready work");
  await expect(signals).toContainText("Repo alerts");
  await expect(signals).not.toContainText(CSC_LEAKAGE);

  await expect(page.getByLabel("Today attention inbox")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Attention inbox" })).toBeVisible();
  await expect(page.locator(".today-operations")).toBeVisible();
  await expect(page.getByLabel("Mini repo health")).toContainText("Repository pulse");

  await expect(page.locator(".workspace")).not.toContainText(CSC_LEAKAGE);
  await expect(page.locator(".workspace")).not.toContainText("Harbor");
  await expect(page.locator(".workspace")).not.toContainText("RegVault");
  await expect(page.locator(".workspace")).not.toContainText("Commerce Street");

  await signals.getByRole("button", { name: /Review queue/ }).click();
  await expect(page).toHaveURL(/view=review/);
});

test("Review workbench selects inbox items and keeps the delivery evidence gate", async ({ page, request }) => {
  await request.patch("/api/work-items/TASK-101", { data: { status: "needs_review", agent: "Codex", claimedBy: "Codex" } });
  await request.patch("/api/work-items/TASK-102", { data: { status: "needs_review", agent: "Claude Code", claimedBy: "Claude Code" } });

  await page.goto("/?view=review&packet=TASK-101");

  await expect(page.locator(".review-workbench")).toBeVisible();
  await expect(page.getByLabel("Review operating metrics")).toContainText("Awaiting decision");
  await expect(page.getByLabel("Review items")).toBeVisible();
  await expect(page.getByRole("group", { name: "Review views" })).toContainText("Open");
  await expect(page.getByRole("group", { name: "Review views" }).getByRole("button", { name: /Returned/ })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Validate the handoff" })).toBeVisible();
  await expect(page.locator(".review-inbox-list").getByRole("button", { name: /TASK-101/ })).toBeVisible();

  const selectedCard = page.locator(".review-card");
  await expect(selectedCard).toContainText("TASK-101");
  await expect(selectedCard.getByText("Completion blocked")).toBeVisible();
  await expect(selectedCard.getByRole("button", { name: "Mark done" })).toBeDisabled();
  await expect(selectedCard.getByRole("button", { name: "Non-code override" })).toBeVisible();

  await openReviewItem(page, "TASK-102");
  await expect(page).toHaveURL(/packet=TASK-102/);
  await expect(page.locator(".review-card")).toContainText("TASK-102");
  await expect(page.locator(".review-inbox-list").getByRole("button", { name: /TASK-102/ })).toHaveAttribute("aria-pressed", "true");

  await expect(page.getByLabel("Review queue")).not.toContainText(CSC_LEAKAGE);
  await expect(page.locator(".review-workbench")).not.toContainText("Harbor");
  await expect(page.locator(".review-workbench")).not.toContainText("RegVault");
  await expect(page.locator(".review-workbench")).not.toContainText("Commerce Street");
});

test("Agents console shows metrics, run filters, and recovery without CSC leakage", async ({ page, request }) => {
  const claim = await request.post("/api/agent/tasks/TASK-101/claim", {
    data: { agent: "Codex", leaseMinutes: 45 },
  });
  expect(claim.ok()).toBe(true);
  const claimedPayload = await claim.json();
  await request.post("/api/agent/tasks/TASK-101/status", {
    data: {
      status: "in_progress",
      agent: "Codex",
      agentRunId: claimedPayload.workItem.agentRunId,
      note: "Working the run console.",
      githubBranch: "codex/task-101-contact-import-dedupe",
    },
  });
  await request.patch("/api/work-items/TASK-102", {
    data: {
      status: "in_progress",
      agent: "Claude Code",
      claimedBy: "Claude Code",
      claimedAt: new Date().toISOString(),
    },
  });

  await page.goto("/?view=agents");

  const metrics = page.getByLabel("Agent operating metrics");
  await expect(metrics).toContainText("Active runs");
  await expect(metrics).toContainText("Assigned");
  await expect(metrics).toContainText("Ready for review");
  await expect(metrics).toContainText("Blocked");
  await expect(page.getByRole("heading", { name: "Live runs" })).toBeVisible();

  const filters = page.getByRole("group", { name: "Filter agent runs" });
  await expect(filters.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".claim-card").filter({ hasText: "TASK-101" })).toBeVisible();
  await expect(page.locator(".claim-card").filter({ hasText: "TASK-102" })).toBeVisible();

  await filters.getByRole("button", { name: "Codex" }).click();
  const codexCard = page.locator(".claim-card").filter({ hasText: "TASK-101" });
  await expect(codexCard).toBeVisible();
  await expect(page.locator(".claim-card").filter({ hasText: "TASK-102" })).toHaveCount(0);
  await expect(codexCard).toContainText("Healthy run");
  await expect(codexCard.getByRole("button", { name: "Extend 60m" })).toBeVisible();
  await expect(codexCard.getByRole("button", { name: "Release" })).toBeVisible();

  await page.locator(".roster-row").filter({ hasText: "Claude Code" }).click();
  await expect(page.locator(".claim-card").filter({ hasText: "TASK-102" })).toBeVisible();
  await expect(page.locator(".claim-card").filter({ hasText: "TASK-101" })).toHaveCount(0);

  await expect(page.getByLabel("Agent activity")).not.toContainText(CSC_LEAKAGE);
  await expect(page.getByLabel("Agent activity")).not.toContainText("Harbor");
  await expect(page.getByLabel("Agent activity")).not.toContainText("RegVault");
  await expect(page.getByLabel("Agent activity")).not.toContainText("Commerce Street");
});

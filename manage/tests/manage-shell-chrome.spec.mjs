import { expect, test } from "@playwright/test";

const CSC_LEAKAGE = /Commerce Street|csc-workspace|csc-crm|CSC-|COM-|commercestreet|Harbor|RegVault|gcloud|linear\.app\/.*COM-/i;

const manageOperatorToken = process.env.MANAGE_PLAYWRIGHT_OPERATOR_TOKEN || "manage-playwright-local-operator-token";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { token: manageOperatorToken } });
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

test("groups sidebar destinations into Focus, Plan, Operate, and Review", async ({ page }) => {
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("group", { name: "Focus" }).getByRole("button", { name: "Today" })).toBeVisible();
  await expect(navigation.getByRole("group", { name: "Focus" }).getByRole("button", { name: "Backlog" })).toBeVisible();
  await expect(navigation.getByRole("group", { name: "Plan" }).getByRole("button", { name: "Initiatives" })).toBeVisible();
  await expect(navigation.getByRole("group", { name: "Operate" }).getByRole("button", { name: "Agents" })).toBeVisible();
  await expect(navigation.getByRole("group", { name: "Operate" }).getByRole("button", { name: "Repos" })).toBeVisible();
  await expect(navigation.getByRole("group", { name: "Review" }).getByRole("button", { name: "Review" })).toBeVisible();
  await expect(navigation.getByRole("group", { name: "Review" }).getByRole("button", { name: "Shipped" })).toBeVisible();
  await expect(navigation).not.toContainText(CSC_LEAKAGE);
  await expect(navigation).not.toContainText(/Harbor|RegVault|Commerce Street/i);

  await navigation.getByRole("group", { name: "Review" }).getByRole("button", { name: "Shipped" }).click();
  await expect(page).toHaveURL(/view=shipped/);
  await expect(page.getByRole("heading", { name: "Shipped work" })).toBeVisible();
});

test("opens the command palette with the trigger and Control+K, then jumps to a view", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Find a packet or view" }).click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(palette.getByLabel("Search commands")).toBeFocused();
  await expect(palette).toContainText("Today");
  await expect(palette).toContainText("New packet");
  await expect(palette).not.toContainText(CSC_LEAKAGE);

  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  await page.keyboard.press("Control+K");
  await expect(palette).toBeVisible();
  await palette.getByLabel("Search commands").fill("Review");
  await palette.getByRole("button", { name: "Review view" }).click();
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(/view=review/);
  await expect(page.getByRole("heading", { name: "Review queue", level: 1 })).toBeVisible();
});

test("jumps from the command palette to a TASK packet", async ({ page }) => {
  await page.goto("/?view=today");

  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByLabel("Search commands").fill("TASK-101");
  await expect(palette).toContainText("TASK-101");
  await expect(palette).not.toContainText("CSC-");
  await palette.getByRole("button", { name: "TASK-101 packet" }).click();
  await expect(page).toHaveURL(/view=backlog/);
  await expect(page).toHaveURL(/packet=TASK-101/);
  await expect(page.getByRole("heading", { name: "AI-ready backlog" })).toBeVisible();
  await expect(page.locator(".work-row.is-selected")).toContainText("TASK-101");
});

test("keeps session, sync, reset, and sign-out in the overflow shell menu", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".topbar-actions > .session-chip")).toHaveCount(0);
  await expect(page.locator(".topbar-actions > .sync-chip")).toHaveCount(0);
  await expect(page.locator(".topbar-actions > .button", { hasText: "Reset store" })).toHaveCount(0);
  await expect(page.locator(".topbar-actions > .button", { hasText: "Sign out" })).toHaveCount(0);

  const trigger = page.getByRole("button", { name: "Workspace settings" });
  await trigger.click();
  const menu = page.getByRole("region", { name: "Workspace settings" });
  await expect(menu).toBeVisible();
  await expect(menu.getByText("Token session")).toBeVisible();
  await expect(menu.locator(".sync-chip")).toBeVisible();
  await expect(menu.getByRole("button", { name: "Reset store" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(menu).not.toContainText(CSC_LEAKAGE);
  await expect(menu).not.toContainText(/Harbor|Glassy|RegVault|Commerce Street/i);

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("command palette and overflow menu stay free of CSC leakage across appearance modes", async ({ page }) => {
  await page.goto("/");
  const root = page.locator("html");
  const { controls } = await (async () => {
    const quick = page.locator(".shell-quick-controls");
    if (await quick.isVisible()) return { controls: page };
    await page.getByRole("button", { name: "Workspace settings" }).click();
    return { controls: page.getByRole("region", { name: "Workspace settings" }) };
  })();

  await controls.getByLabel("Appearance").selectOption("glass");
  await controls.getByLabel("Theme").selectOption("dark");
  await expect(root).toHaveAttribute("data-manage-appearance", "glass");
  await expect(root).toHaveAttribute("data-manage-theme", "dark");

  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(palette).not.toContainText(CSC_LEAKAGE);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Workspace settings" }).click();
  const menu = page.getByRole("region", { name: "Workspace settings" });
  await expect(menu).toBeVisible();
  await expect(menu).not.toContainText(CSC_LEAKAGE);
  await expect(page.locator("body")).not.toContainText(/commercestreet|Harbor|RegVault|CSC-|COM-/i);
});

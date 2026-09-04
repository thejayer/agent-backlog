import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const manageOperatorToken = process.env.MANAGE_PLAYWRIGHT_OPERATOR_TOKEN || "manage-playwright-local-operator-token";
const blockingImpacts = new Set(["serious", "critical"]);

function violationSummary(violations) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary })),
  }));
}

async function expectNoBlockingViolations(page, testInfo, state) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const diagnostics = violationSummary(results.violations);
  await testInfo.attach(`axe-${state}.json`, {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: "application/json",
  });
  const blocking = diagnostics.filter((violation) => blockingImpacts.has(violation.impact));
  expect(blocking, `${state} has serious or critical accessibility violations`).toEqual([]);
}

async function openWorkspaceMenu(page) {
  const trigger = page.getByRole("button", { name: "Workspace settings" });
  const menu = page.getByRole("region", { name: "Workspace settings" });
  if (!(await menu.isVisible())) {
    await trigger.click();
  }
  return { menu, trigger };
}

async function openOperatorControls(page) {
  const quickControls = page.locator(".shell-quick-controls");
  if (await quickControls.isVisible()) {
    return { controls: page, returnFocus: null };
  }
  const { menu, trigger } = await openWorkspaceMenu(page);
  return { controls: menu, returnFocus: trigger };
}

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

test("@a11y shell and packet composer pass the blocking accessibility gate", async ({ page }, testInfo) => {
  await page.goto("/");
  await expectNoBlockingViolations(page, testInfo, "shell");

  const trigger = page.getByRole("button", { name: "New packet" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New work packet" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
  await expectNoBlockingViolations(page, testInfo, "packet-composer");

  await dialog.getByRole("button", { name: "Create packet" }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

async function applyAppearance(page, { appearance, theme }) {
  const { controls } = await openOperatorControls(page);
  await controls.getByLabel("Appearance").selectOption(appearance);
  await controls.getByLabel("Theme").selectOption(theme);
  await expect(page.locator("html")).toHaveAttribute("data-manage-appearance", appearance);
  await expect(page.locator("html")).toHaveAttribute("data-manage-theme", theme);
  if (await page.getByRole("region", { name: "Workspace settings" }).isVisible()) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Workspace settings" })).toBeHidden();
  }
}

test("@a11y glass appearance keeps light and dark shell above the contrast gate", async ({ page }, testInfo) => {
  await page.goto("/");
  await applyAppearance(page, { appearance: "glass", theme: "light" });
  await expectNoBlockingViolations(page, testInfo, "shell-glass-light");

  const trigger = page.getByRole("button", { name: "New packet" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "New work packet" });
  await expect(dialog).toBeVisible();
  await expectNoBlockingViolations(page, testInfo, "packet-composer-glass-light");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await applyAppearance(page, { appearance: "glass", theme: "dark" });
  await expectNoBlockingViolations(page, testInfo, "shell-glass-dark");
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expectNoBlockingViolations(page, testInfo, "packet-composer-glass-dark");
});

test("@a11y initiative and destructive dialogs preserve keyboard-safe modal behavior", async ({ page }, testInfo) => {
  await page.goto("/");
  const initiativesNav = page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Initiatives" });
  await initiativesNav.focus();
  await page.keyboard.press("Enter");

  const initiativeTrigger = page.getByRole("button", { name: "New initiative" });
  await initiativeTrigger.focus();
  await page.keyboard.press("Enter");
  const initiativeDialog = page.getByRole("dialog", { name: "Bootstrap initiative" });
  await expect(initiativeDialog.getByLabel("Initiative template")).toBeFocused();
  await expectNoBlockingViolations(page, testInfo, "initiative-composer");
  await page.locator(".modal-backdrop").click({ position: { x: 1, y: 1 } });
  await expect(initiativeDialog).toBeHidden();
  await expect(initiativeTrigger).toBeFocused();

  const { menu } = await openWorkspaceMenu(page);
  const resetTrigger = menu.getByRole("button", { name: "Reset store" });
  await resetTrigger.focus();
  await page.keyboard.press("Enter");
  const destructiveDialog = page.getByRole("dialog", { name: "Reset backlog store" });
  await expect(destructiveDialog.getByLabel("Typed confirmation")).toBeFocused();
  await expectNoBlockingViolations(page, testInfo, "destructive-dialog");
  await page.keyboard.press("Escape");
  await expect(destructiveDialog).toBeHidden();
  await expect(resetTrigger).toBeFocused();
});

test("@a11y command palette preserves accessible modal behavior", async ({ page }, testInfo) => {
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Find a packet or view" });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog.getByLabel("Search commands")).toBeFocused();
  await expectNoBlockingViolations(page, testInfo, "command-palette");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("@a11y overflow workspace menu stays keyboard reachable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Workspace settings" });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const menu = page.getByRole("region", { name: "Workspace settings" });
  await expect(menu.getByLabel("Density")).toBeVisible();
  await expectNoBlockingViolations(page, testInfo, "workspace-settings-menu");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("@a11y Today, Review, and Agents route layouts stay above the contrast gate", async ({ page, request }, testInfo) => {
  await request.patch("/api/work-items/TASK-104", { data: { status: "needs_review" } });

  await page.goto("/?view=today");
  await expect(page.locator(".today-command")).toBeVisible();
  await expectNoBlockingViolations(page, testInfo, "today-command-center");

  await page.goto("/?view=review&packet=TASK-104");
  await expect(page.locator(".review-workbench")).toBeVisible();
  await expectNoBlockingViolations(page, testInfo, "review-workbench");

  await page.goto("/?view=agents");
  await expect(page.getByLabel("Agent operating metrics")).toBeVisible();
  await expectNoBlockingViolations(page, testInfo, "agents-console");
});


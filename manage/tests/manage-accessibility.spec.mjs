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

async function openOperatorControls(page) {
  const settingsTrigger = page.getByRole("button", { name: "Settings" });
  if (await settingsTrigger.isVisible()) {
    await settingsTrigger.click();
    return {
      controls: page.getByRole("dialog", { name: "Operator settings" }),
      returnFocus: settingsTrigger,
    };
  }
  return { controls: page, returnFocus: null };
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

test("@a11y glass theme keeps shell and packet composer above the contrast gate", async ({ page }, testInfo) => {
  await page.goto("/");
  const { controls } = await openOperatorControls(page);
  await controls.getByLabel("Theme").selectOption("glass");
  await expect(page.locator("html")).toHaveAttribute("data-manage-theme", "glass");
  if (await page.getByRole("dialog", { name: "Operator settings" }).isVisible()) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Operator settings" })).toBeHidden();
  }
  await expectNoBlockingViolations(page, testInfo, "shell-glass");

  const trigger = page.getByRole("button", { name: "New packet" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "New work packet" });
  await expect(dialog).toBeVisible();
  await expectNoBlockingViolations(page, testInfo, "packet-composer-glass");
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

  const { controls, returnFocus } = await openOperatorControls(page);
  const resetTrigger = controls.getByRole("button", { name: "Reset store" });
  await resetTrigger.focus();
  await page.keyboard.press("Enter");
  const destructiveDialog = page.getByRole("dialog", { name: "Reset backlog store" });
  await expect(destructiveDialog.getByLabel("Typed confirmation")).toBeFocused();
  await expectNoBlockingViolations(page, testInfo, "destructive-dialog");
  await page.keyboard.press("Escape");
  await expect(destructiveDialog).toBeHidden();
  await expect(returnFocus || resetTrigger).toBeFocused();
});

test("@a11y mobile operator settings preserve accessible modal behavior", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Settings" });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Operator settings" });
  await expect(dialog.getByLabel("Density")).toBeFocused();
  await expectNoBlockingViolations(page, testInfo, "mobile-operator-settings");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

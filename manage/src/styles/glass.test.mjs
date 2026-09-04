import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const branded = /Commerce Street|commercestreet|RegVault|RegVault-inspired|CSC-|COM-|Harbor|csc-workspace|csc-crm/i;
const stageTokens = /--stage-(prospecting|holding|active|dd|term|closed)/;
const leftoverThemeGlass = /\[data-(?:manage-)?theme=["']glass["']\]/;
const cscOnlySelectors = /\.mb-(?:content|row|list|workspace|stat)/;

describe("glass appearance sources stay unbranded", () => {
  const files = [
    "glass.css",
    join("..", "tokens.css"),
    join("..", "styles.css"),
    join("..", "components", "ManageShell.jsx"),
    join("..", "lib", "shellPreferences.mjs"),
    join("..", "lib", "shellChrome.mjs"),
    "shell.css",
    "routes.css",
  ];

  it.each(files)("does not leak branded copy or deal-pipeline stage tokens in %s", (relativePath) => {
    const source = readFileSync(join(here, relativePath), "utf8");
    expect(source).not.toMatch(branded);
    expect(source).not.toMatch(stageTokens);
  });

  it("defines an unbranded glass appearance layer instead of a third theme", () => {
    const tokens = readFileSync(join(here, "..", "tokens.css"), "utf8");
    const glass = readFileSync(join(here, "glass.css"), "utf8");
    const shell = readFileSync(join(here, "..", "components", "ManageShell.jsx"), "utf8");
    const preferences = readFileSync(join(here, "..", "lib", "shellPreferences.mjs"), "utf8");
    expect(tokens).not.toMatch(leftoverThemeGlass);
    expect(glass).not.toMatch(leftoverThemeGlass);
    expect(glass).toContain('[data-manage-appearance="glass"]');
    expect(glass).toContain('[data-manage-appearance="glass"][data-manage-theme="dark"]');
    expect(glass).toContain(".signal-card");
    expect(glass).toContain(".review-workbench");
    expect(glass).toContain(".agent-metrics");
    expect(glass).not.toMatch(cscOnlySelectors);
    expect(preferences).toContain('"standard"');
    expect(preferences).toContain("Standard");
    expect(shell).toContain("Appearance");
    expect(shell).not.toContain("Harbor");
  });

  it("keeps denser route layout chrome unbranded", () => {
    const routes = readFileSync(join(here, "routes.css"), "utf8");
    expect(routes).toContain(".today-command");
    expect(routes).toContain(".signal-card");
    expect(routes).toContain(".review-workbench");
    expect(routes).toContain(".review-inbox");
    expect(routes).toContain(".agent-metrics");
    expect(routes).not.toMatch(branded);
    expect(routes).not.toMatch(cscOnlySelectors);
  });
});

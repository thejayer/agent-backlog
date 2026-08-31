import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const branded = /Commerce Street|commercestreet|RegVault|RegVault-inspired|CSC-|COM-|Harbor|csc-workspace|csc-crm/i;
const stageTokens = /--stage-(prospecting|holding|active|dd|term|closed)/;

describe("glass theme sources stay unbranded", () => {
  const files = [
    "glass.css",
    join("..", "tokens.css"),
    join("..", "styles.css"),
    join("..", "components", "ManageShell.jsx"),
  ];

  it.each(files)("does not leak branded copy or deal-pipeline stage tokens in %s", (relativePath) => {
    const source = readFileSync(join(here, relativePath), "utf8");
    expect(source).not.toMatch(branded);
    expect(source).not.toMatch(stageTokens);
  });

  it("defines an unbranded glass theme token set", () => {
    const tokens = readFileSync(join(here, "..", "tokens.css"), "utf8");
    const shell = readFileSync(join(here, "..", "components", "ManageShell.jsx"), "utf8");
    expect(tokens).toContain('[data-theme="glass"]');
    expect(shell).toContain('"glass"');
    expect(shell).toContain("Glass");
  });
});

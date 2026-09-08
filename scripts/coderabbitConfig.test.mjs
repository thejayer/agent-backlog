import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(repoRoot, ".coderabbit.yaml");
const CSC_LEAKAGE = /Commerce Street|csc-workspace|csc-crm|CSC-|COM-|commercestreet|Harbor|RegVault|gcloud|linear\.app\/.*COM-|crm-deploy|Cloud Run|BigQuery|COMMERCE-STREET|CSC_ARCHITECTURE|sync-ui|shared-ui|manage\.commercestreet/i;

describe("public CodeRabbit config", () => {
  const source = readFileSync(configPath, "utf8");

  it("stays free of private-org brand and wiring strings", () => {
    expect(source).not.toMatch(CSC_LEAKAGE);
  });

  it("keeps a chill, opt-in, customizable public template", () => {
    expect(source).toContain("inheritance: true");
    expect(source).toMatch(/profile:\s*"chill"/);
    expect(source).toMatch(/enabled:\s*false/);
    expect(source).toContain("coderabbit:review");
    expect(source).toContain("TASK-");
    expect(source).toContain("adjust path_instructions");
    expect(source).toContain("hadolint");
    expect(source).toContain("dotenvLint");
    expect(source).toContain("osvScanner");
    expect(source).toMatch(/poem:\s*false/);
    expect(source).toMatch(/in_progress_fortune:\s*false/);
  });
});

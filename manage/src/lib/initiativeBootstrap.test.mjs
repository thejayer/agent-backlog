import { describe, expect, it } from "vitest";
import { buildInitiativeSuggestion, findInitiativeTemplate, initiativeTemplates } from "./initiativeBootstrap.mjs";

const CSC_LEAKAGE = /Commerce Street|csc-workspace|csc-crm|CSC-|COM-|commercestreet|Harbor|RegVault|gcloud|linear\.app\/.*COM-|crm-io|VDR|RegVault|Compliance/i;

const packets = [
  {
    key: "TASK-410",
    title: "Improve review evidence",
    project: "Web app",
    repo: "web-app",
    labels: ["review", "backlog"],
    desiredOutcome: "Reviewers can verify delivery evidence.",
  },
  {
    key: "TASK-411",
    title: "Persist packet links",
    project: "Web app",
    repo: "web-app",
    labels: ["backlog", "persistence"],
    desiredOutcome: "Packet links survive reloads.",
  },
];

describe("initiative bootstrap suggestions", () => {
  it("exposes a small plain-data template registry without product-specific seeds", () => {
    expect(initiativeTemplates).toHaveLength(3);
    expect(JSON.parse(JSON.stringify(initiativeTemplates))).toEqual(initiativeTemplates);
    expect(initiativeTemplates.map((template) => template.id)).toEqual([
      "delivery-program",
      "platform-hardening",
      "launch-readiness",
    ]);
    expect(findInitiativeTemplate("platform-hardening")?.label).toBe("Platform hardening");
    expect(findInitiativeTemplate("missing")).toBeNull();
    expect(JSON.stringify(initiativeTemplates)).not.toMatch(CSC_LEAKAGE);
  });

  it("combines a template with ordered multi-packet context deterministically", () => {
    const suggestion = buildInitiativeSuggestion({
      templateId: "delivery-program",
      packetKeys: ["TASK-411", "TASK-410", "TASK-411", "missing"],
      packets,
    });

    expect(suggestion).toMatchObject({
      title: "Coordinate a multi-packet delivery outcome",
      packetKeys: ["TASK-411", "TASK-410"],
      labels: ["backlog", "delivery", "initiative", "persistence", "review"],
    });
    expect(suggestion.completionCriteria.at(-1)).toContain("TASK-411, TASK-410");
    expect(suggestion.groupingGuidance).toContain("Web app");
    expect(buildInitiativeSuggestion({
      templateId: "delivery-program",
      packetKeys: ["TASK-411", "TASK-410"],
      packets,
    })).toEqual(suggestion);
    expect(JSON.stringify(suggestion)).not.toMatch(CSC_LEAKAGE);
  });

  it("derives useful suggestions from packet context without a template", () => {
    expect(buildInitiativeSuggestion({ packetKeys: ["TASK-410"], packets })).toMatchObject({
      title: "Advance: Improve review evidence",
      objective: "Coordinate the selected work so that Reviewers can verify delivery evidence.",
      labels: ["backlog", "review"],
      packetKeys: ["TASK-410"],
    });
  });

  it("returns an editable empty suggestion when no source is chosen", () => {
    expect(buildInitiativeSuggestion()).toEqual({
      title: "",
      objective: "",
      completionCriteria: [],
      labels: [],
      groupingGuidance: "",
      packetKeys: [],
    });
  });
});

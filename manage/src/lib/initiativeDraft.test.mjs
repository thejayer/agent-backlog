import { describe, expect, it } from "vitest";
import { completionCriteriaText, initiativeDraft, initiativeLabelsText } from "./initiativeDraft.mjs";

describe("initiative editor draft", () => {
  it("formats persisted completion criteria arrays for the textarea", () => {
    expect(completionCriteriaText(["First gate", "Second gate"])).toBe("First gate\nSecond gate");
  });

  it("preserves the optimistic string shape used while an initiative save is pending", () => {
    const optimistic = initiativeDraft({
      id: "initiative-1",
      completionCriteria: "First gate\nSecond gate",
    });

    expect(optimistic.completionCriteria).toBe("First gate\nSecond gate");
  });

  it("trims scalar completion criteria consistently with persisted array entries", () => {
    expect(completionCriteriaText("  First gate\nSecond gate  ")).toBe("First gate\nSecond gate");
  });

  it("remains stable across optimistic and persisted save responses", () => {
    const initial = initiativeDraft({
      id: "initiative-1",
      completionCriteria: ["First gate", "Second gate"],
    });
    const optimistic = initiativeDraft({
      ...initial,
      completionCriteria: initial.completionCriteria,
    });
    const persisted = initiativeDraft({
      ...optimistic,
      completionCriteria: ["First gate", "Second gate"],
    });

    expect(initial).toEqual(optimistic);
    expect(persisted.completionCriteria).toBe(initial.completionCriteria);
  });

  it("uses an empty textarea value when criteria are missing", () => {
    expect(completionCriteriaText(null)).toBe("");
    expect(completionCriteriaText(undefined)).toBe("");
  });

  it("formats persisted labels and initializes new metadata fields", () => {
    expect(initiativeLabelsText(["backlog", "delivery"])).toBe("backlog, delivery");
    expect(initiativeDraft({ labels: ["backlog"], groupingGuidance: null })).toMatchObject({
      labels: "backlog",
      groupingGuidance: "",
    });
  });
});

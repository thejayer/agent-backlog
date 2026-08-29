import { describe, expect, it } from "vitest";
import { evaluateAgentCompatibility } from "./agentRunContract.mjs";

describe("evaluateAgentCompatibility", () => {
  it("accepts a current bootstrap compatibility block", () => {
    expect(evaluateAgentCompatibility({
      compatibility: {
        contractVersion: 1,
        minimumCliContractVersion: 1,
        lifecycleBasePath: "/api/agent",
        createTaskPath: "/api/agent/tasks",
      },
    })).toMatchObject({
      ok: true,
      createTaskPath: "/api/agent/tasks",
      lifecycleBasePath: "/api/agent",
    });
  });

  it("fails closed without compatibility metadata using generic language", () => {
    expect(() => evaluateAgentCompatibility({})).toThrow(/did not publish agent compatibility metadata/);
    expect(() => evaluateAgentCompatibility({})).not.toThrow(/csc-workspace|origin\/master|commercestreet/i);
  });
});

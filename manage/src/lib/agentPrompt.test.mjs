import { describe, expect, it } from "vitest";
import { buildAgentBootstrap } from "./agentPrompt.mjs";

const CSC_LEAKAGE = /Commerce Street|csc-workspace|csc-crm|CSC-|COM-|commercestreet|Harbor|RegVault|gcloud|linear\.app\/.*COM-/i;

describe("agent bootstrap", () => {
  it("advertises packet room endpoints without CSC leakage", () => {
    const bootstrap = buildAgentBootstrap({
      baseUrl: "https://board.example.test",
    });

    expect(bootstrap.endpoints.events).toBe("https://board.example.test/api/agent/tasks/{key}/events");
    expect(bootstrap.endpoints.heartbeat).toBe("https://board.example.test/api/agent/tasks/{key}/heartbeat");
    expect(bootstrap.endpoints.githubSignals).toBe("https://board.example.test/api/packet-events/github");
    expect(JSON.stringify(bootstrap)).not.toMatch(CSC_LEAKAGE);
  });
});

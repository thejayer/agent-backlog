import { describe, expect, it } from "vitest";
import { buildInitiativeReleaseTimeline } from "./releaseTimeline.mjs";

const CSC_LEAKAGE = /Commerce Street|csc-workspace|csc-crm|CSC-|COM-|commercestreet|Harbor|RegVault|gcloud|linear\.app\/.*COM-/i;

describe("initiative release timeline", () => {
  const initiative = { id: "initiative-1", packetKeys: ["TASK-201"] };
  const items = [
    {
      key: "TASK-201",
      title: "Ship initiative timeline",
      repo: "web-app",
      status: "done",
      completedAt: "2026-07-10T16:00:00.000Z",
      githubPrUrl: "https://github.com/your-org/web-app/pull/80",
      githubBranch: "codex/task-201-release-timeline",
    },
    {
      key: "TASK-202",
      title: "Unrelated packet",
      repo: "web-app",
      status: "done",
      completedAt: "2026-07-10T17:00:00.000Z",
    },
  ];

  it("combines completion, merge, and deployment events for linked packets", () => {
    const githubCache = {
      repos: [
        {
          id: "web-app",
          slug: "your-org/web-app",
          defaultBranch: "main",
          mergedPulls: [
            {
              number: 80,
              title: "TASK-201: Ship initiative timeline",
              url: "https://github.com/your-org/web-app/pull/80",
              branch: "codex/task-201-release-timeline",
              baseBranch: "main",
              mergedAt: "2026-07-10T16:30:00.000Z",
              mergeCommitSha: "merge-201",
            },
          ],
          deploymentWorkflowRuns: [
            {
              id: 900,
              name: "Deploy web-app",
              conclusion: "success",
              branch: "main",
              headSha: "merge-201",
              url: "https://github.com/your-org/web-app/actions/runs/900",
              updatedAt: "2026-07-10T16:45:00.000Z",
            },
          ],
        },
      ],
    };

    const timeline = buildInitiativeReleaseTimeline({ initiative, items, githubCache });

    expect(timeline.map((event) => event.type)).toEqual(["deployment", "pull_request", "packet"]);
    expect(timeline.every((event) => event.packetKeys.includes("TASK-201"))).toBe(true);
    expect(timeline.some((event) => event.packetKeys.includes("TASK-202"))).toBe(false);
    expect(JSON.stringify(timeline)).not.toMatch(CSC_LEAKAGE);
  });

  it("uses the nearest recent merge for a successful default-branch deployment", () => {
    const githubCache = {
      repos: [
        {
          id: "web-app",
          defaultBranch: "main",
          mergedPulls: [
            {
              number: 80,
              title: "TASK-201 release timeline",
              branch: "codex/task-201-release-timeline",
              baseBranch: "main",
              mergedAt: "2026-07-10T16:30:00.000Z",
            },
          ],
          deploymentWorkflowRuns: [
            {
              id: 901,
              name: "Production release",
              conclusion: "success",
              branch: "main",
              updatedAt: "2026-07-10T17:00:00.000Z",
            },
          ],
        },
      ],
    };

    const timeline = buildInitiativeReleaseTimeline({ initiative, items, githubCache });
    expect(timeline.find((event) => event.type === "deployment")?.packetKeys).toEqual(["TASK-201"]);
  });

  it("ignores nearest merges into a non-default base branch for default-branch deployments", () => {
    const githubCache = {
      repos: [
        {
          id: "web-app",
          defaultBranch: "main",
          mergedPulls: [
            {
              number: 81,
              title: "TASK-201 release timeline",
              branch: "codex/task-201-release-timeline",
              baseBranch: "develop",
              mergedAt: "2026-07-10T16:30:00.000Z",
            },
          ],
          deploymentWorkflowRuns: [
            {
              id: 902,
              name: "Production release",
              conclusion: "success",
              branch: "main",
              updatedAt: "2026-07-10T17:00:00.000Z",
            },
          ],
        },
      ],
    };

    const timeline = buildInitiativeReleaseTimeline({ initiative, items, githubCache });
    expect(timeline.some((event) => event.type === "deployment")).toBe(false);
  });

  it("omits incomplete packets and unrelated GitHub activity", () => {
    const timeline = buildInitiativeReleaseTimeline({
      initiative: { packetKeys: ["TASK-201"] },
      items: [{ ...items[0], status: "needs_review" }],
      githubCache: {
        repos: [
          {
            id: "web-app",
            defaultBranch: "main",
            mergedPulls: [
              {
                number: 80,
                title: "TASK-201: Ship initiative timeline",
                url: "https://github.com/your-org/web-app/pull/80",
                branch: "codex/task-201-release-timeline",
                baseBranch: "main",
                mergedAt: "2026-07-10T16:30:00.000Z",
                mergeCommitSha: "merge-201",
              },
            ],
            deploymentWorkflowRuns: [
              {
                id: 900,
                name: "Deploy web-app",
                conclusion: "success",
                branch: "main",
                headSha: "merge-201",
                updatedAt: "2026-07-10T16:45:00.000Z",
              },
            ],
          },
        ],
      },
    });

    expect(timeline).toEqual([]);
  });
});

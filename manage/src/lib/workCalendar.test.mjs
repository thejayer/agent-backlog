import { describe, expect, it } from "vitest";
import { availableWorkYears, buildWorkCalendar, localDateKey } from "./workCalendar.mjs";

const CSC_LEAKAGE = /Commerce Street|csc-workspace|CSC-|COM-|Harbor|RegVault|csc-crm-io|commercestreet/i;

describe("work calendar", () => {
  const items = [
    {
      key: "TASK-201",
      title: "Ship calendar",
      repo: "web-app",
      status: "done",
      completedAt: "2026-07-10T15:00:00.000Z",
      updatedAt: "2026-07-10T15:00:00.000Z",
      githubPrUrl: "https://github.com/your-org/web-app/pull/80",
    },
    {
      key: "TASK-202",
      title: "Still reviewing",
      repo: "api-service",
      status: "needs_review",
      updatedAt: "2026-07-10T16:00:00.000Z",
    },
    {
      key: "TASK-203",
      title: "Done without completedAt",
      repo: "docs-site",
      status: "done",
      lastAgentUpdate: { status: "done", at: "2026-07-10T14:30:00.000Z" },
      githubLinks: {
        pullRequests: [{ url: "https://github.com/your-org/docs-site/pull/12" }],
      },
    },
  ];
  const githubCache = {
    repos: [
      {
        id: "web-app",
        slug: "your-org/web-app",
        mergedPulls: [
          {
            number: 80,
            title: "TASK-201 ship calendar",
            url: "https://github.com/your-org/web-app/pull/80",
            mergedAt: "2026-07-10T16:00:00.000Z",
          },
          {
            number: 79,
            title: "Older work",
            url: "https://github.com/your-org/web-app/pull/79",
            mergedAt: "2025-12-20T16:00:00.000Z",
          },
        ],
      },
      {
        id: "docs-site",
        slug: "your-org/docs-site",
        mergedPulls: [
          {
            number: 12,
            title: "TASK-203 docs closeout",
            url: "https://github.com/your-org/docs-site/pull/12",
            mergedAt: "2026-07-10T14:45:00.000Z",
          },
        ],
      },
    ],
  };

  it("groups completed packets and merged PRs into drill-down days", () => {
    const calendar = buildWorkCalendar({ items, githubCache, year: 2026 });
    const selectedDay = calendar.days.find((day) => day.key === localDateKey("2026-07-10T16:00:00.000Z"));

    expect(selectedDay.packets.map((packet) => packet.key)).toEqual(["TASK-201", "TASK-203"]);
    expect(selectedDay.pullRequests.map((pullRequest) => `${pullRequest.repo}#${pullRequest.number}`)).toEqual([
      "docs-site#12",
      "web-app#80",
    ]);
    expect(selectedDay.pullRequests.find((pullRequest) => pullRequest.number === 80).linkedPacketKeys).toEqual(["TASK-201"]);
    expect(selectedDay.pullRequests.find((pullRequest) => pullRequest.number === 12).linkedPacketKeys).toEqual(["TASK-203"]);
    expect(selectedDay.count).toBe(4);
    expect(selectedDay.intensity).toBe(4);
    expect(calendar.totals).toEqual({ packets: 2, pullRequests: 2, activeDays: 1 });
    expect(JSON.stringify(calendar)).not.toMatch(CSC_LEAKAGE);
  });

  it("builds full Sunday-to-Saturday weeks and ignores non-done packets", () => {
    const calendar = buildWorkCalendar({ items, githubCache, year: 2026 });

    expect(calendar.weeks[0][0].date.getDay()).toBe(0);
    expect(calendar.weeks.at(-1).at(-1).date.getDay()).toBe(6);
    expect(calendar.weeks.every((week) => week.length === 7)).toBe(true);
    expect(calendar.days.flatMap((day) => day.packets).some((packet) => packet.key === "TASK-202")).toBe(false);
  });

  it("prefers completedAt over later writeback timestamps", () => {
    const calendar = buildWorkCalendar({
      items: [
        {
          key: "TASK-210",
          title: "Stamped completion",
          repo: "web-app",
          status: "done",
          completedAt: "2026-03-02T09:00:00.000Z",
          lastAgentUpdate: { status: "done", at: "2026-07-10T15:00:00.000Z" },
          updatedAt: "2026-07-10T15:00:00.000Z",
        },
      ],
      year: 2026,
    });

    expect(calendar.days.find((day) => day.key === localDateKey("2026-03-02T09:00:00.000Z")).packets.map((packet) => packet.key)).toEqual([
      "TASK-210",
    ]);
    expect(calendar.days.find((day) => day.key === localDateKey("2026-07-10T15:00:00.000Z"))?.packets || []).toEqual([]);
  });

  it("lists years with recorded work plus the current fallback", () => {
    expect(availableWorkYears(items, githubCache, 2027)).toEqual([2027, 2026, 2025]);
  });
});

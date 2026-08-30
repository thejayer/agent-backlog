function parseTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function localDateKey(value) {
  const date = value instanceof Date ? value : parseTimestamp(value);

  if (!date) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function packetCompletedAt(item) {
  if (item?.status !== "done") {
    return "";
  }

  if (item.completedAt) {
    return item.completedAt;
  }

  if (item.lastAgentUpdate?.status === "done" && item.lastAgentUpdate.at) {
    return item.lastAgentUpdate.at;
  }

  return item.updatedAt || item.createdAt || "";
}

function pullRequestKey(repo, pullRequest) {
  return pullRequest.url || `${repo.id || repo.slug || "repo"}#${pullRequest.number || "unknown"}`;
}

function collectMergedPullRequests(githubCache) {
  const seen = new Set();
  const pullRequests = [];

  for (const repo of githubCache?.repos || []) {
    for (const pullRequest of repo.mergedPulls || []) {
      if (!pullRequest?.mergedAt) {
        continue;
      }

      const id = pullRequestKey(repo, pullRequest);

      if (seen.has(id)) {
        continue;
      }

      seen.add(id);
      pullRequests.push({
        ...pullRequest,
        id,
        repo: repo.id || repo.name || repo.slug || "Unknown repo",
        repoSlug: repo.slug || "",
      });
    }
  }

  return pullRequests;
}

function packetPrUrls(packet) {
  return new Set(
    [
      packet.githubPrUrl,
      ...(Array.isArray(packet.githubLinks?.pullRequests)
        ? packet.githubLinks.pullRequests.map((pullRequest) => pullRequest?.url)
        : []),
    ].filter(Boolean),
  );
}

function makeDay(date, year) {
  const inYear = date.getFullYear() === year;

  return {
    key: localDateKey(date),
    date: new Date(date),
    inYear,
    packets: [],
    pullRequests: [],
    count: 0,
    intensity: 0,
  };
}

function buildGrid(year) {
  const firstDay = new Date(year, 0, 1);
  const lastDay = new Date(year, 11, 31);
  const gridStart = new Date(year, 0, 1 - firstDay.getDay());
  const gridEnd = new Date(year, 11, 31 + (6 - lastDay.getDay()));
  const weeks = [];

  for (
    let cursor = new Date(gridStart);
    cursor <= gridEnd;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
  ) {
    if (cursor.getDay() === 0) {
      weeks.push([]);
    }

    weeks[weeks.length - 1].push(makeDay(cursor, year));
  }

  return weeks;
}

function monthLabels(weeks, year) {
  const labels = [];
  let previousMonth = -1;

  weeks.forEach((week, index) => {
    const firstInYear = week.find((day) => day.inYear);

    if (!firstInYear || firstInYear.date.getMonth() === previousMonth) {
      return;
    }

    previousMonth = firstInYear.date.getMonth();
    labels.push({
      month: firstInYear.date.toLocaleDateString(undefined, { month: "short" }),
      weekIndex: index,
    });
  });

  return labels;
}

export function availableWorkYears(items = [], githubCache = null, fallbackYear = new Date().getFullYear()) {
  const years = new Set([fallbackYear]);

  for (const item of items) {
    const date = parseTimestamp(packetCompletedAt(item));
    if (date) years.add(date.getFullYear());
  }

  for (const pullRequest of collectMergedPullRequests(githubCache)) {
    const date = parseTimestamp(pullRequest.mergedAt);
    if (date) years.add(date.getFullYear());
  }

  return [...years].sort((a, b) => b - a);
}

export function buildWorkCalendar({ items = [], githubCache = null, year = new Date().getFullYear() } = {}) {
  const weeks = buildGrid(year);
  const daysByKey = new Map(weeks.flat().filter((day) => day.inYear).map((day) => [day.key, day]));
  const completedPackets = items
    .filter((item) => item?.status === "done")
    .map((item) => ({ ...item, completedAt: packetCompletedAt(item) }))
    .filter((item) => item.completedAt);
  const mergedPullRequests = collectMergedPullRequests(githubCache);

  for (const packet of completedPackets) {
    const day = daysByKey.get(localDateKey(packet.completedAt));
    if (day) day.packets.push(packet);
  }

  for (const pullRequest of mergedPullRequests) {
    const day = daysByKey.get(localDateKey(pullRequest.mergedAt));
    if (day) {
      day.pullRequests.push({
        ...pullRequest,
        linkedPacketKeys: completedPackets
          .filter((packet) => packetPrUrls(packet).has(pullRequest.url))
          .map((packet) => packet.key),
      });
    }
  }

  const days = [...daysByKey.values()];
  const maxCount = Math.max(0, ...days.map((day) => day.packets.length + day.pullRequests.length));

  for (const day of days) {
    day.packets.sort((a, b) => String(a.key).localeCompare(String(b.key)));
    day.pullRequests.sort((a, b) => String(a.repo).localeCompare(String(b.repo)) || Number(a.number) - Number(b.number));
    day.count = day.packets.length + day.pullRequests.length;
    day.intensity = day.count === 0 || maxCount === 0 ? 0 : Math.max(1, Math.ceil((day.count / maxCount) * 4));
  }

  const activeDays = days.filter((day) => day.count > 0);
  const busiestDay = activeDays.reduce((busiest, day) => (!busiest || day.count > busiest.count ? day : busiest), null);

  return {
    year,
    weeks,
    days,
    monthLabels: monthLabels(weeks, year),
    totals: {
      packets: completedPackets.filter((packet) => parseTimestamp(packet.completedAt)?.getFullYear() === year).length,
      pullRequests: mergedPullRequests.filter((pullRequest) => parseTimestamp(pullRequest.mergedAt)?.getFullYear() === year).length,
      activeDays: activeDays.length,
    },
    maxCount,
    busiestDay,
  };
}

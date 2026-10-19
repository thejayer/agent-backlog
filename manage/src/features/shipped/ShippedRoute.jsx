import React, { useMemo, useState } from "react";
import { Icon } from "../../components/Icon.jsx";
import { availableWorkYears, buildWorkCalendar } from "../../lib/workCalendar.mjs";

export function ShippedMetric({ label, value, note }) {
  return (
    <article className="shipped-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

export function ShippedOverview({
  items,
  githubCache,
  githubState,
  githubMessage,
  onOpenPacket,
  onSync,
  onMockSync,
}) {
  const currentYear = new Date().getFullYear();
  const years = useMemo(() => availableWorkYears(items, githubCache, currentYear), [items, githubCache, currentYear]);
  const [year, setYear] = useState(currentYear);
  const [selectedDayKey, setSelectedDayKey] = useState("");
  const calendar = useMemo(() => buildWorkCalendar({ items, githubCache, year }), [items, githubCache, year]);
  const latestActiveDay = [...calendar.days].reverse().find((day) => day.count > 0);
  const selectedDay = calendar.days.find((day) => day.key === selectedDayKey) || latestActiveDay || calendar.days[0];
  const selectedDateLabel = selectedDay?.date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  function changeYear(nextYear) {
    const numericYear = Number(nextYear);
    const nextCalendar = buildWorkCalendar({ items, githubCache, year: numericYear });
    const nextSelectedDay = [...nextCalendar.days].reverse().find((day) => day.count > 0) || nextCalendar.days[0];
    setYear(numericYear);
    setSelectedDayKey(nextSelectedDay.key);
  }

  return (
    <section className="shipped-route" aria-label="Shipped work calendar">
      <div className="shipped-summary-grid">
        <ShippedMetric label="Completed packets" value={calendar.totals.packets} note={`Marked done in ${year}`} />
        <ShippedMetric label="Merged PRs" value={calendar.totals.pullRequests} note={`Across ${githubCache?.repos?.length || 0} repositories`} />
        <ShippedMetric label="Active days" value={calendar.totals.activeDays} note="Days with shipped work" />
      </div>

      <section className="shipped-calendar-panel" aria-label={`${year} work calendar`}>
        <div className="shipped-panel-head">
          <div>
            <span className="section-kicker">Contribution calendar</span>
            <h2>{year} shipping activity</h2>
            <p>Each square combines completed work packets and pull requests merged on that day.</p>
          </div>
          <div className="shipped-calendar-toolbar">
            <div className="shipped-calendar-actions">
              <label className="shell-control shipped-year-control">
                <span>Year</span>
                <select aria-label="Shipped year" value={year} onChange={(event) => changeYear(event.target.value)}>
                  {years.map((availableYear) => (
                    <option key={availableYear} value={availableYear}>{availableYear}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="button secondary" onClick={onSync} disabled={githubState === "syncing"}>
                {githubState === "syncing" ? "Syncing GitHub" : "Refresh GitHub"}
              </button>
              <button type="button" className="button secondary" onClick={onMockSync} disabled={githubState === "syncing"}>
                Mock sync
              </button>
            </div>
            <div
              className={`shipped-sync-status ${githubState === "failed" ? "is-failed" : ""}`}
              role={githubState === "failed" ? "alert" : "status"}
            >
              {githubMessage}
            </div>
          </div>
        </div>

        <div className="contribution-scroll">
          <div className="contribution-months" style={{ "--calendar-weeks": calendar.weeks.length }} aria-hidden="true">
            {calendar.monthLabels.map((label) => (
              <span key={`${label.month}-${label.weekIndex}`} style={{ gridColumnStart: label.weekIndex + 1 }}>{label.month}</span>
            ))}
          </div>
          <div className="contribution-chart">
            <div className="contribution-weekdays" aria-hidden="true">
              <span />
              <span>Mon</span>
              <span />
              <span>Wed</span>
              <span />
              <span>Fri</span>
              <span />
            </div>
            <div className="contribution-weeks" style={{ "--calendar-weeks": calendar.weeks.length }}>
              {calendar.weeks.map((week) => (
                <div className="contribution-week" key={week[0].key}>
                  {week.map((day) => {
                    if (!day.inYear) {
                      return <span className="contribution-day is-outside" key={day.key} aria-hidden="true" />;
                    }

                    const dateLabel = day.date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
                    const recordLabel = `${day.count} work ${day.count === 1 ? "record" : "records"}`;

                    return (
                      <button
                        type="button"
                        className={`contribution-day ${selectedDay?.key === day.key ? "is-selected" : ""}`}
                        data-level={day.intensity}
                        key={day.key}
                        aria-label={`${dateLabel}: ${recordLabel}`}
                        title={`${dateLabel} · ${recordLabel}`}
                        onClick={() => setSelectedDayKey(day.key)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="contribution-foot">
          <span>{latestActiveDay ? `Latest activity ${latestActiveDay.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "No activity recorded"}</span>
          <div className="contribution-legend" aria-label="Calendar intensity legend">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((level) => <i key={level} data-level={level} />)}
            <span>More</span>
          </div>
        </div>
      </section>

      <section className="shipped-day-panel" aria-label="Selected day details">
        <div className="shipped-day-head">
          <div>
            <span className="section-kicker">Day detail</span>
            <h2>{selectedDateLabel}</h2>
          </div>
          <span className="shipped-day-total">{selectedDay?.count || 0} shipped</span>
        </div>

        {selectedDay?.count ? (
          <div className="shipped-detail-grid">
            <section aria-label="Completed packets">
              <div className="shipped-detail-heading">
                <h3>Completed packets</h3>
                <span>{selectedDay.packets.length}</span>
              </div>
              <div className="shipped-item-list">
                {selectedDay.packets.length ? selectedDay.packets.map((packet) => (
                  <button type="button" className="shipped-item shipped-packet" key={packet.key} onClick={() => onOpenPacket(packet.key)}>
                    <span className="shipped-item-key">{packet.key}</span>
                    <strong>{packet.title}</strong>
                    <small>{packet.repo} · Open packet</small>
                  </button>
                )) : <div className="shipped-empty">No packets were marked done on this day.</div>}
              </div>
            </section>

            <section aria-label="Merged pull requests">
              <div className="shipped-detail-heading">
                <h3>Merged pull requests</h3>
                <span>{selectedDay.pullRequests.length}</span>
              </div>
              <div className="shipped-item-list">
                {selectedDay.pullRequests.length ? selectedDay.pullRequests.map((pullRequest) => (
                  <div className="shipped-item shipped-pr" key={pullRequest.id}>
                    <span className="shipped-item-key">{pullRequest.repo} #{pullRequest.number}</span>
                    <a href={pullRequest.url} target="_blank" rel="noreferrer">{pullRequest.title}</a>
                    <small>
                      {pullRequest.author ? `Opened by ${pullRequest.author}` : "Author not recorded"}
                    </small>
                    {pullRequest.linkedPacketKeys.length ? (
                      <div className="shipped-linked-packets">
                        {pullRequest.linkedPacketKeys.map((key) => (
                          <button
                            type="button"
                            className="shipped-packet-link"
                            key={key}
                            onClick={() => onOpenPacket(key)}
                          >
                            {key}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )) : <div className="shipped-empty">No pull requests were merged on this day.</div>}
              </div>
            </section>
          </div>
        ) : (
          <div className="shipped-day-empty">
            <Icon name="calendar" />
            <strong>No shipped work recorded</strong>
            <span>Select a darker square to inspect a day with completed packets or merged PRs.</span>
          </div>
        )}
      </section>
    </section>
  );
}

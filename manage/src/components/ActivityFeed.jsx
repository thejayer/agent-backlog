import React from "react";
import { Icon } from "./Icon.jsx";
import { activityIcon, activityTone, formatAgentEventLabel, formatRelativeTime } from "../lib/manageFormat.mjs";

export function ActivityFeed({ events, onOpenPacket }) {
  if (events.length === 0) {
    return <div className="overview-empty">No agent events yet.</div>;
  }

  return (
    <div className="activity-feed">
      {events.map((event) => (
        <button
          type="button"
          className="activity-item"
          key={`${event.key}-${event.type}-${event.at}`}
          onClick={() => onOpenPacket(event.key)}
        >
          <span className={`activity-dot ad-${activityTone(event.type, event.status)}`}>
            <Icon name={activityIcon(event.type, event.status)} />
          </span>
          <span className="activity-body">
            <span className="ab-head">
              <span className="ab-key">{event.key}</span>
              <span className="ab-type">{formatAgentEventLabel(event)}</span>
              <span className="ab-time">{formatRelativeTime(event.at)}</span>
            </span>
            <span className="ab-note">{event.note || event.title}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

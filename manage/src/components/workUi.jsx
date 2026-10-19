import React from "react";
import { Icon } from "./Icon.jsx";
import { formatPriority, formatStatus, getStatusTone } from "../lib/manageFormat.mjs";
import { normalizeLabel } from "../features/backlog/useBacklogController.mjs";

export function Metric({ label, value, tone }) {
  return (
    <article className={`metric metric-${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </article>
  );
}

export function Section({ title, children }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function CheckList({ items }) {
  return (
    <ul className="check-list">
      {items.map((item) => (
        <li key={item}>
          <Icon name="check" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function CodeList({ items }) {
  return (
    <div className="code-list">
      {items.map((item) => (
        <code key={item}>{item}</code>
      ))}
    </div>
  );
}

export function LabelList({ labels, compact = false }) {
  const normalizedLabels = [...new Set((labels || []).map(normalizeLabel).filter(Boolean))];

  if (normalizedLabels.length === 0) {
    return compact ? null : <p className="empty-labels">No labels recorded.</p>;
  }

  return (
    <div className={`label-list ${compact ? "is-compact" : ""}`}>
      {normalizedLabels.map((label) => (
        <span key={label} className="label-chip">
          #{label}
        </span>
      ))}
    </div>
  );
}

export function PriorityFlag({ priority }) {
  const tone = priority === "urgent" || priority === "high" ? "high" : priority === "low" ? "low" : "medium";

  return (
    <span className={`priority-flag pf-${tone}`}>
      <span className="pf-dot" />
      {formatPriority(priority)}
    </span>
  );
}

export function StatusPill({ status }) {
  return <span className={`status-pill status-${getStatusTone(status)}`}>{formatStatus(status)}</span>;
}

export function Readiness({ value }) {
  return (
    <span className="readiness" style={{ "--readiness": `${value}%` }}>
      <span />
      {value}%
    </span>
  );
}

export function Endpoint({ label, value }) {
  return (
    <div className="endpoint">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  );
}

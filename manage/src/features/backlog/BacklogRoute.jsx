import React from "react";
import { priorityOptions, repositories, statusOptions } from "../../data/workItems.mjs";
import { readinessScore } from "../../lib/agentPrompt.mjs";
import { formatLabel, itemLabels } from "./useBacklogController.mjs";

const repoOptions = repositories.map((repo) => repo.id);

function formatPriority(priorityId) {
  return priorityOptions.find((priority) => priority.id === priorityId)?.label || priorityId;
}

function statusTone(statusId) {
  return statusOptions.find((status) => status.id === statusId)?.tone || "muted";
}

function statusLabel(statusId) {
  return statusOptions.find((status) => status.id === statusId)?.label || statusId;
}

function BacklogStatusPill({ status }) {
  return <span className={`status-pill status-${statusTone(status)}`}>{statusLabel(status)}</span>;
}

function BacklogPriorityFlag({ priority }) {
  const tone = priority === "urgent" || priority === "high" ? "high" : priority === "low" ? "low" : "medium";

  return (
    <span className={`priority-flag pf-${tone}`}>
      <span className="pf-dot" />
      {formatPriority(priority)}
    </span>
  );
}

function BacklogReadiness({ value }) {
  return (
    <span className="readiness" style={{ "--readiness": `${value}%` }}>
      <span />
      {value}%
    </span>
  );
}

function BacklogLabelList({ labels }) {
  const normalized = itemLabels({ labels });
  if (normalized.length === 0) return null;

  return (
    <div className="label-list is-compact">
      {normalized.map((label) => (
        <span key={label} className="label-chip">
          #{label}
        </span>
      ))}
    </div>
  );
}

export function BacklogRoute({ items, controller, IconComponent, savedViewControls, detail, agent, formatRelativeTime }) {
  const {
    query,
    setQuery,
    repoFilter,
    setRepoFilter,
    statusFilter,
    setStatusFilter,
    labelFilter,
    setLabelFilter,
    filteredItems,
    availableLabels,
    selectedItem,
    setSelectedKey,
  } = controller;

  return (
    <section className="content-grid">
      <section className="backlog-panel" aria-label="Backlog">
        <div className="panel-header">
          <div>
            <h2>Backlog</h2>
            <p>
              {filteredItems.length} work packets across {repositories.length} repos
            </p>
          </div>
          <div className="filters">
            <label>
              <span>Repo</span>
              <select aria-label="Repo" value={repoFilter} onChange={(event) => setRepoFilter(event.target.value)}>
                <option value="all">All repos</option>
                {repoOptions.map((repo) => (
                  <option key={repo} value={repo}>
                    {repo}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select aria-label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                {statusOptions.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Label</span>
              <select aria-label="Label" value={labelFilter} onChange={(event) => setLabelFilter(event.target.value)}>
                <option value="all">All labels</option>
                {availableLabels.map((label) => (
                  <option key={label} value={label}>
                    {formatLabel(label)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {savedViewControls}

        <label className="search-box">
          <IconComponent name="search" />
          <input
            aria-label="Search packets"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search packets, labels, projects, repos..."
          />
        </label>

        <div className="work-list">
          {filteredItems.length === 0 ? (
            <div className="overview-empty">No packets match the current filters.</div>
          ) : (
            filteredItems.map((item) => (
              <button
                type="button"
                key={item.key}
                className={`work-row ${selectedItem.key === item.key ? "is-selected" : ""}`}
                onClick={() => setSelectedKey(item.key)}
              >
                <div className="row-main">
                  <div className="row-title">
                    <span className="work-key">{item.key}</span>
                    <span className="row-title-text">{item.title}</span>
                  </div>
                  <div className="row-meta">
                    <BacklogPriorityFlag priority={item.priority} />
                    <span>{item.repo}</span>
                    <span>{formatRelativeTime(item.updatedAt)}</span>
                  </div>
                  <BacklogLabelList labels={item.labels} />
                </div>
                <div className="row-side">
                  <BacklogStatusPill status={item.status} />
                  <BacklogReadiness value={readinessScore(item)} />
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {detail}
      {agent}
    </section>
  );
}

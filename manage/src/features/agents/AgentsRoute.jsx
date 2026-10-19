import React, { useState } from "react";
import { ActivityFeed } from "../../components/ActivityFeed.jsx";
import { StatusPill } from "../../components/workUi.jsx";
import {
  agentInitials,
  buildActivityFeed,
  formatRelativeTime,
  leaseProgress,
  leaseSummary,
} from "../../lib/manageFormat.mjs";

export function AgentsOverview({ items, activeClaims, onOpenPacket, onRecoverRun }) {
  const [agentFilter, setAgentFilter] = useState("all");
  const roster = ["Codex", "Claude Code"].map((agent) => ({
    agent,
    active: activeClaims.filter((item) => item.claimedBy === agent || (item.agent === agent && item.status !== "done")).length,
    assigned: items.filter((item) => item.agent === agent).length,
  }));
  const activity = buildActivityFeed(items, 6);
  const visibleClaims = agentFilter === "all"
    ? activeClaims
    : activeClaims.filter((item) => item.claimedBy === agentFilter || item.agent === agentFilter);
  const reviewCount = items.filter((item) => item.status === "needs_review").length;
  const blockedCount = items.filter((item) => item.status === "blocked").length;

  return (
    <section className="agents-route" aria-label="Agent activity">
      <div className="agent-metrics" aria-label="Agent operating metrics">
        <div><span>Active runs</span><strong>{activeClaims.length}</strong><small>Currently executing</small></div>
        <div><span>Assigned</span><strong>{items.filter((item) => item.agent).length}</strong><small>Across the backlog</small></div>
        <div><span>Ready for review</span><strong>{reviewCount}</strong><small>Awaiting sign-off</small></div>
        <div><span>Blocked</span><strong>{blockedCount}</strong><small>Needs intervention</small></div>
      </div>

      <div className="overview-panel agents-main">
        <div className="section-title-row">
          <div>
            <span className="section-kicker">Execution</span>
            <h2>Live runs</h2>
            <p>{visibleClaims.length} running or claimed packet{visibleClaims.length === 1 ? "" : "s"}</p>
          </div>
          <div className="agent-filter" role="group" aria-label="Filter agent runs">
            {["all", "Codex", "Claude Code"].map((agent) => (
              <button
                type="button"
                key={agent}
                className={agentFilter === agent ? "is-active" : ""}
                aria-pressed={agentFilter === agent}
                onClick={() => setAgentFilter(agent)}
              >
                {agent === "all" ? "All" : agent}
              </button>
            ))}
          </div>
        </div>
        {visibleClaims.length === 0 ? (
          <div className="overview-empty">No active claims. Claimed packets and leases will appear here.</div>
        ) : (
          <div className="agent-claims">
            {visibleClaims.map((item) => (
              <AgentClaimCard key={item.key} item={item} onOpenPacket={onOpenPacket} onRecoverRun={onRecoverRun} />
            ))}
          </div>
        )}
      </div>

      <aside className="agents-side">
        <section className="overview-panel">
          <div className="section-title-row">
            <div>
              <h2>Roster</h2>
              <p>Assigned and active work by agent.</p>
            </div>
          </div>
          <div className="roster-list">
            {roster.map((entry) => (
              <button
                type="button"
                className={`roster-row ${agentFilter === entry.agent ? "is-selected" : ""}`}
                key={entry.agent}
                aria-pressed={agentFilter === entry.agent}
                onClick={() => setAgentFilter(entry.agent)}
              >
                <div className="roster-avatar">{agentInitials(entry.agent)}</div>
                <div>
                  <strong>{entry.agent}</strong>
                  <span>{entry.assigned} assigned / {entry.active} running</span>
                </div>
                <b>{entry.active}</b>
              </button>
            ))}
          </div>
        </section>

        <section className="overview-panel" aria-label="Agent recent activity">
          <div className="section-title-row">
            <div>
              <h2>Recent activity</h2>
              <p>{activity.length} latest lifecycle event{activity.length === 1 ? "" : "s"}.</p>
            </div>
          </div>
          {activity.length > 0 ? (
            <ActivityFeed events={activity} onOpenPacket={onOpenPacket} />
          ) : activeClaims.length > 0 ? (
            <div className="active-run-list is-sidebar">
              {activeClaims.slice(0, 3).map((item) => (
                <button type="button" key={item.key} onClick={() => onOpenPacket(item.key)}>
                  <span className="run-pulse" />
                  <span>
                    <small>{item.claimedBy || item.agent || "Agent"} · {item.key}</small>
                    <strong>{item.title}</strong>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <ActivityFeed events={activity} onOpenPacket={onOpenPacket} />
          )}
        </section>
      </aside>
    </section>
  );
}

export function AgentClaimCard({ item, onOpenPacket, onRecoverRun }) {
  const leasePct = leaseProgress(item);
  const lease = leaseSummary(item);
  const health = item.agentRunHealth;

  return (
    <article className="claim-card">
      <div className="claim-head">
        <div>
          <div className="claim-row-key">{item.key}</div>
          <h3>{item.title}</h3>
        </div>
        <div className="claim-head-side">
          {health ? <RunHealthBadge health={health} /> : null}
          <span className="claim-agent">
            <span className="ca-avatar">{agentInitials(item.claimedBy || item.agent || "Agent")}</span>
            {item.claimedBy || item.agent || "Unassigned"}
          </span>
        </div>
      </div>

      <div className="claim-meta">
        <div>
          <span>Repo</span>
          <strong>{item.repo}</strong>
        </div>
        <div>
          <span>Run ID</span>
          <code>{item.agentRunId || "Not recorded"}</code>
        </div>
        <div>
          <span>Claimed</span>
          <strong>{formatRelativeTime(item.claimedAt)}</strong>
        </div>
        <div>
          <span>Status</span>
          <StatusPill status={item.status} />
        </div>
      </div>

      <div className={`lease-row lease-${lease.tone}`}>
        <div className="lr-head">
          <span>Lease</span>
          <span>{lease.label}</span>
        </div>
        <div className="lease-bar" style={{ "--lease": `${leasePct ?? 0}%` }} />
      </div>

      {item.lastAgentUpdate?.note ? <p className="agent-note">{item.lastAgentUpdate.note}</p> : null}
      {health?.summary ? <p className="agent-note">{health.summary}</p> : null}

      <div className="claim-foot">
        {item.githubBranch ? <code>{item.githubBranch}</code> : <span className="detail-note">No branch linked</span>}
        <div className="claim-actions">
          <RecoveryActions item={item} onRecoverRun={onRecoverRun} />
          <button type="button" className="button secondary" onClick={() => onOpenPacket(item.key)}>
            Open packet
          </button>
        </div>
      </div>
    </article>
  );
}

export function RunHealthBadge({ health }) {
  if (!health) {
    return null;
  }

  return (
    <span className={`run-health run-health-${health.severity || "none"}`}>{health.label}</span>
  );
}

export function RecoveryActions({ item, onRecoverRun }) {
  const actions = item?.agentRunHealth?.actions || [];

  if (actions.length === 0) {
    return null;
  }

  return (
    <>
      {actions.map((action) => {
        if (action.id === "open_context") {
          const href = item.agentRunHealth?.context?.contextUrl;
          return href ? (
            <a key={action.id} className="button secondary" href={href} target="_blank" rel="noreferrer">
              {action.label}
            </a>
          ) : null;
        }

        return (
          <button
            key={action.id}
            type="button"
            className={`button ${action.tone === "danger" ? "danger" : "secondary"}`}
            onClick={() => onRecoverRun?.(item, action.id)}
          >
            {action.label}
          </button>
        );
      })}
    </>
  );
}

export function ClaimList({ items, onOpenPacket }) {
  if (items.length === 0) {
    return <div className="overview-empty">No active claims.</div>;
  }

  return (
    <div className="claim-list">
      {items.map((item) => (
        <article className="claim-row" key={item.key}>
          <div>
            <div className="claim-row-key">{item.key}</div>
            <h3>{item.title}</h3>
            <p>{item.claimedBy || item.agent || "Unassigned"} / {item.repo}</p>
          </div>
          <div className="claim-row-side">
            <StatusPill status={item.status} />
            <button type="button" className="button secondary" onClick={() => onOpenPacket(item.key)}>
              Open packet
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

import React, { useState } from "react";
import { ActivityFeed } from "../../components/ActivityFeed.jsx";
import { Icon } from "../../components/Icon.jsx";
import { StatusPill } from "../../components/workUi.jsx";
import { attentionCount, attentionInboxFilters } from "../../lib/attentionInbox.mjs";
import {
  attentionActionKey,
  formatAttentionAge,
  formatPriority,
  formatStatus,
  repoHealthStatus,
  safeExternalUrl,
} from "../../lib/manageFormat.mjs";

export function TodayAttentionInbox({
  items,
  loadState,
  reconciliationSyncState,
  reconciliationActionState,
  reconciliationMessage,
  reconciliationAction,
  agentRecoveryAction,
  agentRecoveryMessage,
  onAction,
  onOpenItem,
}) {
  const [activeFilter, setActiveFilter] = useState("all");
  const filteredItems = activeFilter === "all"
    ? items
    : items.filter((item) => item.categories.includes(activeFilter));
  const showReconciliationOutcome = ["saving", "failed"].includes(reconciliationActionState)
    || /^(Linked|Created)\b|was already reconciled$/.test(reconciliationMessage);

  return (
    <section className="attention-inbox" aria-label="Today attention inbox">
      <div className="attention-inbox-head">
        <div>
          <span className="tn-eyebrow">Operator queue</span>
          <h2>Attention inbox</h2>
          <p>Exceptions most likely to stall delivery, ranked by impact and age.</p>
        </div>
        <div className={`attention-total ${items.length > 0 ? "has-attention" : ""}`}>
          <strong>{items.length}</strong>
          <span>{items.length === 1 ? "needs" : "need"} attention</span>
        </div>
      </div>

      <div className="attention-filters" aria-label="Attention inbox filters">
        {attentionInboxFilters.map((filter) => (
          <button
            type="button"
            key={filter.id}
            className={activeFilter === filter.id ? "is-active" : ""}
            aria-pressed={activeFilter === filter.id}
            onClick={() => setActiveFilter(filter.id)}
          >
            <span>{filter.label}</span>
            <strong>{attentionCount(items, filter.id)}</strong>
          </button>
        ))}
      </div>

      {reconciliationSyncState === "failed" ? (
        <div className="attention-sync-state is-degraded" role="status">
          <Icon name="warning" />
          <span><strong>GitHub reconciliation is degraded.</strong> Agent, review, and handoff signals remain available. {reconciliationMessage}</span>
        </div>
      ) : reconciliationSyncState === "loading" ? (
        <div className="attention-sync-state" role="status">
          <span className="attention-spinner" aria-hidden="true" />
          <span>Checking GitHub reconciliation for unlinked merged pull requests.</span>
        </div>
      ) : null}

      {agentRecoveryMessage ? <div className="attention-action-message" role="status">{agentRecoveryMessage}</div> : null}
      {showReconciliationOutcome ? (
        <div className={`attention-action-message ${reconciliationActionState === "failed" ? "is-failed" : ""}`} role="status">
          {reconciliationMessage}
        </div>
      ) : null}

      {loadState === "loading" ? (
        <div className="attention-loading" aria-label="Loading attention inbox">
          {[0, 1, 2].map((item) => <span key={item} />)}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="attention-empty">
          <span className="attention-empty-icon"><Icon name="check" /></span>
          <div>
            <strong>{activeFilter === "all" ? "The attention queue is clear" : `No ${activeFilter} exceptions`}</strong>
            <p>{activeFilter === "all" ? "No packets need operator intervention right now." : "Try another filter or return to the full priority queue."}</p>
          </div>
        </div>
      ) : (
        <div className="attention-list">
          {filteredItems.map((item) => {
            const actionKey = attentionActionKey(item);
            const pending = actionKey && (actionKey === agentRecoveryAction || actionKey === reconciliationAction);
            const pullRequestUrl = safeExternalUrl(item.pullRequest?.url);

            return (
              <article className={`attention-item attention-${item.severity}`} key={item.id}>
                <span className="attention-severity" role="img" aria-label={`${item.severity} priority`} />
                <div className="attention-item-body">
                  <div className="attention-item-topline">
                    <span className={`attention-category category-${item.primaryCategory}`}>{item.primaryCategory}</span>
                    <span>{formatAttentionAge(item.ageMinutes)}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.reason}</p>
                  <div className="attention-item-meta">
                    {item.packetKey ? (
                      <button type="button" className="ab-key attention-packet-link" onClick={() => onOpenItem(item)}>
                        {item.packetKey}
                      </button>
                    ) : null}
                    <span>{item.repo}</span>
                    {item.reference && pullRequestUrl ? (
                      <a href={pullRequestUrl} target="_blank" rel="noreferrer">{item.reference}</a>
                    ) : item.reference ? <span>{item.reference}</span> : null}
                  </div>
                </div>
                <button
                  type="button"
                  className="button secondary attention-action"
                  onClick={() => onAction(item)}
                  disabled={Boolean(pending)}
                >
                  {pending ? "Working" : item.action.label}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function TodayOverview({
  stats,
  nextItem,
  activity,
  repoHealthRows,
  activeClaims = [],
  attentionItems,
  loadState,
  reconciliationSyncState,
  reconciliationActionState,
  reconciliationMessage,
  reconciliationAction,
  agentRecoveryAction,
  agentRecoveryMessage,
  onAttentionAction,
  onOpenAttention,
  onOpenPacket,
  onClaimPacket,
  claimState,
  onNavigate,
}) {
  const failedRepoCount = repoHealthRows.filter((repo) => repo.failedRuns > 0).length;

  return (
    <>
      <section className="today-command" aria-label="Today overview">
        <article className="today-next">
          <div className="today-card-heading">
            <div>
              <span className="tn-eyebrow">Next ready packet</span>
              <strong>Keep delivery moving</strong>
            </div>
            <span className="today-order">01</span>
          </div>
          {nextItem ? (
            <>
              <div className="tn-key">{nextItem.key}</div>
              <h2>{nextItem.title}</h2>
              <p>{nextItem.summary}</p>
              <div className="tn-meta">
                <StatusPill status={nextItem.status} />
                <span>{formatPriority(nextItem.priority)}</span>
                <span>{nextItem.repo}</span>
              </div>
              <div className="tn-actions">
                <button type="button" className="button primary" onClick={() => onOpenPacket(nextItem.key)}>
                  Open packet
                </button>
                <button type="button" className="button secondary" onClick={() => onClaimPacket(nextItem)} disabled={claimState === "claiming"}>
                  {claimState === "claiming" ? "Claiming" : "Claim for agent"}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>No ready packet</h2>
              <p>The ready queue is clear. Draft or blocked packets still need scope before agent pickup.</p>
            </>
          )}
        </article>

        <div className="today-signals" aria-label="Operating signals">
          <button type="button" className="signal-card signal-review" onClick={() => onNavigate("review")}>
            <span>Review queue</span>
            <strong>{stats.reviewCount}</strong>
            <small>Awaiting sign-off</small>
          </button>
          <button type="button" className="signal-card signal-running" onClick={() => onNavigate("agents")}>
            <span>Agent runs</span>
            <strong>{activeClaims.length}</strong>
            <small>{activeClaims.length === 1 ? "Lease in motion" : "Leases in motion"}</small>
          </button>
          <button type="button" className="signal-card signal-ready" onClick={() => onNavigate("backlog")}>
            <span>Ready work</span>
            <strong>{stats.readyCount}</strong>
            <small>Available to claim</small>
          </button>
          <button type="button" className="signal-card signal-blocked" onClick={() => onNavigate("repos")}>
            <span>Repo alerts</span>
            <strong>{failedRepoCount}</strong>
            <small>Failed checks</small>
          </button>
        </div>
      </section>

      <div className="today-operations">
        <TodayAttentionInbox
          items={attentionItems}
          loadState={loadState}
          reconciliationSyncState={reconciliationSyncState}
          reconciliationActionState={reconciliationActionState}
          reconciliationMessage={reconciliationMessage}
          reconciliationAction={reconciliationAction}
          agentRecoveryAction={agentRecoveryAction}
          agentRecoveryMessage={agentRecoveryMessage}
          onAction={onAttentionAction}
          onOpenItem={onOpenAttention}
        />

        <section className="overview-panel" aria-label="Recent agent activity">
          <div className="section-title-row">
            <div>
              <span className="section-kicker">Execution</span>
              <h2>Recent agent activity</h2>
              <p>{activity.length} latest event{activity.length === 1 ? "" : "s"} across packet writebacks.</p>
            </div>
            <button type="button" className="button secondary" onClick={() => onNavigate("agents")}>
              View agents
            </button>
          </div>
          {activity.length > 0 ? (
            <ActivityFeed events={activity} onOpenPacket={onOpenPacket} />
          ) : activeClaims.length > 0 ? (
            <div className="active-run-list">
              {activeClaims.slice(0, 3).map((item) => (
                <button type="button" key={item.key} onClick={() => onOpenPacket(item.key)}>
                  <span className="run-pulse" />
                  <span>
                    <small>{item.claimedBy || item.agent || "Agent"} · {item.key}</small>
                    <strong>{item.title}</strong>
                  </span>
                  <em>{formatStatus(item.status)}</em>
                </button>
              ))}
            </div>
          ) : (
            <ActivityFeed events={activity} onOpenPacket={onOpenPacket} />
          )}
        </section>
      </div>

      <section className="overview-panel today-repos" aria-label="Mini repo health">
        <div className="section-title-row">
          <div>
            <span className="section-kicker">System health</span>
            <h2>Repository pulse</h2>
            <p>{repoHealthRows.length} repositories · {failedRepoCount} with failed checks.</p>
          </div>
          <button type="button" className="button secondary" onClick={() => onNavigate("repos")}>
            All repos
          </button>
        </div>
        <MiniRepoHealth rows={repoHealthRows} />
      </section>
    </>
  );
}

export function MiniRepoHealth({ rows }) {
  return (
    <div className="mini-repo">
      {rows.map((repo) => (
        <article className="mini-repo-row" key={repo.id}>
          <div>
            <span className="mr-name">{repo.name}</span>
            <span className="mr-domain">{repo.domain}</span>
            {repo.syncError ? <small>{repo.syncError}</small> : null}
          </div>
          <div className="mr-stat-grid">
            <span>{repo.openPrs} PRs</span>
            <span>{repo.openIssues} issues</span>
            <span className={repo.failedRuns > 0 ? "is-alert" : ""}>{repo.failedRuns} failed</span>
            <span>{repo.branches} branches</span>
          </div>
          <StatusPill status={repoHealthStatus(repo)} />
        </article>
      ))}
    </div>
  );
}

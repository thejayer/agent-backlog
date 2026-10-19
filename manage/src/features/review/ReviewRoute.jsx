import React, { useState } from "react";
import { Icon } from "../../components/Icon.jsx";
import { StatusPill } from "../../components/workUi.jsx";
import {
  MIN_COMPLETION_OVERRIDE_REASON_LENGTH,
  reviewCompletionEvidence,
} from "../../lib/reviewEvidence.mjs";
import {
  agentInitials,
  formatDateTime,
  formatRelativeTime,
  linesFromValue,
} from "../../lib/manageFormat.mjs";

export function ReviewQueue({ items, selectedKey, onSelectPacket, onUpdatePacket, onOpenPacket, onRefreshEvidence, githubState }) {
  const selectedReviewItem = items.find((item) => item.key === selectedKey) || items[0];

  if (items.length === 0) {
    return (
      <section className="overview-panel review-empty" aria-label="Review queue">
        <div className="overview-empty">No packets need review.</div>
      </section>
    );
  }

  const testsRecorded = items.filter((item) => linesFromValue(item.lastAgentUpdate?.testsRun).length > 0).length;
  const prsLinked = items.filter((item) => item.lastAgentUpdate?.githubPrUrl || item.githubPrUrl).length;
  const oldestUpdate = items.reduce((oldest, item) => {
    if (!oldest || !item.updatedAt) return oldest || item.updatedAt;
    return Date.parse(item.updatedAt) < Date.parse(oldest) ? item.updatedAt : oldest;
  }, "");

  return (
    <section className="review-route" aria-label="Review queue">
      <div className="review-metrics" aria-label="Review operating metrics">
        <div><span>Awaiting decision</span><strong>{items.length}</strong><small>Needs reviewer action</small></div>
        <div><span>Tests recorded</span><strong>{testsRecorded}</strong><small>Evidence attached</small></div>
        <div><span>Pull requests</span><strong>{prsLinked}</strong><small>Linked for inspection</small></div>
        <div><span>Oldest update</span><strong>{formatRelativeTime(oldestUpdate)}</strong><small>Queue age</small></div>
      </div>

      <div className="review-workbench">
        <aside className="review-inbox" aria-label="Review items">
          <div className="review-inbox-head">
            <div>
              <span className="section-kicker">Sign-off inbox</span>
              <h2>Needs review</h2>
            </div>
            <span>{items.length}</span>
          </div>
          <div className="review-inbox-tabs" role="group" aria-label="Review views">
            <button type="button" aria-pressed="true">Open <strong>{items.length}</strong></button>
            <button type="button" disabled>Returned <strong>0</strong></button>
            <button type="button" disabled>Approved <strong>0</strong></button>
          </div>
          <div className="review-inbox-list">
            {items.map((item) => (
              <button
                type="button"
                key={item.key}
                className={selectedReviewItem.key === item.key ? "is-selected" : ""}
                aria-pressed={selectedReviewItem.key === item.key}
                onClick={() => onSelectPacket?.(item.key)}
              >
                <span className="review-item-meta">
                  <strong>{item.key}</strong>
                  <em>{formatRelativeTime(item.updatedAt)}</em>
                </span>
                <b>{item.title}</b>
                <span className="review-item-foot">
                  <span>{item.repo}</span>
                  <span>{item.claimedBy || item.agent || "Unassigned"}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className="review-detail">
          <div className="review-detail-heading">
            <div>
              <span className="section-kicker">Decision workspace</span>
              <h2>Validate the handoff</h2>
              <p>Inspect delivery evidence, then approve, return, or block the packet.</p>
            </div>
            <StatusPill status={selectedReviewItem.status} />
          </div>
          <div className="review-grid">
            <ReviewCard
              item={selectedReviewItem}
              onUpdatePacket={onUpdatePacket}
              onOpenPacket={onOpenPacket}
              onRefreshEvidence={onRefreshEvidence}
              githubState={githubState}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export function ReviewCard({ item, onUpdatePacket, onOpenPacket, onRefreshEvidence, githubState }) {
  const update = item.lastAgentUpdate || {};
  const branch = update.githubBranch || item.githubBranch;
  const prUrl = update.githubPrUrl || item.githubPrUrl;
  const testsRun = linesFromValue(update.testsRun);
  const filesChanged = linesFromValue(update.filesChanged);

  return (
    <article className="review-card">
      <div className="review-card-head">
        <div>
          <div className="rc-key">{item.key}</div>
          <h3>{item.title}</h3>
          <div className="rc-repo">
            <Icon name="repo" />
            {item.repo} / claimed by {item.claimedBy || item.agent || "Unassigned"} / updated {formatRelativeTime(item.updatedAt)}
          </div>
        </div>
        <span className="claim-agent">
          <span className="ca-avatar">{agentInitials(item.claimedBy || item.agent || "Agent")}</span>
          {item.claimedBy || item.agent || "Unassigned"}
        </span>
      </div>

      <div className="review-writeback">
        {update.note ? <p className="rw-note">{update.note}</p> : <p className="detail-note">No latest agent note recorded.</p>}
        <div className="review-pr">
          {branch ? <code>{branch}</code> : <span className="detail-note">No branch linked</span>}
          {prUrl ? (
            <a href={prUrl} target="_blank" rel="noreferrer">
              Pull request
            </a>
          ) : (
            <span className="detail-note">No PR linked</span>
          )}
        </div>
        <div className="review-checklist">
          <ReviewList label="Tests run" items={testsRun} />
          <ReviewList label="Files changed" items={filesChanged} />
        </div>
      </div>

      <ReviewCompletionGate
        item={item}
        onComplete={(updates) => onUpdatePacket(item.key, updates)}
        onInspect={() => onOpenPacket(item.key)}
        onRefresh={() => onRefreshEvidence(item.key)}
        refreshing={githubState === "syncing"}
      />

      <div className="review-foot">
        <button
          type="button"
          className="button secondary"
          onClick={() => onUpdatePacket(item.key, { status: "ready_for_agent", blockedBy: "" })}
        >
          Needs changes
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => onUpdatePacket(item.key, { status: "blocked", blockedBy: item.blockedBy || "Blocked from review queue." })}
        >
          Blocked
        </button>
        <button type="button" className="button secondary rf-spacer" onClick={() => onOpenPacket(item.key)}>
          Open packet
        </button>
      </div>
    </article>
  );
}

export function ReviewCompletionGate({ item, onComplete, onInspect, onRefresh, refreshing = false }) {
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [completionState, setCompletionState] = useState("idle");
  const evidence = reviewCompletionEvidence(item);
  const needsPacketRepair = evidence.missing.some((check) => check.repair === "packet");
  const needsGithubRefresh = evidence.missing.some((check) => check.repair === "github");
  const overrideReady = overrideReason.trim().length >= MIN_COMPLETION_OVERRIDE_REASON_LENGTH;

  async function complete(updates) {
    setCompletionState("saving");
    const saved = await onComplete(updates);
    setCompletionState(saved ? "saved" : "failed");

    if (saved) {
      setShowOverride(false);
      setOverrideReason("");
    }
  }

  return (
    <section
      className={`review-evidence ${evidence.canComplete ? "is-ready" : "is-blocked"}`}
      aria-label={`Delivery evidence for ${item.key}`}
    >
      <div className="review-evidence-head">
        <div>
          <span className="section-kicker">Delivery gate</span>
          <strong>{evidence.canComplete ? "Evidence complete" : `${evidence.missing.length} prerequisite${evidence.missing.length === 1 ? "" : "s"} missing`}</strong>
        </div>
        <span className={`review-evidence-state ${evidence.canComplete ? "is-ready" : "is-blocked"}`}>
          {evidence.canComplete ? "Ready to complete" : "Completion blocked"}
        </span>
      </div>

      <ul className="review-evidence-list">
        {evidence.checks.map((check) => (
          <li key={check.id} className={check.satisfied ? "is-satisfied" : "is-missing"}>
            <span aria-hidden="true">{check.satisfied ? "✓" : "!"}</span>
            <div>
              <strong>{check.label}</strong>
              <small>
                {check.satisfied
                  ? check.id === "merged_pull_request" && evidence.mergedAt
                    ? `Merged ${formatDateTime(evidence.mergedAt)}`
                    : "Recorded"
                  : check.missing}
              </small>
            </div>
          </li>
        ))}
      </ul>

      {!evidence.canComplete ? (
        <div className="review-repair-actions">
          {needsPacketRepair && onInspect ? (
            <button type="button" className="button secondary" onClick={onInspect}>
              Open packet
            </button>
          ) : null}
          {needsGithubRefresh && onRefresh ? (
            <button type="button" className="button secondary" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing evidence" : "Refresh GitHub evidence"}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="review-completion-actions">
        <button
          type="button"
          className="button primary"
          onClick={() => complete({ status: "done" })}
          disabled={!evidence.canComplete || completionState === "saving"}
        >
          <Icon name="check" />
          {completionState === "saving" ? "Completing" : "Mark done"}
        </button>
        {!evidence.canComplete ? (
          <button type="button" className="button secondary" onClick={() => setShowOverride((current) => !current)}>
            {showOverride ? "Close override" : "Non-code override"}
          </button>
        ) : null}
      </div>

      {showOverride ? (
        <div className="review-override-form">
          <label>
            <span>Why is delivery evidence not applicable?</span>
            <textarea
              aria-label={`Completion override reason for ${item.key}`}
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
              rows="3"
              placeholder="Explain why this packet can be completed without a merged code delivery."
            />
          </label>
          <div>
            <small>The reason is recorded in the packet agent timeline.</small>
            <button
              type="button"
              className="button danger"
              onClick={() => complete({
                status: "done",
                completionOverrideReason: overrideReason,
              })}
              disabled={!overrideReady || completionState === "saving"}
            >
              Complete with override
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function ReviewList({ label, items }) {
  return (
    <div>
      <span>{label}</span>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="detail-note">Not recorded</p>
      )}
    </div>
  );
}

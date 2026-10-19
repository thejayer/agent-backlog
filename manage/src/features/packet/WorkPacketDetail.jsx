import React, { useCallback, useEffect, useState } from "react";
import { Icon } from "../../components/Icon.jsx";
import { CheckList, CodeList, Endpoint, LabelList, Section, StatusPill } from "../../components/workUi.jsx";
import { ReviewCompletionGate } from "../review/ReviewRoute.jsx";
import { RunHealthBadge } from "../agents/AgentsRoute.jsx";
import { priorityOptions, repositories, statusOptions } from "../../data/workItems.mjs";
import { itemLabels } from "../backlog/useBacklogController.mjs";
import { readinessScore } from "../../lib/agentPrompt.mjs";
import { addPacketNote as addPacketNoteRequest, fetchPacketRoom } from "../../lib/manageApi.mjs";
import { reviewCompletionEvidence } from "../../lib/reviewEvidence.mjs";
import {
  formatAgentEventLabel,
  formatDateTime,
  formatEventType,
  formatPacketRoomEventLabel,
  formatRelativeTime,
  getRepo,
  githubMatchCount,
  hasStructuredAgentUpdate,
  isLeaseActive,
  itemToDraft,
  linesFromValue,
} from "../../lib/manageFormat.mjs";

const repoOptions = repositories.map((repo) => repo.id);

export function WorkPacketDetail({
  item,
  selectedPrompt,
  selectedTaskUrl,
  selectedTaskJsonUrl,
  onCopyPrompt,
  onCopyText,
  onUpdate,
  onClaim,
  onLinkGithub,
  onCreateGithubIssue,
  onDuplicate,
  onRefreshEvidence,
  claimState,
  linkState,
  issueState,
  githubState,
}) {
  const repo = getRepo(item.repo);
  const activeLease = isLeaseActive(item);
  const matchCount = githubMatchCount(item);
  const reviewEvidence = reviewCompletionEvidence(item);
  const agentEvents = Array.isArray(item.agentEvents) ? item.agentEvents : [];
  const [isEditing, setIsEditing] = useState(false);
  const [tab, setTab] = useState("brief");
  const [draft, setDraft] = useState(() => itemToDraft(item));
  const [saveState, setSaveState] = useState("idle");

  useEffect(() => {
    setDraft(itemToDraft(item));
    setIsEditing(false);
    setTab("brief");
    setSaveState("idle");
  }, [item.key]);

  function updateDraft(field, value) {
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }));
  }

  async function saveEdit(event) {
    event.preventDefault();
    setSaveState("saving");
    const saved = await onUpdate(draft);
    setSaveState(saved ? "idle" : "failed");

    if (saved) {
      setIsEditing(false);
    }
  }

  const tabs = [
    { id: "brief", label: "Brief" },
    { id: "handoff", label: "Handoff" },
    { id: "room", label: "Room" },
    { id: "agent", label: "Agent" },
  ];
  const activeTab = tabs.find((workspaceTab) => workspaceTab.id === tab) || tabs[0];
  const tabIdPrefix = `packet-${String(item.key).toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`;
  const tabButtonId = (tabId) => `${tabIdPrefix}-${tabId}-tab`;
  const tabPanelId = (tabId) => `${tabIdPrefix}-${tabId}-panel`;

  return (
    <>
      <div className="detail-top packet-hero">
        <div>
          <div className="detail-key">{item.key}</div>
          <h2>{item.title}</h2>
        </div>
        <StatusPill status={item.status} />
      </div>

      <div className="field-grid">
        <label className="field-card">
          <span>Status</span>
          <select value={item.status} onChange={(event) => onUpdate({ status: event.target.value })}>
            {statusOptions.map((status) => (
              <option key={status.id} value={status.id} disabled={status.id === "done" && item.status !== "done" && !reviewEvidence.canComplete}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-card">
          <span>Priority</span>
          <select value={item.priority} onChange={(event) => onUpdate({ priority: event.target.value })}>
            {priorityOptions.map((priority) => (
              <option key={priority.id} value={priority.id}>
                {priority.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-card">
          <span>Agent</span>
          <select value={item.agent || ""} onChange={(event) => onUpdate({ agent: event.target.value })}>
            <option value="">Any agent</option>
            <option value="Codex">Codex</option>
            <option value="Claude Code">Claude Code</option>
          </select>
        </label>
      </div>

      <div className="detail-actions">
        <button
          type="button"
          className="button secondary"
          onClick={onClaim}
          disabled={claimState === "claiming" || activeLease}
        >
          {claimState === "claiming" ? "Claiming" : activeLease ? "Lease active" : "Claim packet"}
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={onLinkGithub}
          disabled={linkState === "linking"}
        >
          {linkState === "linking" ? "Linking GitHub" : "Link GitHub"}
        </button>
        {item.githubIssueUrl ? (
          <a className="button secondary" href={item.githubIssueUrl} target="_blank" rel="noreferrer">
            Open issue
          </a>
        ) : (
          <button
            type="button"
            className="button secondary"
            onClick={onCreateGithubIssue}
            disabled={issueState === "creating"}
          >
            {issueState === "creating" ? "Creating issue" : "Create issue"}
          </button>
        )}
        <button type="button" className="button secondary" onClick={() => onUpdate({ status: "needs_review" })}>
          Mark review
        </button>
        <button type="button" className="button secondary" onClick={() => setIsEditing((current) => !current)}>
          {isEditing ? "Close edit" : "Edit packet"}
        </button>
        <button type="button" className="button secondary" onClick={onDuplicate}>
          Duplicate
        </button>
      </div>

      <PacketWorkflow item={item} />

      {isEditing ? (
        <PacketEditForm
          draft={draft}
          onChange={updateDraft}
          onSubmit={saveEdit}
          onCancel={() => {
            setDraft(itemToDraft(item));
            setIsEditing(false);
          }}
          saveState={saveState}
        />
      ) : (
        <>
          <div className="packet-tabs" role="tablist" aria-label="Packet workspace tabs">
            {tabs.map((workspaceTab) => (
              <button
                key={workspaceTab.id}
                type="button"
                role="tab"
                id={tabButtonId(workspaceTab.id)}
                aria-selected={tab === workspaceTab.id}
                aria-controls={tabPanelId(workspaceTab.id)}
                className={tab === workspaceTab.id ? "is-active" : ""}
                onClick={() => setTab(workspaceTab.id)}
              >
                {workspaceTab.label}
              </button>
            ))}
          </div>

          <div
            className="packet-tab-body"
            role="tabpanel"
            id={tabPanelId(activeTab.id)}
            aria-labelledby={tabButtonId(activeTab.id)}
            tabIndex={0}
          >
            {tab === "brief" ? <PacketBriefTab item={item} /> : null}
            {tab === "handoff" ? (
              <PacketHandoffTab
                item={item}
                repo={repo}
                matchCount={matchCount}
                agentEvents={agentEvents}
                onUpdate={onUpdate}
                onInspect={() => {
                  setTab("brief");
                  setIsEditing(true);
                }}
                onRefreshEvidence={onRefreshEvidence}
                githubState={githubState}
              />
            ) : null}
            {tab === "room" ? <PacketRoomTab item={item} /> : null}
            {tab === "agent" ? (
              <PacketAgentTab
                item={item}
                selectedPrompt={selectedPrompt}
                selectedTaskUrl={selectedTaskUrl}
                selectedTaskJsonUrl={selectedTaskJsonUrl}
                onCopyPrompt={onCopyPrompt}
                onCopyText={onCopyText}
              />
            ) : null}
          </div>
        </>
      )}
    </>
  );
}

export function PacketRoomTab({ item }) {
  const [room, setRoom] = useState(null);
  const [loadState, setLoadState] = useState("loading");
  const [note, setNote] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [error, setError] = useState("");

  const loadRoom = useCallback(async () => {
    setLoadState("loading");
    setError("");
    try {
      const payload = await fetchPacketRoom(item.key);
      setRoom(payload);
      setLoadState("ready");
    } catch (caught) {
      setError(caught.message || "Unable to load packet room.");
      setLoadState("error");
    }
  }, [item.key]);

  useEffect(() => {
    loadRoom();
  }, [loadRoom]);

  async function submitNote(event) {
    event.preventDefault();
    const summary = note.trim();
    if (!summary) return;

    setSaveState("saving");
    setError("");
    try {
      await addPacketNoteRequest(item.key, { summary });
      setNote("");
      await loadRoom();
      setSaveState("idle");
    } catch (caught) {
      setError(caught.message || "Unable to add note.");
      setSaveState("idle");
    }
  }

  const events = Array.isArray(room?.events) ? [...room.events].reverse() : [];
  const heartbeat = room?.heartbeat;

  return (
    <div className="packet-room">
      <div className="packet-summary-lead">
        <span>Packet room</span>
        <p>Durable timeline for {item.key}: human notes, lifecycle, heartbeats, and GitHub signals.</p>
      </div>

      {heartbeat ? (
        <Section title="Latest heartbeat">
          <article className="agent-event-card" aria-label="Latest heartbeat">
            <div className="agent-event-head">
              <div>
                <strong>{heartbeat.state || "running"}</strong>
                <span>
                  {heartbeat.agent || "Agent"} - {formatRelativeTime(heartbeat.lastSeenAt)}
                </span>
              </div>
            </div>
            {heartbeat.agentRunId ? <code>{heartbeat.agentRunId}</code> : null}
            {heartbeat.currentStep ? <p>{heartbeat.currentStep}</p> : null}
          </article>
        </Section>
      ) : null}

      <Section title="Add a note">
        <form className="packet-room-note" onSubmit={submitNote}>
          <label htmlFor={`packet-room-note-${item.key}`}>Human note</label>
          <textarea
            id={`packet-room-note-${item.key}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Leave an operator note on this packet."
          />
          <div className="packet-room-actions">
            <button type="submit" className="button" disabled={saveState === "saving" || !note.trim()}>
              {saveState === "saving" ? "Adding note" : "Add note"}
            </button>
          </div>
        </form>
      </Section>

      {error ? <p className="detail-note" role="alert">{error}</p> : null}

      <Section title="Timeline">
        {loadState === "loading" ? <p>Loading timeline…</p> : null}
        {loadState === "ready" && events.length === 0 ? <p>No packet room events yet.</p> : null}
        {events.length > 0 ? (
          <div className="agent-timeline" aria-label="Packet room timeline">
            {events.map((event) => (
              <PacketRoomEventCard key={event.id || `${event.at}-${event.type}`} event={event} />
            ))}
          </div>
        ) : null}
      </Section>
    </div>
  );
}

export function PacketRoomEventCard({ event }) {
  const evidenceUrl = safeExternalUrl(event.evidenceUrl || event.payload?.githubPrUrl);
  const actor = event.actor?.agent || event.actor?.login || event.agent || "Operator";

  return (
    <article className="agent-event-card">
      <div className="agent-event-head">
        <div>
          <strong>{formatPacketRoomEventLabel(event)}</strong>
          <span>
            {actor} - {formatDateTime(event.at)}
          </span>
        </div>
        {event.state ? <StatusPill status={event.state} /> : event.payload?.status ? <StatusPill status={event.payload.status} /> : null}
      </div>
      {event.actor?.agentRunId ? <code>{event.actor.agentRunId}</code> : null}
      {event.summary ? <p>{event.summary}</p> : null}
      {event.currentStep ? <p className="detail-note">{event.currentStep}</p> : null}
      {evidenceUrl ? (
        <a href={evidenceUrl} target="_blank" rel="noreferrer">
          {evidenceUrl}
        </a>
      ) : null}
      <StructuredAgentUpdate update={event.payload || event} />
    </article>
  );
}

export function PacketBriefTab({ item }) {
  return (
    <div className="packet-brief">
      <div className="packet-summary-lead">
        <span>Summary</span>
        <p>{item.summary || "No problem statement recorded for this packet."}</p>
      </div>
      <div className="brief-grid">
        <Section title="Desired outcome">
          <p>{item.desiredOutcome || "No desired outcome recorded."}</p>
        </Section>
        <Section title="Labels">
          <LabelList labels={itemLabels(item)} />
        </Section>
        <Section title="Acceptance criteria">
          <CheckList items={item.acceptanceCriteria} />
        </Section>
        <Section title="Relevant files">
          <CodeList items={item.relevantFiles} />
        </Section>
        <Section title="Test commands">
          <CodeList items={item.testCommands} />
        </Section>
        <Section title="Relevant URLs">
          <CodeList items={item.relevantUrls} />
        </Section>
      </div>
      {item.blockedBy ? (
        <div className="blocked-callout">
          <strong>Blocked by</strong>
          <p>{item.blockedBy}</p>
        </div>
      ) : null}
    </div>
  );
}

export function PacketHandoffTab({
  item,
  repo,
  matchCount,
  agentEvents,
  onUpdate,
  onInspect,
  onRefreshEvidence,
  githubState,
}) {
  const hasAgentRun = Boolean(item.claimedBy || item.agentRunId || item.leaseExpiresAt || item.agentRunHealth?.state === "failed");

  return (
    <div className="handoff-tab">
      <Section title="Repo">
        <div className="repo-card">
          <div>
            <strong>{repo?.name || item.repo}</strong>
            <span>{repo?.description || "Repo metadata not recorded."}</span>
          </div>
          <small>{repo?.domain || "Workspace"}</small>
        </div>
        <div className="branch-line">
          <Icon name="branch" />
          <code>{item.suggestedBranch || "Branch suggestion not recorded"}</code>
        </div>
        <div className="handoff-grid handoff-grid-three">
          <div>
            <span>Matched branch</span>
            <code>{item.githubBranch || "Not linked"}</code>
          </div>
          <div>
            <span>Matched PR</span>
            {item.githubPrUrl ? (
              <a href={item.githubPrUrl} target="_blank" rel="noreferrer">
                {item.githubPrUrl}
              </a>
            ) : (
              <code>Not linked</code>
            )}
          </div>
          <div>
            <span>Readiness</span>
            <code>{readinessScore(item)}% ready</code>
          </div>
          <div>
            <span>GitHub issue</span>
            {item.githubIssueUrl ? (
              <a href={item.githubIssueUrl} target="_blank" rel="noreferrer">
                {item.githubIssueTitle || item.githubIssueUrl}
              </a>
            ) : (
              <code>Not linked</code>
            )}
          </div>
          <div>
            <span>Cached matches</span>
            <code>{matchCount}</code>
          </div>
          <div>
            <span>Project</span>
            <code>{item.project || "Not recorded"}</code>
          </div>
        </div>
      </Section>

      {hasAgentRun ? (
        <Section title="Agent run">
          <div className="run-card">
            <div>
              <span>Claimed by</span>
              <strong>{item.claimedBy || "Not claimed"}</strong>
            </div>
            <div>
              <span>Run ID</span>
              <code>{item.agentRunId || "Not recorded"}</code>
            </div>
            <div>
              <span>Claimed at</span>
              <strong>{formatDateTime(item.claimedAt)}</strong>
            </div>
            <div>
              <span>Lease expires</span>
              <strong>{formatDateTime(item.leaseExpiresAt)}</strong>
            </div>
          </div>
          {item.agentRunHealth ? (
            <div className="run-health-detail">
              <RunHealthBadge health={item.agentRunHealth} />
              <p className="detail-note">{item.agentRunHealth.summary}</p>
            </div>
          ) : null}
        </Section>
      ) : null}

      {agentEvents.length > 0 ? (
        <Section title="Agent timeline">
          <AgentTimeline events={agentEvents} />
        </Section>
      ) : null}

      <Section title="GitHub activity">
        {matchCount > 0 ? (
          <div className="github-match-list">
            {(item.githubLinks?.pullRequests || []).map((pullRequest) => (
              <a key={pullRequest.url} href={pullRequest.url} target="_blank" rel="noreferrer">
                PR #{pullRequest.number}: {pullRequest.title}
              </a>
            ))}
            {(item.githubLinks?.branches || []).map((branch) => (
              <code key={branch.name}>{branch.name}</code>
            ))}
            {(item.githubLinks?.issues || []).map((issue) => (
              <a key={issue.url} href={issue.url} target="_blank" rel="noreferrer">
                Issue #{issue.number}: {issue.title}
              </a>
            ))}
            {(item.githubLinks?.workflowRuns || []).map((run) => (
              <a key={run.url} href={run.url} target="_blank" rel="noreferrer">
                {run.name}: {run.branch}
              </a>
            ))}
          </div>
        ) : (
          <p>No cached GitHub matches recorded.</p>
        )}
      </Section>

      {item.status === "needs_review" ? (
        <Section title="Review queue">
          <ReviewSummary item={item} update={item.lastAgentUpdate} />
          <ReviewCompletionGate
            item={item}
            onComplete={onUpdate}
            onInspect={onInspect}
            onRefresh={onRefreshEvidence}
            refreshing={githubState === "syncing"}
          />
          <div className="review-actions">
            <button type="button" className="button secondary" onClick={() => onUpdate({ status: "ready_for_agent" })}>
              Needs changes
            </button>
            <button type="button" className="button secondary" onClick={() => onUpdate({ status: "blocked" })}>
              Blocked
            </button>
          </div>
        </Section>
      ) : null}

      {item.lastAgentUpdate?.note ? (
        <div className="latest-note">
          <strong>Latest agent note</strong>
          <p>{item.lastAgentUpdate.note}</p>
        </div>
      ) : null}
    </div>
  );
}

export function PacketAgentTab({ item, selectedPrompt, selectedTaskUrl, selectedTaskJsonUrl, onCopyPrompt, onCopyText }) {
  return (
    <div className="agent-tab">
      <div className="agent-prompt-card" aria-label="Packet agent prompt">
        <div className="agent-header">
          <div>
            <h2>Agent prompt</h2>
            <p>{item.key}.md</p>
          </div>
          <div className="agent-actions">
            <button type="button" className="icon-button" onClick={onCopyPrompt} aria-label="Copy packet prompt">
              <Icon name="copy" />
            </button>
            <a className="icon-button" href={`/agent/${item.key}.md`} target="_blank" rel="noreferrer" aria-label="Open packet Markdown">
              <Icon name="external" />
            </a>
          </div>
        </div>
        <div className="task-url" aria-label="Packet task URL">
          <span>Task URL</span>
          <a href={selectedTaskUrl} target="_blank" rel="noreferrer">
            {selectedTaskUrl}
          </a>
        </div>
        <pre className="prompt-preview" tabIndex={0} aria-label="Packet agent prompt preview">{selectedPrompt}</pre>
      </div>
      <div className="endpoint-list packet-endpoints" aria-label="Packet agent endpoints">
        <Endpoint label="Task URL" value={selectedTaskUrl} />
        <Endpoint label="Instructions" value="/agent/instructions.md" />
        <Endpoint label="Bootstrap" value="/api/agent/bootstrap" />
        <Endpoint label="Markdown" value={`/agent/${item.key}.md`} />
        <Endpoint label="JSON" value={`/api/agent/tasks/${item.key}`} />
        <Endpoint label="Task JSON" value={selectedTaskJsonUrl} />
        <Endpoint label="Next" value={`/api/agent/next?repo=${item.repo}`} />
        <Endpoint label="Next label" value={`/api/agent/next?label=${itemLabels(item)[0] || "label"}`} />
        <Endpoint label="Next claim" value="POST /api/agent/next/claim" />
        <Endpoint label="Claim" value={`POST /api/agent/tasks/${item.key}/claim`} />
        <Endpoint label="Status" value={`POST /api/agent/tasks/${item.key}/status`} />
        <button type="button" className="button secondary" onClick={() => onCopyText(selectedTaskUrl, "Task URL copied")}>
          Copy task URL
        </button>
      </div>
    </div>
  );
}

export function PacketWorkflow({ item }) {
  const status = item.status;
  const readiness = readinessScore(item);
  const hasClaim = Boolean(item.claimedBy || item.agentRunId || isLeaseActive(item) || ["claimed", "in_progress", "needs_review", "done"].includes(status));
  const hasBuildSignal = Boolean(item.githubBranch || item.githubPrUrl || ["in_progress", "needs_review", "done"].includes(status));
  const hasReviewSignal = Boolean(item.githubPrUrl || item.lastAgentUpdate || ["needs_review", "done"].includes(status));
  const steps = [
    {
      label: "Scope",
      value: `${readiness}% ready`,
      state: readiness >= 70 || status !== "draft" ? "complete" : "active",
    },
    {
      label: "Claim",
      value: item.claimedBy || item.agent || "Unassigned",
      state: hasClaim ? "complete" : readiness >= 70 ? "active" : "waiting",
    },
    {
      label: "Build",
      value: item.githubBranch || item.suggestedBranch || "Branch pending",
      state: hasBuildSignal ? "complete" : hasClaim ? "active" : "waiting",
    },
    {
      label: "Review",
      value: item.githubPrUrl ? "PR linked" : "Review pending",
      state: hasReviewSignal ? (status === "done" ? "complete" : "active") : "waiting",
    },
    {
      label: "Close",
      value: status === "done" ? "Done" : "Open",
      state: status === "done" ? "complete" : "waiting",
    },
  ];

  return (
    <section className="packet-workflow" aria-label="Packet workflow">
      {steps.map((step) => (
        <div key={step.label} className={`workflow-step workflow-${step.state}`}>
          <span>{step.label}</span>
          <strong>{step.value}</strong>
        </div>
      ))}
    </section>
  );
}

export function ReviewSummary({ item, update }) {
  const reviewUpdate = update || {};
  const branch = reviewUpdate.githubBranch || item.githubBranch;
  const prUrl = reviewUpdate.githubPrUrl || item.githubPrUrl;

  if (!reviewUpdate.note && !branch && !prUrl && !hasStructuredAgentUpdate(reviewUpdate)) {
    return <p className="detail-note">No structured review writeback recorded yet.</p>;
  }

  return (
    <div className="review-summary">
      <div className="review-summary-grid">
        <div>
          <span>Branch</span>
          <code>{branch || "Not recorded"}</code>
        </div>
        <div>
          <span>Pull request</span>
          {prUrl ? (
            <a href={prUrl} target="_blank" rel="noreferrer">
              {prUrl}
            </a>
          ) : (
            <code>Not recorded</code>
          )}
        </div>
      </div>
      {reviewUpdate.note ? <p>{reviewUpdate.note}</p> : null}
      <StructuredAgentUpdate update={reviewUpdate} />
    </div>
  );
}

export function AgentTimeline({ events }) {
  return (
    <div className="agent-timeline">
      {[...events].reverse().map((event, index) => (
        <AgentEventCard key={`${event.at || "event"}-${event.type || "agent"}-${index}`} event={event} />
      ))}
    </div>
  );
}

export function AgentEventCard({ event }) {
  return (
    <article className="agent-event-card">
      <div className="agent-event-head">
        <div>
          <strong>{formatEventType(event.type)}</strong>
          <span>
            {event.agent || "Agent"} - {formatDateTime(event.at)}
          </span>
        </div>
        {event.status ? <StatusPill status={event.status} /> : null}
      </div>
      {event.agentRunId ? <code>{event.agentRunId}</code> : null}
      {event.action ? <p className="detail-note">{formatAgentEventLabel(event)}</p> : null}
      {event.note ? <p>{event.note}</p> : null}
      {event.leaseExpiresAt ? <p className="detail-note">Lease expires {formatDateTime(event.leaseExpiresAt)}.</p> : null}
      <StructuredAgentUpdate update={event} />
    </article>
  );
}

export function StructuredAgentUpdate({ update }) {
  const testsRun = linesFromValue(update?.testsRun);
  const filesChanged = linesFromValue(update?.filesChanged);
  const blockers = linesFromValue(update?.blockers);
  const nextSteps = linesFromValue(update?.nextSteps);
  const branch = update?.githubBranch;
  const prUrl = update?.githubPrUrl;

  if (!branch && !prUrl && testsRun.length === 0 && filesChanged.length === 0 && blockers.length === 0 && nextSteps.length === 0) {
    return null;
  }

  return (
    <div className="agent-update-grid">
      {branch ? (
        <div>
          <span>Branch</span>
          <code>{branch}</code>
        </div>
      ) : null}
      {prUrl ? (
        <div>
          <span>Pull request</span>
          <a href={prUrl} target="_blank" rel="noreferrer">
            {prUrl}
          </a>
        </div>
      ) : null}
      <AgentUpdateList label="Tests run" items={testsRun} />
      <AgentUpdateList label="Files changed" items={filesChanged} />
      <AgentUpdateList label="Blockers" items={blockers} />
      <AgentUpdateList label="Next steps" items={nextSteps} />
    </div>
  );
}

export function AgentUpdateList({ label, items }) {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div>
      <span>{label}</span>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function PacketEditForm({ draft, onChange, onSubmit, onCancel, saveState }) {
  return (
    <form className="packet-editor" onSubmit={onSubmit}>
      <div className="editor-grid">
        <label className="span-2">
          <span>Title</span>
          <input value={draft.title} onChange={(event) => onChange("title", event.target.value)} required />
        </label>
        <label>
          <span>Status</span>
          <select value={draft.status} onChange={(event) => onChange("status", event.target.value)}>
            {statusOptions.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Priority</span>
          <select value={draft.priority} onChange={(event) => onChange("priority", event.target.value)}>
            {priorityOptions.map((priority) => (
              <option key={priority.id} value={priority.id}>
                {priority.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Repo</span>
          <select value={draft.repo} onChange={(event) => onChange("repo", event.target.value)}>
            {repoOptions.map((repo) => (
              <option key={repo} value={repo}>
                {repo}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Agent</span>
          <select value={draft.agent} onChange={(event) => onChange("agent", event.target.value)}>
            <option value="">Any agent</option>
            <option value="Codex">Codex</option>
            <option value="Claude Code">Claude Code</option>
          </select>
        </label>
        <label>
          <span>Project</span>
          <input value={draft.project} onChange={(event) => onChange("project", event.target.value)} />
        </label>
        <label className="span-2">
          <span>Suggested branch</span>
          <input value={draft.suggestedBranch} onChange={(event) => onChange("suggestedBranch", event.target.value)} />
        </label>
        <label className="span-2">
          <span>Labels</span>
          <input value={draft.labels} onChange={(event) => onChange("labels", event.target.value)} placeholder="bug, ui, qa" />
        </label>
        <label className="span-2">
          <span>Problem statement</span>
          <textarea value={draft.summary} onChange={(event) => onChange("summary", event.target.value)} rows="4" />
        </label>
        <label className="span-2">
          <span>Desired outcome</span>
          <textarea value={draft.desiredOutcome} onChange={(event) => onChange("desiredOutcome", event.target.value)} rows="4" />
        </label>
        <label>
          <span>Acceptance criteria</span>
          <textarea value={draft.acceptanceCriteria} onChange={(event) => onChange("acceptanceCriteria", event.target.value)} rows="8" />
        </label>
        <label>
          <span>Relevant files</span>
          <textarea value={draft.relevantFiles} onChange={(event) => onChange("relevantFiles", event.target.value)} rows="8" />
        </label>
        <label>
          <span>Relevant URLs</span>
          <textarea value={draft.relevantUrls} onChange={(event) => onChange("relevantUrls", event.target.value)} rows="5" />
        </label>
        <label>
          <span>Implementation notes</span>
          <textarea value={draft.implementationNotes} onChange={(event) => onChange("implementationNotes", event.target.value)} rows="5" />
        </label>
        <label>
          <span>Test commands</span>
          <textarea value={draft.testCommands} onChange={(event) => onChange("testCommands", event.target.value)} rows="4" />
        </label>
        <label>
          <span>Blocked by</span>
          <textarea value={draft.blockedBy} onChange={(event) => onChange("blockedBy", event.target.value)} rows="4" />
        </label>
        <label>
          <span>GitHub branch</span>
          <input value={draft.githubBranch} onChange={(event) => onChange("githubBranch", event.target.value)} />
        </label>
        <label>
          <span>GitHub PR URL</span>
          <input value={draft.githubPrUrl} onChange={(event) => onChange("githubPrUrl", event.target.value)} />
        </label>
        <label>
          <span>GitHub issue URL</span>
          <input value={draft.githubIssueUrl} onChange={(event) => onChange("githubIssueUrl", event.target.value)} />
        </label>
        <label>
          <span>GitHub issue title</span>
          <input value={draft.githubIssueTitle} onChange={(event) => onChange("githubIssueTitle", event.target.value)} />
        </label>
        <label className="span-2">
          <span>Deploy notes</span>
          <textarea value={draft.deployNotes} onChange={(event) => onChange("deployNotes", event.target.value)} rows="4" />
        </label>
      </div>
      <div className="editor-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button primary" disabled={saveState === "saving"}>
          {saveState === "saving" ? "Saving" : "Save edits"}
        </button>
      </div>
    </form>
  );
}

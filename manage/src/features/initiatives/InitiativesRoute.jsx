import React, { useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/Icon.jsx";
import { ModalDialog } from "../../components/ModalDialog.jsx";
import { initiativeDraft } from "../../lib/initiativeDraft.mjs";
import { buildInitiativeSuggestion, initiativeTemplates } from "../../lib/initiativeBootstrap.mjs";
import { buildInitiativeReleaseTimeline } from "../../lib/releaseTimeline.mjs";
import {
  formatDateTime,
  formatStatus,
  initiativeHealthLabels,
  initiativeRollup,
  initiativeStatusLabels,
} from "../../lib/manageFormat.mjs";

export function InitiativeMetric({ label, value, note }) {
  return <article className="initiative-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

export function InitiativesOverview({
  initiatives,
  items,
  githubCache,
  githubState,
  githubMessage,
  selectedId,
  onSelect,
  onUpdate,
  onOpenPacket,
  onSync,
}) {
  const selected = initiatives.find((initiative) => initiative.id === selectedId) || initiatives[0];
  const active = initiatives.filter((initiative) => initiative.status === "active").length;
  const needsAttention = initiatives.filter((initiative) => ["watch", "blocked"].includes(initiative.health)).length;
  const linkedPackets = new Set(initiatives.flatMap((initiative) => initiative.packetKeys || [])).size;
  const completed = initiatives.filter((initiative) => initiative.status === "complete").length;

  if (!selected) {
    return (
      <section className="initiative-empty" aria-label="Initiatives workspace">
        <Icon name="initiative" />
        <h2>Turn packets into a portfolio</h2>
        <p>Create the first initiative to connect delivery work to an objective, owner, health signal, and next action.</p>
      </section>
    );
  }

  return (
    <section className="initiatives-route" aria-label="Initiatives workspace">
      <div className="initiative-summary-grid">
        <InitiativeMetric label="Active" value={active} note={`${initiatives.length} total initiatives`} />
        <InitiativeMetric label="Needs attention" value={needsAttention} note="Watch or blocked" />
        <InitiativeMetric label="Linked packets" value={linkedPackets} note="Unique work packets" />
        <InitiativeMetric label="Completed" value={completed} note="Outcomes closed" />
      </div>
      <div className="initiative-workspace">
        <aside className="initiative-list" aria-label="Initiative list">
          {initiatives.map((initiative) => {
            const rollup = initiativeRollup(initiative, items);
            return (
              <button type="button" key={initiative.id} className={`initiative-list-item ${initiative.id === selected.id ? "is-selected" : ""}`} onClick={() => onSelect(initiative.id)}>
                <span className={`initiative-health-dot health-${initiative.health}`} />
                <span className="initiative-list-copy"><strong>{initiative.title}</strong><small>{initiative.owner || "Owner needed"} · {initiativeStatusLabels[initiative.status]}</small><span className="initiative-progress"><i style={{ width: `${rollup.progress}%` }} /></span></span>
                <span className="initiative-percent">{rollup.progress}%</span>
              </button>
            );
          })}
        </aside>
        <InitiativeDetail
          key={selected.id}
          initiative={selected}
          items={items}
          githubCache={githubCache}
          githubState={githubState}
          githubMessage={githubMessage}
          onUpdate={onUpdate}
          onOpenPacket={onOpenPacket}
          onSync={onSync}
        />
      </div>
    </section>
  );
}

export function InitiativeTimeline({ packetKeys, items, githubCache, githubState, githubMessage, onOpenPacket, onSync }) {
  const [filter, setFilter] = useState("all");
  const events = useMemo(
    () => buildInitiativeReleaseTimeline({ initiative: { packetKeys }, items, githubCache }),
    [packetKeys, items, githubCache],
  );
  const counts = events.reduce((summary, event) => ({
    ...summary,
    [event.type]: (summary[event.type] || 0) + 1,
  }), {});
  const visibleEvents = filter === "all" ? events : events.filter((event) => event.type === filter);
  const filters = [
    { id: "all", label: "All", count: events.length },
    { id: "packet", label: "Packets", count: counts.packet || 0 },
    { id: "pull_request", label: "Pull requests", count: counts.pull_request || 0 },
    { id: "deployment", label: "Deployments", count: counts.deployment || 0 },
  ];

  return (
    <section className="initiative-timeline" aria-label="Initiative release timeline" aria-busy={githubState === "syncing"}>
      <div className="initiative-timeline-head">
        <div>
          <span className="section-kicker">Release history</span>
          <h3>Release timeline</h3>
          <p>Packet completions, merged pull requests, and successful deployments tied to this initiative.</p>
        </div>
        <div className="initiative-timeline-sync">
          <button type="button" className="button secondary" onClick={onSync} disabled={githubState === "syncing"}>
            {githubState === "syncing" ? "Refreshing" : "Refresh GitHub"}
          </button>
          <small className={githubState === "failed" ? "is-failed" : ""} role={githubState === "failed" ? "alert" : "status"}>
            {githubMessage}
          </small>
        </div>
      </div>
      <div className="initiative-timeline-filters" aria-label="Release event filters">
        {filters.map((option) => (
          <button
            type="button"
            key={option.id}
            className={filter === option.id ? "is-active" : ""}
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
          >
            {option.label}<span>{option.count}</span>
          </button>
        ))}
      </div>
      <div className="initiative-timeline-list" aria-live="polite">
        {visibleEvents.map((event) => (
          <article className={`initiative-timeline-event event-${event.type}`} key={event.id}>
            <span className="initiative-timeline-marker" aria-hidden="true"><Icon name={event.type === "packet" ? "check" : event.type === "pull_request" ? "branch" : "repo"} /></span>
            <div className="initiative-timeline-copy">
              <div className="initiative-timeline-event-head">
                <div>
                  <span>{event.type === "packet" ? "Packet completed" : event.type === "pull_request" ? "Pull request merged" : "Deployed"}</span>
                  <strong>{event.title}</strong>
                </div>
                <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
              </div>
              <p>{event.summary}</p>
              <div className="initiative-timeline-meta">
                {event.repo ? <span>{event.repo}</span> : null}
                {event.packetKeys.map((key) => <span key={key}>{key}</span>)}
              </div>
            </div>
            <div className="initiative-timeline-action">
              {event.type === "packet" ? (
                <button type="button" onClick={() => onOpenPacket(event.packetKey)}>Open packet</button>
              ) : event.url ? (
                <a href={event.url} target="_blank" rel="noreferrer">{event.type === "pull_request" ? "View PR" : "View run"}<Icon name="external" /></a>
              ) : null}
            </div>
          </article>
        ))}
        {visibleEvents.length === 0 ? (
          <div className="initiative-timeline-empty">
            <Icon name="calendar" />
            <strong>{events.length === 0 ? "No release events yet" : `No ${filters.find((option) => option.id === filter)?.label.toLowerCase()} yet`}</strong>
            <span>{packetKeys.length === 0 ? "Link a work packet to start the timeline." : "Complete linked packets or refresh GitHub after a merge or deployment."}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function InitiativeDetail({ initiative, items, githubCache, githubState, githubMessage, onUpdate, onOpenPacket, onSync }) {
  const [draft, setDraft] = useState(() => initiativeDraft(initiative));
  const [saveState, setSaveState] = useState("idle");
  const [packetSaveState, setPacketSaveState] = useState("idle");
  const rollup = initiativeRollup(initiative, items);
  const unlinked = items.filter((item) => !(draft.packetKeys || []).includes(item.key));
  const change = (field, value) => setDraft((current) => ({ ...current, [field]: value }));

  useEffect(() => {
    setDraft(initiativeDraft(initiative));
    setPacketSaveState("idle");
  }, [initiative.id]);

  async function save(event) {
    event.preventDefault();
    setSaveState("saving");
    const saved = await onUpdate(initiative.id, {
      title: draft.title, objective: draft.objective, owner: draft.owner, status: draft.status, health: draft.health,
      targetDate: draft.targetDate, nextAction: draft.nextAction, blocker: draft.blocker,
      completionCriteria: draft.completionCriteria, labels: draft.labels, groupingGuidance: draft.groupingGuidance,
      packetKeys: draft.packetKeys,
    });
    setSaveState(saved ? "saved" : "failed");
    window.setTimeout(() => setSaveState("idle"), 1500);
  }

  async function persistPacketKeys(nextPacketKeys) {
    const previousPacketKeys = draft.packetKeys || [];
    const packetKeys = [...new Set(nextPacketKeys)];
    change("packetKeys", packetKeys);
    setPacketSaveState("saving");

    const saved = await onUpdate(initiative.id, { packetKeys });
    if (!saved) change("packetKeys", previousPacketKeys);
    setPacketSaveState(saved ? "saved" : "failed");
    window.setTimeout(() => setPacketSaveState("idle"), 1500);
  }

  function addPacket(key) {
    if (key) void persistPacketKeys([...(draft.packetKeys || []), key]);
  }

  function unlinkPacket(key) {
    void persistPacketKeys((draft.packetKeys || []).filter((candidate) => candidate !== key));
  }

  return (
    <form className="initiative-detail" aria-label="Selected initiative" onSubmit={save}>
      <div className="initiative-detail-head"><div><span className="section-kicker">Initiative brief</span><input className="initiative-title-input" aria-label="Initiative title" value={draft.title} onChange={(event) => change("title", event.target.value)} /></div><button type="submit" className="button primary" disabled={saveState === "saving"}>{saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : "Save initiative"}</button></div>
      <div className="initiative-field-grid">
        <label><span>Status</span><select aria-label="Initiative status" value={draft.status} onChange={(event) => change("status", event.target.value)}>{Object.entries(initiativeStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Health</span><select aria-label="Initiative health" value={draft.health} onChange={(event) => change("health", event.target.value)}>{Object.entries(initiativeHealthLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Owner</span><input aria-label="Initiative owner" value={draft.owner} onChange={(event) => change("owner", event.target.value)} placeholder="Who is driving this?" /></label>
        <label><span>Target</span><input aria-label="Initiative target date" type="date" value={draft.targetDate} onChange={(event) => change("targetDate", event.target.value)} /></label>
      </div>
      <label className="initiative-long-field"><span>Objective</span><textarea aria-label="Initiative objective" value={draft.objective} onChange={(event) => change("objective", event.target.value)} placeholder="What change are we trying to create?" /></label>
      <div className="initiative-two-column"><label className="initiative-long-field"><span>Labels</span><input aria-label="Initiative labels" value={draft.labels} onChange={(event) => change("labels", event.target.value)} placeholder="planning, delivery" /></label><label className="initiative-long-field"><span>Grouping guidance</span><textarea aria-label="Initiative grouping guidance" value={draft.groupingGuidance} onChange={(event) => change("groupingGuidance", event.target.value)} placeholder="Which packets belong together, and why?" /></label></div>
      <div className="initiative-rollup" aria-label="Initiative delivery rollup"><div><strong>{rollup.progress}%</strong><span>complete</span></div><div><strong>{rollup.done}/{rollup.packets.length}</strong><span>packets done</span></div><div><strong>{rollup.pullRequests.length}</strong><span>pull requests</span></div><span className="initiative-progress is-large"><i style={{ width: `${rollup.progress}%` }} /></span></div>
      <InitiativeTimeline packetKeys={draft.packetKeys || []} items={items} githubCache={githubCache} githubState={githubState} githubMessage={githubMessage} onOpenPacket={onOpenPacket} onSync={onSync} />
      <div className="initiative-two-column"><label className="initiative-long-field"><span>Next action</span><textarea aria-label="Initiative next action" value={draft.nextAction} onChange={(event) => change("nextAction", event.target.value)} placeholder="The next concrete move" /></label><label className="initiative-long-field"><span>Blocker</span><textarea aria-label="Initiative blocker" value={draft.blocker} onChange={(event) => change("blocker", event.target.value)} placeholder="Nothing blocking this initiative" /></label></div>
      <label className="initiative-long-field"><span>Completion criteria</span><textarea aria-label="Initiative completion criteria" value={draft.completionCriteria} onChange={(event) => change("completionCriteria", event.target.value)} placeholder="One measurable condition per line" /></label>
      <section className="initiative-packets" aria-label="Linked work packets">
        <div className="initiative-section-head"><div><span className="section-kicker">Delivery</span><h3>Linked work packets</h3></div><select aria-label="Add linked packet" value="" disabled={packetSaveState === "saving"} onChange={(event) => addPacket(event.target.value)}><option value="">Add packet…</option>{unlinked.map((item) => <option key={item.key} value={item.key}>{item.key} · {item.title}</option>)}</select></div>
        <div className="initiative-packet-list">{(draft.packetKeys || []).map((key) => { const item = items.find((candidate) => candidate.key === key); return <div className="initiative-packet" key={key}><button type="button" onClick={() => onOpenPacket(key)}><span>{key}</span><strong>{item?.title || "Packet not loaded"}</strong><small>{item ? formatStatus(item.status) : "Missing"}</small></button><button type="button" className="initiative-unlink" aria-label={`Unlink ${key}`} disabled={packetSaveState === "saving"} onClick={() => unlinkPacket(key)}>×</button></div>; })}{(draft.packetKeys || []).length === 0 ? <div className="shipped-empty">No packets linked yet. Add one to start the delivery rollup.</div> : null}</div>
        <span className="detail-note" role="status">{packetSaveState === "saving" ? "Saving packet links" : packetSaveState === "saved" ? "Packet links saved" : packetSaveState === "failed" ? "Packet links failed to save" : ""}</span>
      </section>
    </form>
  );
}

export function InitiativeComposer({ onClose, onCreate, items }) {
  const [stage, setStage] = useState("source");
  const [source, setSource] = useState({ templateId: "", packetKeys: [] });
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const change = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = items.filter((item) => !normalizedQuery || [item.key, item.title, item.project, item.repo]
    .filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery));
  const titleId = "initiative-composer-title";
  const descriptionId = "initiative-composer-description";

  function togglePacket(key) {
    setSource((current) => ({
      ...current,
      packetKeys: current.packetKeys.includes(key)
        ? current.packetKeys.filter((candidate) => candidate !== key)
        : [...current.packetKeys, key],
    }));
  }

  function reviewSuggestion() {
    const suggestion = buildInitiativeSuggestion({ ...source, packets: items });
    setForm({
      ...suggestion,
      completionCriteria: suggestion.completionCriteria.join("\n"),
      labels: suggestion.labels.join(", "),
      owner: "",
      targetDate: "",
    });
    setStage("review");
  }

  async function submit(event) {
    event.preventDefault();
    if (stage === "source") {
      reviewSuggestion();
      return;
    }
    setSubmitting(true);
    setError("");
    const created = await onCreate({ ...form, status: "active", health: "on_track" });
    if (!created) {
      setError("The initiative could not be created. Review the sync status and try again.");
      setSubmitting(false);
    }
  }

  function requestClose() {
    if (!submitting) {
      onClose();
    }
  }

  return (
    <ModalDialog
      as="form"
      className="composer initiative-composer"
      labelledBy={titleId}
      describedBy={`${descriptionId}${error ? " initiative-composer-error" : ""}`}
      initialFocusSelector="[aria-label='Initiative template']"
      onClose={requestClose}
      preventDismiss={submitting}
      onSubmit={submit}
    >
        <div className="composer-header">
          <div>
            <span className="eyebrow">Portfolio · {stage === "source" ? "1 of 2" : "2 of 2"}</span>
            <h2 id={titleId}>{stage === "source" ? "Bootstrap initiative" : "Review initiative suggestion"}</h2>
            <p id={descriptionId}>{stage === "source" ? "Start from a reusable pattern, existing work, or both." : "Everything below is editable and nothing is saved until you confirm."}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close initiative composer" onClick={requestClose} disabled={submitting}>
            <Icon name="close" />
          </button>
        </div>
        {stage === "source" ? (
          <>
            <div className="composer-grid">
              <label className="span-2"><span>Initiative template</span><select aria-label="Initiative template" value={source.templateId} onChange={(event) => setSource((current) => ({ ...current, templateId: event.target.value }))}><option value="">No template · use packet context</option>{initiativeTemplates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}</select></label>
              <label className="span-2"><span>Find packet context</span><input type="search" aria-label="Find initiative packets" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search key, title, project, or repo" /></label>
            </div>
            <fieldset className="initiative-context-picker" aria-label="Initiative packet context">
              <legend>Selected packet context <span>{source.packetKeys.length}</span></legend>
              <div className="initiative-context-list">
                {visibleItems.map((item) => <label key={item.key} className={source.packetKeys.includes(item.key) ? "is-selected" : ""}><input type="checkbox" aria-label={`Select ${item.key}`} checked={source.packetKeys.includes(item.key)} onChange={() => togglePacket(item.key)} /><span><strong>{item.key} · {item.title}</strong><small>{item.project || "No project"} · {item.repo || "No repository"}</small></span></label>)}
                {!visibleItems.length ? <div className="shipped-empty">No matching work packets.</div> : null}
              </div>
            </fieldset>
          </>
        ) : (
          <>
            <div className="initiative-suggestion-note" role="note"><strong>Generated suggestion</strong><span>Review every field. Nothing is saved until you confirm; your edits—not the template—are what will be persisted.</span></div>
            <div className="composer-grid">
              <label className="span-2"><span>Title <small>Suggested</small></span><input aria-label="New initiative title" required value={form.title} onChange={(event) => change("title", event.target.value)} /></label>
              <label className="span-2"><span>Objective <small>Suggested</small></span><textarea aria-label="New initiative objective" value={form.objective} onChange={(event) => change("objective", event.target.value)} /></label>
              <label><span>Owner</span><input aria-label="New initiative owner" value={form.owner} onChange={(event) => change("owner", event.target.value)} /></label>
              <label><span>Target</span><input aria-label="New initiative target date" type="date" value={form.targetDate} onChange={(event) => change("targetDate", event.target.value)} /></label>
              <label className="span-2"><span>Completion criteria <small>Suggested</small></span><textarea aria-label="New initiative completion criteria" value={form.completionCriteria} onChange={(event) => change("completionCriteria", event.target.value)} /></label>
              <label className="span-2"><span>Labels <small>Suggested</small></span><input aria-label="New initiative labels" value={form.labels} onChange={(event) => change("labels", event.target.value)} /></label>
              <label className="span-2"><span>Grouping guidance <small>Suggested</small></span><textarea aria-label="New initiative grouping guidance" value={form.groupingGuidance} onChange={(event) => change("groupingGuidance", event.target.value)} /></label>
            </div>
            <div className="initiative-context-summary" aria-label="Packets to link">{form.packetKeys.length ? form.packetKeys.map((key) => <span key={key}>{key}</span>) : <span>No packets selected</span>}</div>
          </>
        )}
        {error ? <div className="auth-error" id="initiative-composer-error" role="alert">{error}</div> : null}
        <div className="composer-actions">
          {stage === "review" ? <button type="button" className="button secondary" onClick={() => setStage("source")} disabled={submitting}>Back</button> : null}
          <button type="button" className="button secondary" onClick={requestClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="button primary" disabled={submitting}>{stage === "source" ? "Review initiative" : submitting ? "Creating initiative" : "Confirm and create"}</button>
        </div>
    </ModalDialog>
  );
}

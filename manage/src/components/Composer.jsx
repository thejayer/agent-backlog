import React, { useState } from "react";
import { Icon } from "./Icon.jsx";
import { ModalDialog } from "./ModalDialog.jsx";
import { packetTemplates } from "../data/packetTemplates.mjs";
import { priorityOptions, repositories } from "../data/workItems.mjs";

const repoOptions = repositories.map((repo) => repo.id);

export function Composer({ onClose, onCreate }) {
  const [form, setForm] = useState({
    templateId: "",
    title: "",
    repo: "web-app",
    priority: "medium",
    project: "Agent Backlog",
    branch: "",
    agent: "Codex",
    labels: "",
    summary: "",
    desiredOutcome: "",
    acceptanceCriteria: "",
    relevantFiles: "",
    relevantUrls: "",
    implementationNotes: "",
    testCommands: "npm.cmd test",
    deployNotes: "",
    ready: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function applyTemplate(templateId) {
    const template = packetTemplates.find((candidate) => candidate.id === templateId);

    if (!template) {
      update("templateId", "");
      return;
    }

    setForm((current) => ({
      ...current,
      ...template,
      templateId,
      branch: "",
      ready: false,
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const created = await onCreate(form);
    if (!created) {
      setError("The packet could not be created. Review the sync status and try again.");
      setSubmitting(false);
    }
  }

  return (
    <ModalDialog
      as="form"
      className="composer"
      labelledBy="packet-composer-title"
      describedBy={`packet-composer-description${error ? " packet-composer-error" : ""}`}
      initialFocusSelector="#packet-composer-title-input"
      onClose={onClose}
      preventDismiss={submitting}
      onSubmit={submit}
    >
        <div className="composer-header">
          <div>
            <h2 id="packet-composer-title">New work packet</h2>
            <p id="packet-composer-description">Capture enough context for a coding agent to start cleanly.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close" disabled={submitting}>
            <Icon name="close" />
          </button>
        </div>

        <div className="composer-grid">
          <label className="span-2">
            <span>Template</span>
            <select data-testid="composer-template" value={form.templateId} onChange={(event) => applyTemplate(event.target.value)}>
              <option value="">Blank packet</option>
              {packetTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            <span>Title</span>
            <input id="packet-composer-title-input" value={form.title} onChange={(event) => update("title", event.target.value)} required />
          </label>
          <label>
            <span>Repo</span>
            <select data-testid="composer-repo" value={form.repo} onChange={(event) => update("repo", event.target.value)}>
              {repoOptions.map((repo) => (
                <option key={repo} value={repo}>
                  {repo}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Priority</span>
            <select value={form.priority} onChange={(event) => update("priority", event.target.value)}>
              {priorityOptions.map((priority) => (
                <option key={priority.id} value={priority.id}>
                  {priority.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Project</span>
            <input value={form.project} onChange={(event) => update("project", event.target.value)} />
          </label>
          <label>
            <span>Agent</span>
            <select value={form.agent} onChange={(event) => update("agent", event.target.value)}>
              <option value="">Any agent</option>
              <option value="Codex">Codex</option>
              <option value="Claude Code">Claude Code</option>
            </select>
          </label>
          <label className="span-2">
            <span>Suggested branch</span>
            <input value={form.branch} onChange={(event) => update("branch", event.target.value)} placeholder="Auto-generated if blank" />
          </label>
          <label className="span-2">
            <span>Labels</span>
            <input value={form.labels} onChange={(event) => update("labels", event.target.value)} placeholder="bug, ui, qa" />
          </label>
          <label className="span-2">
            <span>Problem statement</span>
            <textarea value={form.summary} onChange={(event) => update("summary", event.target.value)} rows="3" required />
          </label>
          <label className="span-2">
            <span>Desired outcome</span>
            <textarea value={form.desiredOutcome} onChange={(event) => update("desiredOutcome", event.target.value)} rows="3" required />
          </label>
          <label>
            <span>Acceptance criteria</span>
            <textarea value={form.acceptanceCriteria} onChange={(event) => update("acceptanceCriteria", event.target.value)} rows="7" placeholder="One per line" />
          </label>
          <label>
            <span>Relevant files</span>
            <textarea value={form.relevantFiles} onChange={(event) => update("relevantFiles", event.target.value)} rows="7" placeholder="One per line" />
          </label>
          <label>
            <span>Relevant URLs</span>
            <textarea value={form.relevantUrls} onChange={(event) => update("relevantUrls", event.target.value)} rows="5" placeholder="One per line" />
          </label>
          <label>
            <span>Implementation notes</span>
            <textarea value={form.implementationNotes} onChange={(event) => update("implementationNotes", event.target.value)} rows="5" placeholder="One per line" />
          </label>
          <label>
            <span>Test commands</span>
            <textarea value={form.testCommands} onChange={(event) => update("testCommands", event.target.value)} rows="4" placeholder="One per line" />
          </label>
          <label>
            <span>Deploy notes</span>
            <textarea value={form.deployNotes} onChange={(event) => update("deployNotes", event.target.value)} rows="4" />
          </label>
        </div>

        <label className="ready-toggle">
          <input type="checkbox" checked={form.ready} onChange={(event) => update("ready", event.target.checked)} />
          <span>Mark ready for agent</span>
        </label>

        {error ? <div className="auth-error" id="packet-composer-error" role="alert">{error}</div> : null}
        <div className="composer-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={submitting}>
            {submitting ? "Creating packet" : "Create packet"}
          </button>
        </div>
    </ModalDialog>
  );
}

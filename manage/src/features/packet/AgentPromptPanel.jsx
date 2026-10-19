import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { Endpoint } from "../../components/workUi.jsx";
import { itemLabels } from "../backlog/useBacklogController.mjs";

export function AgentPromptPanel({
  selectedItem,
  selectedPrompt,
  selectedTaskUrl,
  selectedTaskJsonUrl,
  selectedRepoSlug,
  secretName,
  copyState,
  copyMessage,
  onCopyPrompt,
  onCopyText,
  codexPickupCommand,
  claudePickupCommand,
  claimCommand,
  progressCommand,
  reviewCommand,
  agentRunbook,
  tokenBootstrapCommand,
  claimPowerShellCommand,
  progressPowerShellCommand,
  reviewPowerShellCommand,
  repoHandoffCommand,
  prReadyPowerShellCommand,
  reviewPollPowerShellCommand,
  visualQaFallbackCommand,
  postMergeCloseoutCommand,
  donePowerShellCommand,
}) {
  return (
          <aside className="agent-panel" aria-label="Agent prompt">
            <div className="agent-header">
              <div>
                <h2>Agent prompt</h2>
                <p>{selectedItem.key}.md</p>
              </div>
              <div className="agent-actions">
                <button type="button" className="icon-button" onClick={onCopyPrompt} aria-label="Copy prompt">
                  <Icon name="copy" />
                </button>
                <a className="icon-button" href={`/agent/${selectedItem.key}.md`} target="_blank" rel="noreferrer" aria-label="Open Markdown">
                  <Icon name="external" />
                </a>
              </div>
            </div>
            <div className="task-url" aria-label="Selected task URL">
              <span>Task URL</span>
              <a href={selectedTaskUrl} target="_blank" rel="noreferrer">
                {selectedTaskUrl}
              </a>
            </div>
            <div className={`copy-state ${copyState !== "idle" ? "is-visible" : ""}`}>
              {copyState === "copied" ? copyMessage || "Copied" : "Copy failed"}
            </div>
            <div className="pickup-actions" aria-label="Agent pickup commands">
              <button type="button" className="button secondary" onClick={() => onCopyText(selectedTaskUrl, "Task URL copied")}>
                Copy task URL
              </button>
              <button type="button" className="button secondary" onClick={() => onCopyText(codexPickupCommand, "Codex command copied")}>
                Copy Codex command
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => onCopyText(claudePickupCommand, "Claude command copied")}
              >
                Copy Claude command
              </button>
              <button type="button" className="button secondary" onClick={() => onCopyText(claimCommand, "Claim command copied")}>
                Copy claim command
              </button>
              <button type="button" className="button secondary" onClick={() => onCopyText(progressCommand, "Progress update copied")}>
                Copy progress update
              </button>
              <button type="button" className="button secondary" onClick={() => onCopyText(reviewCommand, "Review update copied")}>
                Copy review update
              </button>
              <a className="button secondary" href="/agent/instructions.md" target="_blank" rel="noreferrer">
                Instructions
              </a>
            </div>
            <section className="agent-runbook" aria-label="Agent runbook">
              <div className="agent-runbook-head">
                <div>
                  <h3>Agent runbook</h3>
                  <p>Handoff for {selectedItem.key}</p>
                </div>
                <button type="button" className="button secondary" onClick={() => onCopyText(agentRunbook, "Runbook copied")}>
                  Copy full runbook
                </button>
              </div>
              <div className="runbook-facts">
                <div>
                  <span>Token</span>
                  <strong>Env var</strong>
                  <code>{secretName}</code>
                </div>
                <div>
                  <span>Shell</span>
                  <strong>PowerShell</strong>
                  <code>Invoke-RestMethod</code>
                </div>
                <div>
                  <span>Repo</span>
                  <strong>{selectedItem.repo}</strong>
                  <code>{selectedRepoSlug}</code>
                </div>
              </div>
              <ol className="runbook-checklist">
                <li>Load the token into $env:MANAGE_AUTH_TOKEN.</li>
                <li>Claim the packet before editing code.</li>
                <li>Branch from origin/main or origin/master.</li>
                <li>Run the listed tests and visual QA.</li>
                <li>Write back needs_review with PR and checks.</li>
                <li>Mark the PR ready, poll checks, and record CodeRabbit exactly as reported.</li>
                <li>After merge, run post-merge closeout to verify the PR and write back done with merge/check details.</li>
              </ol>
              <div className="runbook-actions" aria-label="Runbook commands">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onCopyText(tokenBootstrapCommand, "Token bootstrap copied")}
                >
                  Token bootstrap
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onCopyText(claimPowerShellCommand, "PowerShell claim copied")}
                >
                  PS claim
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onCopyText(progressPowerShellCommand, "PowerShell progress copied")}
                >
                  PS progress
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onCopyText(reviewPowerShellCommand, "PowerShell review copied")}
                >
                  PS review
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onCopyText(repoHandoffCommand, "Repo handoff copied")}
                >
                  Repo handoff
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onCopyText(prReadyPowerShellCommand, "PR ready/checks copied")}
                >
                  PR ready/checks
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onCopyText(reviewPollPowerShellCommand, "Review poll copied")}
                >
                  Poll review
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onCopyText(visualQaFallbackCommand, "Visual QA fallback copied")}
                >
                  QA fallback
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onCopyText(postMergeCloseoutCommand, "Post-merge closeout copied")}
                >
                  Post-merge closeout
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onCopyText(donePowerShellCommand, "PowerShell done copied")}
                >
                  PS done
                </button>
              </div>
            </section>
            <pre className="prompt-preview" tabIndex={0} aria-label="Rendered agent prompt">{selectedPrompt}</pre>
            <div className="endpoint-list">
              <Endpoint label="Task URL" value={selectedTaskUrl} />
              <Endpoint label="Instructions" value="/agent/instructions.md" />
              <Endpoint label="Bootstrap" value="/api/agent/bootstrap" />
              <Endpoint label="Markdown" value={`/agent/${selectedItem.key}.md`} />
              <Endpoint label="JSON" value={`/api/agent/tasks/${selectedItem.key}`} />
              <Endpoint label="Task JSON" value={selectedTaskJsonUrl} />
              <Endpoint label="Next" value={`/api/agent/next?repo=${selectedItem.repo}`} />
              <Endpoint label="Next label" value={`/api/agent/next?label=${itemLabels(selectedItem)[0] || "label"}`} />
              <Endpoint label="Next claim" value="POST /api/agent/next/claim" />
              <Endpoint label="Claim" value={`POST /api/agent/tasks/${selectedItem.key}/claim`} />
              <Endpoint label="Status" value={`POST /api/agent/tasks/${selectedItem.key}/status`} />
              <Endpoint label="Recovery" value={`POST /api/agent/tasks/${selectedItem.key}/recovery`} />
            </div>
          </aside>
  );
}

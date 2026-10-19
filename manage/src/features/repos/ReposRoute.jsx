import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { StatusPill } from "../../components/workUi.jsx";
import { blockedRepoIds } from "../../lib/repoHealth.mjs";
import {
  formatDateTime,
  formatGithubSyncValue,
  formatProviderState,
  formatRepoSyncFreshness,
  formatStorageKind,
  githubMatchCount,
  githubSyncTone,
  manageOrigin,
  repoHealthStatus,
} from "../../lib/manageFormat.mjs";

export function SystemStatusPanel({ systemStatus, systemState, systemMessage, onRefresh }) {
  const storageKind = systemStatus?.storage?.kind;
  const baseUrl = systemStatus?.baseUrl || manageOrigin();
  const githubLoginEnabled = Boolean(systemStatus?.auth?.providers?.github);
  const tokenLoginEnabled = Boolean(systemStatus?.auth?.providers?.token);
  const githubSync = systemStatus?.githubSync;
  const backupRetention = systemStatus?.storage?.backups?.retention;
  const backupsEnabled = Boolean(systemStatus?.storage?.backups?.enabled);

  return (
    <section className="system-status" aria-label="System status">
      <div className="system-status-main">
        <div>
          <h2>System status</h2>
          <p>{systemMessage}</p>
        </div>
        <div className="system-status-grid">
          <SystemStatusItem label="Base URL" value={baseUrl} />
          <SystemStatusItem label="Storage" value={formatStorageKind(storageKind)} tone={storageKind === "firestore" ? "ready" : "info"} />
          <SystemStatusItem label="Auth" value={formatProviderState(githubLoginEnabled, "GitHub")} tone={githubLoginEnabled ? "ready" : "info"} />
          <SystemStatusItem label="Operator token" value={formatProviderState(tokenLoginEnabled, "Break-glass")} tone={tokenLoginEnabled ? "ready" : "blocked"} />
          <SystemStatusItem label="GitHub sync" value={formatGithubSyncValue(githubSync)} tone={githubSyncTone(githubSync)} />
          <SystemStatusItem
            label="Backups"
            value={backupsEnabled ? `Last ${backupRetention}` : "Off"}
            tone={backupsEnabled ? "ready" : "blocked"}
          />
        </div>
      </div>
      <button type="button" className="button secondary" onClick={onRefresh} disabled={systemState === "loading"}>
        {systemState === "loading" ? "Checking" : "Refresh status"}
      </button>
    </section>
  );
}

export function SystemStatusItem({ label, value, tone = "info" }) {
  return (
    <div className={`system-status-item status-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function BackupPanel({ backups, backupState, backupMessage, onRefresh, onCreate, onRestore }) {
  const latestBackup = backups[0];

  return (
    <section className="backup-panel" aria-label="Backups">
      <div className="section-title-row">
        <div>
          <h2>Backups</h2>
          <p>
            {latestBackup
              ? `${backupMessage}. Latest ${formatDateTime(latestBackup.createdAt)}.`
              : backupMessage}
          </p>
        </div>
        <div className="backup-actions">
          <a className="button secondary" href="/api/backups/export" target="_blank" rel="noreferrer">
            Export backlog
          </a>
          <button type="button" className="button secondary" onClick={onRefresh} disabled={backupState === "loading"}>
            {backupState === "loading" ? "Refreshing" : "Refresh"}
          </button>
          <button type="button" className="button primary" onClick={onCreate} disabled={backupState === "saving"}>
            {backupState === "saving" ? "Saving" : "Create snapshot"}
          </button>
        </div>
      </div>

      <div className="backup-table">
        {backups.length === 0 ? (
          <div className="backup-empty">No backup snapshots recorded</div>
        ) : (
          backups.slice(0, 6).map((snapshot) => (
            <article key={snapshot.id} className="backup-row">
              <div>
                <strong>{snapshot.reason || "manual"}</strong>
                <span>{snapshot.id}</span>
              </div>
              <span>{formatDateTime(snapshot.createdAt)}</span>
              <span>{snapshot.stats?.workItems ?? 0} packets</span>
              <span>{snapshot.stats?.githubRepos ?? 0} repos</span>
              <span>{snapshot.automatic ? "Auto" : "Manual"}</span>
              <button
                type="button"
                className="button secondary"
                onClick={() => onRestore(snapshot)}
                disabled={backupState === "restoring"}
              >
                {backupState === "restoring" ? "Restoring" : "Restore"}
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

export function MergedPullReconciliation({
  githubState,
  reconciliation,
  reconciliationSyncState,
  reconciliationActionState,
  reconciliationMessage,
  reconciliationAction,
  onLinkMerge,
  onCreateFollowUp,
  onOpenPacket,
}) {
  const unmatchedMerges = reconciliation?.unmatchedMergedPullRequests || [];
  const reconciliationDisplayState = reconciliationActionState !== "idle"
    ? reconciliationActionState
    : reconciliationSyncState;

  return (
    <section className="reconciliation-panel" aria-label="Merged pull request reconciliation">
      <div className="reconciliation-head">
        <div>
          <span className="section-kicker">Delivery reconciliation</span>
          <h2>Merged PRs without packets</h2>
          <p>Match cached GitHub merges to an existing packet by TASK key, or open a follow-up draft.</p>
        </div>
        <div className="reconciliation-summary">
          <strong>{unmatchedMerges.length}</strong>
          <span>{unmatchedMerges.length === 1 ? "unmatched merge" : "unmatched merges"}</span>
        </div>
      </div>

      <div
        className={`reconciliation-status ${reconciliationDisplayState === "failed" ? "is-failed" : ""}`}
        role={reconciliationDisplayState === "failed" && githubState !== "failed" ? "alert" : "status"}
      >
        {reconciliationMessage}
      </div>

      {unmatchedMerges.length ? (
        <div className="reconciliation-list">
          {unmatchedMerges.map((pullRequest) => {
            const suggestedPacket = pullRequest.suggestedPacket;
            const linkActionKey = `link:${pullRequest.id}`;
            const followUpActionKey = `follow_up:${pullRequest.id}`;
            const anyActionPending = Boolean(reconciliationAction);

            return (
              <article className="reconciliation-item" key={pullRequest.id}>
                <div className="reconciliation-pr">
                  <div className="reconciliation-meta">
                    <span>{pullRequest.repoId} #{pullRequest.number}</span>
                    <time dateTime={pullRequest.mergedAt}>Merged {formatDateTime(pullRequest.mergedAt)}</time>
                  </div>
                  <a href={pullRequest.url} target="_blank" rel="noreferrer">{pullRequest.title}</a>
                  <small>{pullRequest.branch || "Branch not recorded"}</small>
                </div>

                <div className={`reconciliation-suggestion ${suggestedPacket ? `is-${suggestedPacket.confidence}` : "is-none"}`}>
                  <span>Strongest packet match</span>
                  {suggestedPacket ? (
                    <>
                      <button
                        type="button"
                        className="reconciliation-packet-link"
                        onClick={() => onOpenPacket(suggestedPacket.key)}
                      >
                        <strong>{suggestedPacket.key} · {suggestedPacket.title}</strong>
                      </button>
                      <small>{suggestedPacket.reason} · {suggestedPacket.confidence} confidence</small>
                    </>
                  ) : (
                    <>
                      <strong>No credible match</strong>
                      <small>Create a draft follow-up to record this merge.</small>
                    </>
                  )}
                </div>

                <div className="reconciliation-actions">
                  {suggestedPacket ? (
                    <button
                      type="button"
                      className="button primary"
                      aria-label={`Link ${suggestedPacket.key} to ${pullRequest.repoId} PR #${pullRequest.number}`}
                      disabled={anyActionPending}
                      onClick={() => onLinkMerge(pullRequest, suggestedPacket.key)}
                    >
                      {reconciliationAction === linkActionKey ? "Linking" : `Link ${suggestedPacket.key}`}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="button secondary"
                    aria-label={`Create follow-up for ${pullRequest.repoId} PR #${pullRequest.number}`}
                    disabled={anyActionPending}
                    onClick={() => onCreateFollowUp(pullRequest)}
                  >
                    {reconciliationAction === followUpActionKey ? "Creating" : "Create follow-up"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="reconciliation-empty">
          <Icon name="review" />
          <div>
            <strong>Every cached merge has a packet</strong>
            <span>Refresh GitHub to check for newly merged pull requests.</span>
          </div>
        </div>
      )}
    </section>
  );
}

export function RepoHealth({
  repositories,
  githubCache,
  githubState,
  githubMessage,
  reconciliation,
  reconciliationSyncState,
  reconciliationActionState,
  reconciliationMessage,
  reconciliationAction,
  onSync,
  onMockSync,
  onLinkAll,
  onImportIssues,
  onLinkMerge,
  onCreateFollowUp,
  onOpenPacket,
  linkState,
  issueImportState,
}) {
  const githubByRepo = new Map((githubCache?.repos || []).map((repo) => [repo.id, repo]));
  const cacheFreshness = githubFreshnessFromState(githubCache?.syncState, githubCache?.source);

  return (
    <section className="repo-health" aria-label="Repository health">
      <div className="section-title-row">
        <div>
          <h2>Repo health</h2>
          <p>
            {githubCache?.syncedAt
              ? `${githubMessage}. Cache ${cacheFreshness}. Last sync ${new Date(githubCache.syncedAt).toLocaleString()}.`
              : githubMessage}
          </p>
        </div>
        <div className="repo-actions">
          <button type="button" className="button secondary" onClick={onMockSync}>
            Mock sync
          </button>
          <button type="button" className="button secondary" onClick={onLinkAll} disabled={linkState === "linking"}>
            {linkState === "linking" ? "Linking" : "Link packets"}
          </button>
          <button type="button" className="button secondary" onClick={onImportIssues} disabled={issueImportState === "importing"}>
            {issueImportState === "importing" ? "Importing" : "Import issues"}
          </button>
          <button type="button" className="button primary" onClick={onSync} disabled={githubState === "syncing"}>
            {githubState === "syncing" ? "Syncing" : "Sync GitHub"}
          </button>
        </div>
      </div>
      <div className={`repo-sync-note sync-${cacheFreshness}`}>
        <span className="dot" />
        {githubCache?.syncedAt
          ? `${cacheFreshness === "stale" ? "Stale" : cacheFreshness === "fresh" ? "Fresh" : "Unknown"} · Last sync ${formatDateTime(githubCache.syncedAt)}`
          : githubMessage}
      </div>
      <MergedPullReconciliation
        githubState={githubState}
        reconciliation={reconciliation}
        reconciliationSyncState={reconciliationSyncState}
        reconciliationActionState={reconciliationActionState}
        reconciliationMessage={reconciliationMessage}
        reconciliationAction={reconciliationAction}
        onLinkMerge={onLinkMerge}
        onCreateFollowUp={onCreateFollowUp}
        onOpenPacket={onOpenPacket}
      />
      <div className="repo-grid">
        {repositories.map((repo) => {
          const syncedRepo = githubByRepo.get(repo.id);
          const branchValue = syncedRepo?.branches;
          const branchCount = Array.isArray(branchValue) ? branchValue.length : Number(branchValue || 0);
          const repoStats = {
            openPrs: syncedRepo?.openPrs ?? repo.openPrs ?? 0,
            openIssues: syncedRepo?.openIssues ?? 0,
            failedRuns: syncedRepo?.failedRuns ?? repo.failedRuns ?? 0,
            branches: Number.isFinite(branchCount) ? branchCount : 0,
            defaultBranch: syncedRepo?.defaultBranch || "main",
            syncError: syncedRepo?.syncError || "",
            freshness: formatRepoSyncFreshness(syncedRepo, githubCache),
          };
          const repoUrl = `https://github.com/${repo.owner || "your-org"}/${repo.name}`;
          const freshnessTone = String(repoStats.freshness).toLowerCase();

          return (
            <article key={repo.id} className="repo-tile">
              <div className="repo-tile-head">
                <div>
                  <div className="rt-name">{repo.name}</div>
                  <div className="rt-domain">{repo.domain || repo.id}</div>
                </div>
                <div className="repo-tile-badges">
                  <span className={`repo-freshness freshness-${freshnessTone}`}>{repoStats.freshness}</span>
                  <StatusPill status={repoHealthStatus(repo)} />
                </div>
              </div>
              <p>{repo.description}</p>
              {repoStats.syncError ? <small className="repo-sync-error">{repoStats.syncError}</small> : null}
              <div className="repo-stats">
                <RepoStat label="PRs" value={repoStats.openPrs} />
                <RepoStat label="Issues" value={repoStats.openIssues} />
                <RepoStat label="Failed" value={repoStats.failedRuns} alert={repoStats.failedRuns > 0} />
                <RepoStat label="Branches" value={repoStats.branches} />
              </div>
              <div className="repo-tile-foot">
                <span className="rf-branch">
                  <Icon name="branch" />
                  {repoStats.defaultBranch}
                </span>
                <a className="button secondary" href={repoUrl} target="_blank" rel="noreferrer">
                  Open repo
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function RepoStat({ label, value, alert = false }) {
  return (
    <div className={`repo-stat ${alert ? "is-alert" : ""}`}>
      <div className="rs-value">{value}</div>
      <div className="rs-label">{label}</div>
    </div>
  );
}

export function ReposRoute({
  systemStatus,
  systemState,
  systemMessage,
  onRefreshStatus,
  repositories,
  githubCache,
  githubState,
  githubMessage,
  reconciliation,
  reconciliationSyncState,
  reconciliationActionState,
  reconciliationMessage,
  reconciliationAction,
  onSync,
  onMockSync,
  onLinkAll,
  onImportIssues,
  onLinkMerge,
  onCreateFollowUp,
  onOpenPacket,
  linkState,
  issueImportState,
  backups,
  backupState,
  backupMessage,
  onRefreshBackups,
  onCreateBackup,
  onRestoreBackup,
}) {
  return (
    <>
      <SystemStatusPanel
        systemStatus={systemStatus}
        systemState={systemState}
        systemMessage={systemMessage}
        onRefresh={onRefreshStatus}
      />
      <RepoHealth
        repositories={repositories}
        githubCache={githubCache}
        githubState={githubState}
        githubMessage={githubMessage}
        reconciliation={reconciliation}
        reconciliationSyncState={reconciliationSyncState}
        reconciliationActionState={reconciliationActionState}
        reconciliationMessage={reconciliationMessage}
        reconciliationAction={reconciliationAction}
        onSync={onSync}
        onMockSync={onMockSync}
        onLinkAll={onLinkAll}
        onImportIssues={onImportIssues}
        onLinkMerge={onLinkMerge}
        onCreateFollowUp={onCreateFollowUp}
        onOpenPacket={onOpenPacket}
        linkState={linkState}
        issueImportState={issueImportState}
      />
      <BackupPanel
        backups={backups}
        backupState={backupState}
        backupMessage={backupMessage}
        onRefresh={onRefreshBackups}
        onCreate={onCreateBackup}
        onRestore={onRestoreBackup}
      />
    </>
  );
}

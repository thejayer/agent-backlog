import React, { useEffect, useState } from "react";
import { ModalDialog } from "./ModalDialog.jsx";

export const themeOptions = ["light", "dark", "glass"];
export const themeLabels = { light: "Light", dark: "Dark", glass: "Glass" };
export const densityOptions = [
  { id: "compact", label: "Compact" },
  { id: "regular", label: "Regular" },
  { id: "comfortable", label: "Comfortable" },
];

export const navItems = [
  { id: "today", label: "Today", icon: "dashboard" },
  { id: "backlog", label: "Backlog", icon: "queue" },
  { id: "initiatives", label: "Initiatives", icon: "initiative" },
  { id: "shipped", label: "Shipped", icon: "calendar" },
  { id: "repos", label: "Repos", icon: "repo" },
  { id: "agents", label: "Agents", icon: "agent" },
  { id: "review", label: "Review", icon: "review" },
];

export const viewCopy = {
  today: {
    eyebrow: "Console",
    title: "Today",
    description: "Packets and exceptions that need a human now, ranked for action.",
  },
  backlog: {
    eyebrow: "Workspace",
    title: "AI-ready backlog",
    description: "Create work packets that coding agents can pick up without another context handoff.",
  },
  initiatives: {
    eyebrow: "Workspace",
    title: "Initiatives",
    description: "Connect related packets to an outcome, owner, health signal, and release timeline.",
  },
  shipped: {
    eyebrow: "Progress",
    title: "Shipped work",
    description: "See completed packets and merged pull requests by day, then drill into what shipped.",
  },
  repos: {
    eyebrow: "Operations",
    title: "Repository health",
    description: "Review GitHub sync state, unmatched merged pull requests, and backlog snapshots across the app family.",
  },
  agents: {
    eyebrow: "Operations",
    title: "Agent activity",
    description: "Track active claims, leases, and recent handoffs before starting more work.",
  },
  review: {
    eyebrow: "Workspace",
    title: "Review queue",
    description: "Inspect packets that agents have written back for reviewer sign-off.",
  },
};

function OperatorControls({
  densityMode,
  themeMode,
  sessionMode,
  sessionUser,
  syncState,
  syncMessage,
  loadState,
  onDensityModeChange,
  onThemeModeChange,
  onReset,
  onLogout,
  initialFocus = false,
}) {
  return (
    <>
      <label className="shell-control">
        <span>Density</span>
        <select
          aria-label="Density"
          data-settings-initial-focus={initialFocus ? "true" : undefined}
          value={densityMode}
          onChange={(event) => onDensityModeChange(event.target.value)}
        >
          {densityOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="shell-control shell-theme-control">
        <span>Theme</span>
        <select aria-label="Theme" value={themeMode} onChange={(event) => onThemeModeChange(event.target.value)}>
          {themeOptions.map((option) => (
            <option key={option} value={option}>
              {themeLabels[option]}
            </option>
          ))}
        </select>
      </label>
      <div className="session-chip" title={sessionUser?.login || sessionMode}>
        {sessionMode === "github" ? `GitHub: ${sessionUser?.login || "signed in"}` : "Token session"}
      </div>
      <div className={`sync-chip sync-${syncState}`} title={syncMessage}>
        {loadState === "loading" ? "Loading store" : syncMessage}
      </div>
      <button type="button" className="button secondary" onClick={onReset}>
        Reset store
      </button>
      <button type="button" className="button secondary" onClick={onLogout}>
        Sign out
      </button>
    </>
  );
}

export function ManageShell({
  activeNav,
  navCounts,
  nextItem,
  densityMode,
  themeMode,
  sessionMode,
  sessionUser,
  syncState,
  syncMessage,
  loadState,
  onNavigate,
  onOpenPacket,
  onCreate,
  onDensityModeChange,
  onThemeModeChange,
  onReset,
  onLogout,
  IconComponent,
  children,
  overlays,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const currentView = viewCopy[activeNav] || viewCopy.backlog;

  useEffect(() => {
    setSettingsOpen(false);
  }, [activeNav]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 981px)");
    const closeOnDesktop = (event) => {
      if (event.matches) setSettingsOpen(false);
    };
    desktopQuery.addEventListener("change", closeOnDesktop);
    return () => desktopQuery.removeEventListener("change", closeOnDesktop);
  }, []);

  function resetFromSettings() {
    setSettingsOpen(false);
    onReset();
  }

  function logoutFromSettings() {
    setSettingsOpen(false);
    onLogout();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand-name">Agent Backlog</div>
            <div className="brand-domain">localhost:5186</div>
          </div>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`nav-button ${activeNav === item.id ? "is-active" : ""}`}
              aria-label={item.label}
              aria-current={activeNav === item.id ? "page" : undefined}
              onClick={() => {
                setSettingsOpen(false);
                onNavigate(item.id);
              }}
            >
              <IconComponent name={item.icon} />
              <span className="nav-label">{item.label}</span>
              {navCounts[item.id] ? <span className="nav-count">{navCounts[item.id]}</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="footer-label">Next ready packet</div>
          <button
            type="button"
            className="next-packet"
            onClick={() => onOpenPacket(nextItem?.key)}
            disabled={!nextItem}
            aria-label={nextItem ? `Next ready packet ${nextItem.key}` : "No ready packet"}
          >
            <span className="next-packet-icon" aria-hidden="true">
              <IconComponent name="queue" />
            </span>
            <span>{nextItem?.key || "None"}</span>
            <small>{nextItem ? `${nextItem.repo} / ${nextItem.title}` : "No ready item"}</small>
          </button>
        </div>
      </aside>

      <main className={`workspace workspace-${activeNav}`}>
        <header className="topbar">
          <div>
            <span className="eyebrow">{currentView.eyebrow}</span>
            <h1>{currentView.title}</h1>
            <p>{currentView.description}</p>
          </div>
          <div className="topbar-actions">
            <button type="button" className="button primary" onClick={onCreate}>
              <IconComponent name="plus" />
              {activeNav === "initiatives" ? "New initiative" : "New packet"}
            </button>
            <button
              type="button"
              className="button secondary mobile-settings-trigger"
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen(true)}
            >
              <IconComponent name="more" />
              Settings
            </button>
            <div className="topbar-secondary-actions">
              <OperatorControls
                densityMode={densityMode}
                themeMode={themeMode}
                sessionMode={sessionMode}
                sessionUser={sessionUser}
                syncState={syncState}
                syncMessage={syncMessage}
                loadState={loadState}
                onDensityModeChange={onDensityModeChange}
                onThemeModeChange={onThemeModeChange}
                onReset={onReset}
                onLogout={onLogout}
              />
            </div>
          </div>
        </header>

        {children}
      </main>

      {settingsOpen ? (
        <ModalDialog
          className="operator-settings-sheet"
          backdropClassName="operator-settings-backdrop"
          labelledBy="operator-settings-title"
          initialFocusSelector="[data-settings-initial-focus]"
          onClose={() => setSettingsOpen(false)}
        >
          <div className="operator-settings-head">
            <div>
              <span className="eyebrow">Preferences</span>
              <h2 id="operator-settings-title">Operator settings</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close operator settings"
              onClick={() => setSettingsOpen(false)}
            >
              <IconComponent name="close" />
            </button>
          </div>
          <div className="operator-settings-controls">
            <OperatorControls
              densityMode={densityMode}
              themeMode={themeMode}
              sessionMode={sessionMode}
              sessionUser={sessionUser}
              syncState={syncState}
              syncMessage={syncMessage}
              loadState={loadState}
              onDensityModeChange={onDensityModeChange}
              onThemeModeChange={onThemeModeChange}
              onReset={resetFromSettings}
              onLogout={logoutFromSettings}
              initialFocus
            />
          </div>
        </ModalDialog>
      ) : null}

      {overlays}
    </div>
  );
}

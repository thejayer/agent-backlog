import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  appearanceLabels,
  appearanceOptions,
  themeLabels,
  themeOptions,
} from "../lib/shellPreferences.mjs";
import {
  buildCommandResults,
  commandShortcutLabel,
  groupedNavItems,
  navGroups,
  navItems,
} from "../lib/shellChrome.mjs";
import { ModalDialog } from "./ModalDialog.jsx";

export { appearanceLabels, appearanceOptions, navGroups, navItems, themeLabels, themeOptions };
export const densityOptions = [
  { id: "compact", label: "Compact" },
  { id: "regular", label: "Regular" },
  { id: "comfortable", label: "Comfortable" },
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

function PreferenceControls({
  densityMode,
  themeMode,
  appearanceMode,
  onDensityModeChange,
  onThemeModeChange,
  onAppearanceModeChange,
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
      <label className="shell-control shell-appearance-control">
        <span>Appearance</span>
        <select
          aria-label="Appearance"
          value={appearanceMode}
          onChange={(event) => onAppearanceModeChange(event.target.value)}
        >
          {appearanceOptions.map((option) => (
            <option key={option} value={option}>
              {appearanceLabels[option]}
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
    </>
  );
}

function SessionActions({
  sessionMode,
  sessionUser,
  syncState,
  syncMessage,
  loadState,
  onReset,
  onLogout,
}) {
  return (
    <>
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
  packets = [],
  densityMode,
  themeMode,
  appearanceMode,
  sessionMode,
  sessionUser,
  syncState,
  syncMessage,
  loadState,
  onNavigate,
  onOpenPacket,
  onCreate,
  onCreatePacket,
  onCreateInitiative,
  onDensityModeChange,
  onThemeModeChange,
  onAppearanceModeChange,
  onReset,
  onLogout,
  IconComponent,
  children,
  overlays,
}) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const shellMenuRef = useRef(null);
  const currentView = viewCopy[activeNav] || viewCopy.backlog;
  const groups = useMemo(() => groupedNavItems(navItems, navGroups), []);
  const shortcut = useMemo(
    () => commandShortcutLabel(typeof navigator === "undefined" ? "" : navigator.userAgent),
    [],
  );
  const commandResults = useMemo(
    () => buildCommandResults({ query: commandQuery, views: navItems, viewCopy, packets }),
    [commandQuery, packets],
  );

  function closeChromeOverlays() {
    setCommandOpen(false);
    setCommandQuery("");
    setShellMenuOpen(false);
  }

  useEffect(() => {
    closeChromeOverlays();
  }, [activeNav]);

  useEffect(() => {
    function onKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShellMenuOpen(false);
        setCommandQuery("");
        setCommandOpen((current) => !current);
        return;
      }

      if (event.key === "Escape") {
        setShellMenuOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!shellMenuOpen) return undefined;

    function onPointerDown(event) {
      if (!shellMenuRef.current?.contains(event.target)) {
        setShellMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [shellMenuOpen]);

  function navigate(navId) {
    closeChromeOverlays();
    onNavigate(navId);
  }

  function openPacket(key) {
    closeChromeOverlays();
    onOpenPacket(key);
  }

  function runCommand(result) {
    if (result.type === "packet") {
      openPacket(result.id);
      return;
    }

    if (result.type === "action") {
      closeChromeOverlays();
      if (result.id === "new-initiative") {
        (onCreateInitiative || onCreate)?.();
        return;
      }
      (onCreatePacket || onCreate)?.();
      return;
    }

    navigate(result.id);
  }

  function resetFromMenu() {
    onReset();
  }

  function logoutFromMenu() {
    setShellMenuOpen(false);
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
          {groups.map((group) => (
            <div
              className="nav-group"
              role="group"
              aria-label={group.label}
              data-nav-count={group.items.length}
              key={group.label}
            >
              <span className="nav-group-label">{group.label}</span>
              {group.items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`nav-button ${activeNav === item.id ? "is-active" : ""}`}
                  aria-label={item.label}
                  aria-current={activeNav === item.id ? "page" : undefined}
                  onClick={() => navigate(item.id)}
                >
                  <IconComponent name={item.icon} />
                  <span className="nav-label">{item.label}</span>
                  {navCounts[item.id] ? <span className="nav-count">{navCounts[item.id]}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="footer-label">Next ready packet</div>
          <button
            type="button"
            className="next-packet"
            onClick={() => openPacket(nextItem?.key)}
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
          <div className="view-heading">
            <span className="eyebrow">{currentView.eyebrow}</span>
            <h1>{currentView.title}</h1>
            <p>{currentView.description}</p>
          </div>
          <button
            type="button"
            className="command-trigger"
            aria-label="Find a packet or view"
            aria-haspopup="dialog"
            aria-expanded={commandOpen}
            onClick={() => {
              setShellMenuOpen(false);
              setCommandOpen(true);
            }}
          >
            <IconComponent name="search" />
            <span>Find a packet or view</span>
            <kbd>{shortcut}</kbd>
          </button>
          <div className="topbar-actions">
            <button type="button" className="button primary" onClick={onCreate}>
              <IconComponent name="plus" />
              {activeNav === "initiatives" ? "New initiative" : "New packet"}
            </button>
            <div className="shell-quick-controls">
              <PreferenceControls
                densityMode={densityMode}
                themeMode={themeMode}
                appearanceMode={appearanceMode}
                onDensityModeChange={onDensityModeChange}
                onThemeModeChange={onThemeModeChange}
                onAppearanceModeChange={onAppearanceModeChange}
              />
            </div>
            <div className="shell-menu-wrap" ref={shellMenuRef}>
              <button
                type="button"
                className="icon-button shell-menu-button"
                aria-label="Workspace settings"
                aria-haspopup="true"
                aria-expanded={shellMenuOpen}
                aria-controls="workspace-settings-panel"
                onClick={() => {
                  setCommandOpen(false);
                  setShellMenuOpen((current) => !current);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setShellMenuOpen(false);
                }}
              >
                <IconComponent name="more" />
              </button>
              {shellMenuOpen ? (
                <div
                  id="workspace-settings-panel"
                  className="topbar-secondary-actions shell-menu"
                  role="region"
                  aria-label="Workspace settings"
                >
                  <div className="shell-menu-preferences">
                    <PreferenceControls
                      densityMode={densityMode}
                      themeMode={themeMode}
                      appearanceMode={appearanceMode}
                      onDensityModeChange={onDensityModeChange}
                      onThemeModeChange={onThemeModeChange}
                      onAppearanceModeChange={onAppearanceModeChange}
                      initialFocus
                    />
                  </div>
                  <SessionActions
                    sessionMode={sessionMode}
                    sessionUser={sessionUser}
                    syncState={syncState}
                    syncMessage={syncMessage}
                    loadState={loadState}
                    onReset={resetFromMenu}
                    onLogout={logoutFromMenu}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {children}
      </main>

      {commandOpen ? (
        <ModalDialog
          className="command-palette"
          backdropClassName="command-backdrop"
          labelledBy="command-palette-title"
          initialFocusSelector="[data-command-input]"
          onClose={() => {
            setCommandOpen(false);
            setCommandQuery("");
          }}
        >
          <h2 id="command-palette-title" className="sr-only">
            Command palette
          </h2>
          <label className="command-input">
            <IconComponent name="search" />
            <input
              data-command-input="true"
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && commandResults[0]) {
                  event.preventDefault();
                  runCommand(commandResults[0]);
                }
              }}
              placeholder="Search views, packet keys, titles, or repos…"
              aria-label="Search commands"
            />
            <kbd>Esc</kbd>
          </label>
          <div className="command-results">
            {commandResults.length > 0 ? (
              commandResults.map((result) => (
                <button
                  type="button"
                  key={`${result.type}-${result.id}`}
                  aria-label={result.type === "packet" ? `${result.id} packet` : `${result.title} ${result.type}`}
                  onClick={() => runCommand(result)}
                >
                  <span className={`command-result-icon command-result-${result.type}`}>
                    <IconComponent name={result.icon} />
                  </span>
                  <span>
                    <strong>{result.title}</strong>
                    <small>{result.meta}</small>
                  </span>
                  <em>{result.type === "packet" ? "Packet" : result.type === "action" ? "Action" : "View"}</em>
                </button>
              ))
            ) : (
              <div className="overview-empty">No matching packets or views.</div>
            )}
          </div>
        </ModalDialog>
      ) : null}

      {overlays}
    </div>
  );
}

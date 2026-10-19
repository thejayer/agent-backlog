import React, { useState } from "react";
import { Icon } from "./Icon.jsx";
import { ModalDialog } from "./ModalDialog.jsx";

export function SavedViewControls({
  savedViews,
  activeId,
  updateTargetId,
  state,
  message,
  onApply,
  onCreate,
  onUpdate,
  onRename,
  onDelete,
  onRetry,
}) {
  const [editorMode, setEditorMode] = useState("");
  const [name, setName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const active = savedViews.find((view) => view.id === activeId);
  const updateTarget = savedViews.find((view) => view.id === updateTargetId);
  const busy = ["loading", "saving"].includes(state);

  function openEditor(mode) {
    setName(mode === "rename" ? active?.name || "" : "");
    setEditorMode(mode);
  }

  async function submitEditor(event) {
    event.preventDefault();
    if (editorMode === "rename" && !active) return;
    const completed = editorMode === "rename"
      ? await onRename(active.id, name)
      : await onCreate(name);
    if (completed) setEditorMode("");
  }

  async function confirmDelete() {
    if (await onDelete(deleteTarget.id)) setDeleteTarget(null);
  }

  return (
    <div className="saved-view-controls" role="group" aria-label="Saved views">
      <div className="saved-view-row">
        <label>
          <span>Saved view</span>
          <select
            aria-label="Saved view"
            value={activeId}
            onChange={(event) => onApply(event.target.value)}
            disabled={busy || savedViews.length === 0}
          >
            <option value="">{savedViews.length > 0 ? "Choose a view" : "No saved views"}</option>
            {savedViews.map((view) => (
              <option key={view.id} value={view.id}>{view.name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="button secondary" onClick={() => openEditor("create")} disabled={busy}>
          Save view
        </button>
        <button type="button" className="button secondary" onClick={() => onUpdate(updateTarget.id)} disabled={busy || !updateTarget}>
          Update
        </button>
        <button type="button" className="button secondary" onClick={() => openEditor("rename")} disabled={busy || !active}>
          Rename
        </button>
        <button type="button" className="button danger" onClick={() => setDeleteTarget(active)} disabled={busy || !active}>
          Delete
        </button>
      </div>
      <div className={`saved-view-status is-${state}`} role="status">
        {message}
        {state === "failed" ? (
          <button type="button" className="button secondary" onClick={onRetry}>Retry</button>
        ) : null}
      </div>

      {editorMode ? (
        <ModalDialog
          as="form"
          className="saved-view-dialog"
          labelledBy="saved-view-editor-title"
          initialFocusSelector="[data-saved-view-name]"
          onClose={() => setEditorMode("")}
          preventDismiss={busy}
          onSubmit={submitEditor}
        >
            <div className="composer-header">
              <div>
                <span className="eyebrow">Backlog filters</span>
                <h2 id="saved-view-editor-title">{editorMode === "rename" ? "Rename saved view" : "Save current view"}</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close saved view editor" onClick={() => setEditorMode("")} disabled={busy}>
                <Icon name="close" />
              </button>
            </div>
            <label className="field">
              <span>Name</span>
              <input
                data-saved-view-name
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                required
              />
            </label>
            <div className="composer-actions">
              <button type="button" className="button secondary" onClick={() => setEditorMode("")} disabled={busy}>Cancel</button>
              <button type="submit" className="button primary" disabled={busy || !name.trim()}>{busy ? "Saving" : "Save"}</button>
            </div>
        </ModalDialog>
      ) : null}

      {deleteTarget ? (
        <ModalDialog
          className="saved-view-dialog"
          labelledBy="saved-view-delete-title"
          onClose={() => setDeleteTarget(null)}
          preventDismiss={busy}
        >
            <div className="composer-header">
              <div>
                <span className="eyebrow">Confirmation</span>
                <h2 id="saved-view-delete-title">Delete saved view?</h2>
              </div>
            </div>
            <p>This removes “{deleteTarget.name}” from your saved views. Packet data is not changed.</p>
            <div className="composer-actions">
              <button type="button" className="button secondary" onClick={() => setDeleteTarget(null)} disabled={busy}>Cancel</button>
              <button type="button" className="button danger" onClick={confirmDelete} disabled={busy}>
                {busy ? "Deleting" : "Delete view"}
              </button>
            </div>
        </ModalDialog>
      ) : null}
    </div>
  );
}

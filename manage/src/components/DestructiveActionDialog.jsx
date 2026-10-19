import React, { useState } from "react";
import { Icon } from "./Icon.jsx";
import { ModalDialog } from "./ModalDialog.jsx";

export function DestructiveActionDialog({ action, onClose, onConfirm }) {
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const matches = confirmation === action.confirmation;

  async function submit(event) {
    event.preventDefault();
    if (!matches) return;
    setSubmitting(true);
    setError("");
    const completed = await onConfirm(confirmation);
    if (!completed) {
      setError("The store could not be reset. Review the sync status and try again.");
      setSubmitting(false);
    }
  }

  return (
    <ModalDialog
      as="form"
      className="composer destructive-dialog"
      labelledBy={`${action.id}-title`}
      describedBy={`${action.id}-description`}
      initialFocusSelector="[aria-label='Typed confirmation']"
      onClose={onClose}
      preventDismiss={submitting}
      onSubmit={submit}
    >
      <div className="composer-header">
        <div>
          <span className="eyebrow">Destructive action</span>
          <h2 id={`${action.id}-title`}>{action.title}</h2>
          <p id={`${action.id}-description`}>{action.description}</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Cancel destructive action" disabled={submitting}>
          <Icon name="close" />
        </button>
      </div>
      <label className="destructive-confirmation">
        <span>Type <strong>{action.confirmation}</strong> to confirm</span>
        <input
          aria-label="Typed confirmation"
          aria-describedby={`${action.id}-confirmation-help${error ? ` ${action.id}-error` : ""}`}
          aria-invalid={Boolean(error)}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
        />
      </label>
      <span className="sr-only" id={`${action.id}-confirmation-help`}>Enter the exact confirmation phrase to enable this action.</span>
      {error ? <div className="auth-error" id={`${action.id}-error`} role="alert">{error}</div> : null}
      <div className="composer-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={submitting}>Cancel</button>
        <button type="submit" className="button danger" disabled={!matches || submitting}>
          {submitting ? "Working" : action.actionLabel}
        </button>
      </div>
    </ModalDialog>
  );
}

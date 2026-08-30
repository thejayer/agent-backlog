import React, { useEffect, useRef } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(dialog) {
  return [...dialog.querySelectorAll(focusableSelector)].filter(
    (element) => !element.closest("[hidden]") && element.getAttribute("aria-hidden") !== "true",
  );
}

export function ModalDialog({
  as: DialogElement = "div",
  children,
  backdropClassName,
  className,
  labelledBy,
  describedBy,
  initialFocusSelector,
  onClose,
  closeOnBackdrop = true,
  preventDismiss = false,
  ...dialogProps
}) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const preventDismissRef = useRef(preventDismiss);
  const previouslyFocusedRef = useRef(null);

  onCloseRef.current = onClose;
  preventDismissRef.current = preventDismiss;

  useEffect(() => {
    const dialog = dialogRef.current;
    previouslyFocusedRef.current = document.activeElement;

    function focusInitialElement() {
      const requested = initialFocusSelector ? dialog.querySelector(initialFocusSelector) : null;
      const initial = requested || dialog.querySelector("[autofocus]") || focusableElements(dialog)[0] || dialog;
      initial.focus();
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!preventDismissRef.current) onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = focusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function containFocus(event) {
      if (!dialog.contains(event.target)) focusInitialElement();
    }

    dialog.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", containFocus);
    focusInitialElement();

    return () => {
      dialog.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", containFocus);
      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, [initialFocusSelector]);

  function dismissFromBackdrop(event) {
    if (!preventDismissRef.current && closeOnBackdrop && event.target === event.currentTarget) onCloseRef.current();
  }

  return (
    <div className={`modal-backdrop ${backdropClassName || ""}`.trim()} role="presentation" onClick={dismissFromBackdrop}>
      <DialogElement
        {...dialogProps}
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {children}
      </DialogElement>
    </div>
  );
}

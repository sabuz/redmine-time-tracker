import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { errMsg } from "../api";

interface Props {
  title: string;
  /** What exactly is about to happen, in a sentence or two. */
  children: ComponentChildren;
  confirmLabel: string;
  /** Runs when the user confirms. If it throws, the message is shown here and the dialog stays open. */
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/** The app's own confirmation (the browser's confirm() is not used): a dialog in the same style as Settings. */
export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel }: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The safe choice starts focused, so a stray Enter never confirms.
  useEffect(() => cancel.current?.focus(), []);

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <div class="scrim" onClick={() => !busy && onCancel()}>
      <div
        class="dialog confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !busy && onCancel()}
      >
        <h2>{title}</h2>
        <div class="confirm-body">{children}</div>
        {error && (
          <div class="error" role="alert">
            {error}
          </div>
        )}
        <div class="confirm-actions">
          <button ref={cancel} class="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button class="danger" onClick={confirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

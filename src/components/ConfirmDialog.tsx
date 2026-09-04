import { buttonClass, type ButtonVariant } from "../lib/buttonClass";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  confirmDisabled,
  showCancel = true,
  confirmVariant = "primary",
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
  showCancel?: boolean;
  confirmVariant?: ButtonVariant;
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        <p>{body}</p>
        <div className="modal-actions">
          {showCancel ? (
            <button type="button" className={buttonClass("ghost")} disabled={confirmDisabled} onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            className={buttonClass(confirmVariant)}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

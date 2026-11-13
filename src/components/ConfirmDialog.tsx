import { useEffect, useRef } from "react";
import { useT } from "../i18n.ts";

export interface Confirmation {
  title: string;
  message: string;
  action: string;
  detail?: string;
  cancelLabel?: string;
  allowDismiss?: boolean;
}

export default function ConfirmDialog({
  prompt,
  onChoose,
}: {
  prompt: Confirmation;
  onChoose: (confirmed: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    t = useT();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="close-tab-dialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onKeyDown={(event) => {
        if (event.key === "Escape" && prompt.allowDismiss === false) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (prompt.allowDismiss !== false) onChoose(false);
      }}
    >
      <h2 id="confirm-title">{t(prompt.title)}</h2>
      <p id="confirm-message">{t(prompt.message)}</p>
      {prompt.detail && <p className="confirm-detail">{prompt.detail}</p>}
      <div className="close-tab-actions">
        <button type="button" autoFocus onClick={() => onChoose(false)}>
          {t(prompt.cancelLabel || "Cancel")}
        </button>
        <button
          type="button"
          className="confirm-action"
          onClick={() => onChoose(true)}
        >
          {t(prompt.action)}
        </button>
      </div>
    </dialog>
  );
}

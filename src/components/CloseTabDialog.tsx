import { useEffect, useRef } from "react";
import { useT } from "../i18n.ts";

export default function CloseTabDialog({
  title,
  onCancel,
  onConfirm,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const t = useT();
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="close-tab-dialog"
      aria-labelledby="close-tab-title"
      aria-describedby="close-tab-description"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="close-tab-title">{t("Close tab?")}</h2>
      <p className="close-tab-name">{title || t("Untitled")}</p>
      <p id="close-tab-description">
        {t(
          "This tab will be removed from the workspace. Save a copy of the workspace first if you want to keep it.",
        )}
      </p>
      <div className="close-tab-actions">
        <button type="button" autoFocus onClick={onCancel}>
          {t("Cancel")}
        </button>
        <button type="button" className="confirm-action" onClick={onConfirm}>
          {t("Close tab")}
        </button>
      </div>
    </dialog>
  );
}

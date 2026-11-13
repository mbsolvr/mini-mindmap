import { useT } from "../i18n.ts";

interface Props {
  status: string;
  path: string;
  dirty: boolean;
  paused: boolean;
  autoSave: boolean;
  busy: boolean;
  zoom: number;
  onToggleAutoSave: () => void;
  onFit: () => void;
  onZoom: (step: number) => void;
}
export default function StatusBar({
  status,
  path,
  dirty,
  paused,
  autoSave,
  busy,
  zoom,
  onToggleAutoSave,
  onFit,
  onZoom,
}: Props) {
  const t = useT();
  return (
    <footer className="bottom-bar">
      <div
        className={
          "save-status" + (dirty || paused ? " unsaved" : path ? " saved" : "")
        }
        title={path ? `${t(status)} · ${path}` : t(status)}
      >
        <button
          type="button"
          className={"autosave-switch" + (autoSave ? " on" : "")}
          role="switch"
          aria-label={t("Auto-save")}
          aria-checked={autoSave}
          disabled={busy}
          onClick={onToggleAutoSave}
        >
          <span />
        </button>
        <span className="status-text" role="status">
          {t(status)}
        </span>
      </div>
      <div className="zoom-controls" aria-label={t("Canvas zoom")}>
        <button
          type="button"
          aria-label={t("Fit Canvas")}
          title={t("Fit canvas (F)")}
          onClick={onFit}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={t("Zoom Out")}
          disabled={zoom <= 0.2}
          onClick={() => onZoom(-0.1)}
        >
          −
        </button>
        <output aria-label={t("Current zoom")}>
          {Math.round(zoom * 100)}%
        </output>
        <button
          type="button"
          aria-label={t("Zoom In")}
          disabled={zoom >= 2}
          onClick={() => onZoom(0.1)}
        >
          ＋
        </button>
      </div>
    </footer>
  );
}

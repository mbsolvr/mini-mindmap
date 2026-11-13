import { useEffect, useRef } from "react";
import { useT, languageOptions, type LanguagePreference } from "../i18n.ts";
import { templates } from "../templates.ts";
import { SettingsIcon } from "./AppMenu.tsx";

export type DisplaySettings = {
  systemFontSize: number;
  contentFontSize: number;
  tabHeight: number;
  statusHeight: number;
};
export const defaultDisplaySettings: DisplaySettings = {
  systemFontSize: 14,
  contentFontSize: 14,
  tabHeight: 22,
  statusHeight: 20,
};
export const displayRanges = {
  systemFontSize: [10, 18],
  contentFontSize: [10, 24],
  tabHeight: [22, 48],
  statusHeight: [20, 40],
} as const;

export function readDisplaySettings(): DisplaySettings {
  try {
    const data: unknown = JSON.parse(
      localStorage.getItem("mini-mindmap-display") || "null",
    );
    if (!data || typeof data !== "object") return defaultDisplaySettings;
    return Object.fromEntries(
      Object.entries(defaultDisplaySettings).map(([key, fallback]) => {
        const saved = data as Record<string, unknown>,
          value = saved[key],
          [min, max] = displayRanges[key as keyof DisplaySettings];
        return [
          key,
          typeof value === "number" &&
          Number.isInteger(value) &&
          value >= min &&
          value <= max
            ? value
            : fallback,
        ];
      }),
    ) as DisplaySettings;
  } catch {
    return defaultDisplaySettings;
  }
}

interface Props {
  language: LanguagePreference;
  theme: string;
  display: DisplaySettings;
  onLanguage: (language: LanguagePreference) => void;
  onTheme: (theme: string) => void;
  onDisplay: (display: DisplaySettings) => void;
  onClose: () => void;
}
function SettingsChoice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null),
    t = useT();
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return (
    <div className="settings-row">
      <span>{t(label)}</span>
      <details
        ref={ref}
        className="settings-choice"
        onKeyDown={(event) => {
          if (event.key === "Escape" && ref.current?.open) {
            event.preventDefault();
            event.stopPropagation();
            ref.current.open = false;
            ref.current.querySelector("summary")?.focus();
          }
        }}
      >
        <summary aria-label={t(label)}>
          {t(options.find(([key]) => key === value)?.[1] || value)}
          <span aria-hidden="true">⌄</span>
        </summary>
        <div className="settings-options">
          {options.map(([key, title]) => (
            <button
              type="button"
              key={key}
              aria-pressed={key === value}
              onClick={() => {
                onChange(key);
                if (ref.current) {
                  ref.current.open = false;
                  ref.current.querySelector("summary")?.focus();
                }
              }}
            >
              {t(title)}
              {key === value && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
export default function SettingsDialog({
  language,
  theme,
  display,
  onLanguage,
  onTheme,
  onDisplay,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null),
    t = useT();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector("h2")?.focus();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="settings-header">
        <h2 id="settings-title" tabIndex={-1}>
          <SettingsIcon />
          {t("Settings")}
        </h2>
        <button type="button" aria-label={t("Close")} onClick={onClose}>
          ×
        </button>
      </div>
      <SettingsChoice
        label="Language"
        value={language}
        options={languageOptions}
        onChange={(value) => onLanguage(value as LanguagePreference)}
      />
      <SettingsChoice
        label="Theme"
        value={theme}
        options={templates.map(([key, label]) => [key, label] as const)}
        onChange={onTheme}
      />
      {(
        [
          ["systemFontSize", "System font size"],
          ["contentFontSize", "Content font size"],
          ["tabHeight", "Tab height"],
          ["statusHeight", "Status bar height"],
        ] as const
      ).map(([key, label]) => (
        <label className="settings-row" key={key}>
          <span>{t(label)}</span>
          <span className="settings-range">
            <input
              data-setting={key}
              type="range"
              min={displayRanges[key][0]}
              max={displayRanges[key][1]}
              step="1"
              value={display[key]}
              onChange={(event) =>
                onDisplay({ ...display, [key]: Number(event.target.value) })
              }
            />
            <output>{display[key]} px</output>
          </span>
        </label>
      ))}
      <div className="settings-actions">
        <button type="button" onClick={() => onDisplay(defaultDisplaySettings)}>
          {t("Reset")}
        </button>
        <button type="button" onClick={onClose}>
          {t("Done")}
        </button>
      </div>
    </dialog>
  );
}

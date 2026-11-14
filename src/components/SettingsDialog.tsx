import { useEffect, useRef, useState } from "react";
import { useT, languageOptions, type LanguagePreference } from "../i18n.ts";
import { templates } from "../templates.ts";
import { SettingsIcon } from "./AppMenu.tsx";
import appInfo from "../../src-tauri/tauri.conf.json" with { type: "json" };

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
  autoSave: boolean;
  onAutoSave: () => void;
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
  autoSave,
  onAutoSave,
  onLanguage,
  onTheme,
  onDisplay,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null),
    t = useT();
  const [section, setSection] = useState("General");
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
      <div className="settings-body">
        <nav className="settings-nav" aria-label={t("Settings categories")}>
          {["General", "Appearance", "About"].map(label => (
            <button
              type="button"
              key={label}
              data-section={label}
              aria-current={section === label ? "page" : undefined}
              onClick={() => setSection(label)}
            >
              {t(label)}
            </button>
          ))}
        </nav>
        <section className="settings-content" aria-labelledby="settings-section-title">
          <h3 id="settings-section-title">{t(section)}</h3>
          {section === "General" && (
            <>
              <SettingsChoice
                label="Language"
                value={language}
                options={languageOptions}
                onChange={(value) => onLanguage(value as LanguagePreference)}
              />
              <div className="settings-row">
                <span>{t("Auto-save workspace")}</span>
                <button
                  type="button"
                  className={"autosave-switch" + (autoSave ? " on" : "")}
                  role="switch"
                  aria-label={t("Auto-save workspace")}
                  aria-checked={autoSave}
                  onClick={onAutoSave}
                ><span /></button>
              </div>
              <p className="settings-hint">{t("Choose a save location first to enable automatic saving.")}</p>
            </>
          )}
          {section === "Appearance" && (
            <>
              <SettingsChoice
                label="Theme"
                value={theme}
                options={templates.map(([key, label]) => [key, label] as const)}
                onChange={onTheme}
              />
              {(
                [
                  ["Fonts", [["systemFontSize", "System font size"], ["contentFontSize", "Content font size"]]],
                  ["Layout", [["tabHeight", "Tab height"], ["statusHeight", "Status bar height"]]],
                ] as const
              ).map(([heading, settings]) => (
                <div className="settings-group" key={heading}>
                  <h4>{t(heading)}</h4>
                  {settings.map(([key, label]) => (
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
                </div>
              ))}
            </>
          )}
          {section === "About" && (
            <div className="settings-about">
              <h4>{appInfo.productName}</h4>
              <p>{t("Version")} {appInfo.version}</p>
            </div>
          )}
        </section>
      </div>
      <div className="settings-actions">
        {section === "Appearance" && (
          <button className="settings-reset" type="button" onClick={() => onDisplay(defaultDisplaySettings)}>
            {t("Reset sizes")}
          </button>
        )}
        <button type="button" onClick={onClose}>
          {t("Done")}
        </button>
      </div>
    </dialog>
  );
}

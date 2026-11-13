import { useEffect, useState } from "react";
import { readDisplaySettings } from "../components/SettingsDialog.tsx";
import {
  translate,
  systemLanguage,
  readLanguagePreference,
  languageTags,
  type LanguagePreference,
} from "../i18n.ts";

export function usePreferences() {
  const [languagePreference, setLanguagePreference] =
    useState<LanguagePreference>(() => {
      try {
        const value = localStorage.getItem("mini-mindmap-language");
        return readLanguagePreference(value);
      } catch {
        return "system";
      }
    });
  const [systemLocale, setSystemLocale] = useState(
    () => navigator.language || "en",
  );
  const language =
    languagePreference === "system"
      ? systemLanguage(systemLocale)
      : languagePreference;
  const [display, setDisplay] = useState(readDisplaySettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const t = (text: string) => translate(language, text);
  useEffect(() => {
    try {
      localStorage.setItem("mini-mindmap-language", languagePreference);
    } catch {
      /* preference is optional */
    }
  }, [languagePreference]);
  useEffect(() => {
    document.documentElement.lang = languageTags[language];
  }, [language]);
  useEffect(() => {
    const update = () => setSystemLocale(navigator.language || "en");
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("mini-mindmap-display", JSON.stringify(display));
    } catch {
      /* preference is optional */
    }
  }, [display]);
  return {
    languagePreference,
    setLanguagePreference,
    language,
    display,
    setDisplay,
    settingsOpen,
    setSettingsOpen,
    t,
  };
}

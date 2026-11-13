import { createContext, useContext } from "react";
import zh from "./locales/zh.ts";
import ja from "./locales/ja.ts";
import ko from "./locales/ko.ts";

export type Language = "en" | "zh" | "ja" | "ko";
export const languageOptions = [
  ["system", "System default"],
  ["en", "English"],
  ["zh", "简体中文"],
  ["ja", "日本語"],
  ["ko", "한국어"],
] as const;
export const languageTags: Record<Language, string> = {
  en: "en",
  zh: "zh-CN",
  ja: "ja",
  ko: "ko",
};
const dictionaries: Record<Exclude<Language, "en">, Record<string, string>> = {
  zh,
  ja,
  ko,
};
export type LanguagePreference = Language | "system";
export function systemLanguage(locale: string): Language {
  const base = locale.split(/[-_]/)[0].toLowerCase();
  return base === "zh" || base === "ja" || base === "ko" ? base : "en";
}
export function readLanguagePreference(
  value: string | null,
): LanguagePreference {
  return languageOptions.some(([key]) => key === value)
    ? (value as LanguagePreference)
    : "system";
}
const LanguageContext = createContext<Language>("en");
export const LanguageProvider = LanguageContext.Provider;

export function translate(language: Language, text: string): string {
  if (language === "en") return text;
  const messages = dictionaries[language];
  if (Object.hasOwn(messages, text)) return messages[text];
  for (const [prefix, translated] of Object.entries(messages)) {
    if (
      (prefix.endsWith(": ") || prefix === "File extension must be .") &&
      text.startsWith(prefix)
    )
      return translated + translate(language, text.slice(prefix.length));
  }
  const imageExport = /^(SVG|PNG) image exported$/.exec(text);
  if (imageExport) return imageExport[1] + messages[" image exported"];
  return text;
}

export function useT() {
  const language = useContext(LanguageContext);
  return (text: string) => translate(language, text);
}

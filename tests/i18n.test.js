import { test } from "node:test";
import assert from "node:assert/strict";
import {
  translate,
  systemLanguage,
  readLanguagePreference,
  languageOptions,
  languageTags,
} from "../src/i18n.ts";
import zh from "../src/locales/zh.ts";
import ja from "../src/locales/ja.ts";
import ko from "../src/locales/ko.ts";

test("English messages are the source and Chinese is selectable", () => {
  assert.equal(translate("en", "File"), "File");
  assert.equal(translate("zh", "File"), "文件");
  assert.equal(translate("zh", "SVG image exported"), "SVG 图片已导出");
  assert.equal(translate("zh", "As a left-side child topic"), "作为左侧子节点");
  assert.equal(
    translate("zh", "Invalid map file format or version"),
    "导图文件格式或版本不正确",
  );
  assert.equal(
    translate("zh", "Error: Invalid map file format or version"),
    "错误：导图文件格式或版本不正确",
  );
  assert.equal(
    translate("zh", "File extension must be .png"),
    "文件扩展名必须为 .png",
  );
  assert.equal(translate("en", "User topic text"), "User topic text");
});

test("system language uses Chinese for Chinese locales and English for other locales", () => {
  assert.equal(systemLanguage("zh-CN"), "zh");
  assert.equal(systemLanguage("zh_TW"), "zh");
  assert.equal(systemLanguage("fr-FR"), "en");
});

test("Japanese and Korean system locales include regional and legacy underscore forms", () => {
  for (const locale of ["ja", "ja-JP", "JA_jp"])
    assert.equal(systemLanguage(locale), "ja");
  for (const locale of ["ko", "ko-KR", "ko_KP", "KO-kr"])
    assert.equal(systemLanguage(locale), "ko");
  for (const locale of ["", "fr-FR", "japanese", "korean"])
    assert.equal(systemLanguage(locale), "en");
});

test("language preferences accept only supported choices and preserve native option names", () => {
  assert.deepEqual(
    languageOptions.map(([key]) => key),
    ["system", "en", "zh", "ja", "ko"],
  );
  assert.equal(languageOptions.find(([key]) => key === "ja")[1], "日本語");
  assert.equal(languageOptions.find(([key]) => key === "ko")[1], "한국어");
  for (const [key] of languageOptions)
    assert.equal(readLanguagePreference(key), key);
  for (const value of [null, "", "fr", "constructor", "JA", "ko-KR"])
    assert.equal(readLanguagePreference(value), "system");
  assert.deepEqual(languageTags, { en: "en", zh: "zh-CN", ja: "ja", ko: "ko" });
});

for (const [language, messages] of Object.entries({ zh, ja, ko })) {
  test(`${language} translates every catalog entry and composes dynamic errors and exports`, () => {
    assert.deepEqual(
      Object.keys(messages).sort(),
      Object.keys(zh).sort(),
      "incomplete translation catalog",
    );
    for (const [key, value] of Object.entries(messages)) {
      assert.ok(
        typeof value === "string" && value.trim(),
        `empty translation: ${key}`,
      );
      assert.equal(translate(language, key), value, key);
      assert.equal(translate("en", key), key);
    }
    assert.equal(
      translate(language, "Image export failed: Error: Canvas is empty"),
      messages["Image export failed: "] +
        messages["Error: "] +
        messages["Canvas is empty"],
    );
    assert.equal(
      translate(language, "File extension must be .png"),
      messages["File extension must be ."] + "png",
    );
    assert.equal(
      translate(language, "Could not receive opened files: File queue is unavailable"),
      messages["Could not receive opened files: "] + messages["File queue is unavailable"],
    );
    for (const format of ["SVG", "PNG"])
      assert.equal(
        translate(language, `${format} image exported`),
        format + messages[" image exported"],
      );
    for (const raw of [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
      "User topic 日本語 한국어 🌱",
    ])
      assert.equal(translate(language, raw), raw);
  });
}

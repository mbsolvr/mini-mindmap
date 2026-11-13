import { test } from "node:test";
import assert from "node:assert/strict";
import { hookRuntime, loadHook } from "./helpers/hooks.mjs";

async function setup(t, preference, locale, blocked = false) {
  const runtime = hookRuntime();
  const descriptors = Object.fromEntries(
    ["window", "localStorage", "navigator", "document"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const stored = new Map(
    preference == null ? [] : [["mini-mindmap-language", preference]],
  );
  const localStorage = {
    getItem: (key) => {
      if (blocked) throw new Error("Storage blocked");
      return stored.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (blocked) throw new Error("Storage blocked");
      stored.set(key, value);
    },
  };
  const win = new EventTarget(),
    navigator = { language: locale },
    document = { documentElement: {} };
  for (const [key, value] of Object.entries({
    window: win,
    localStorage,
    navigator,
    document,
  }))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  const load = (hooks) =>
    loadHook(
      new URL("../src/hooks/usePreferences.ts", import.meta.url),
      hooks,
      {
        'import { readDisplaySettings } from "../components/SettingsDialog.tsx";':
          "const readDisplaySettings = () => ({});",
      },
    );
  const { usePreferences } = await load(runtime.hooks);
  const render = () => runtime.render(usePreferences);
  t.after(() => {
    runtime.unmount();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { runtime, render, load, win, navigator, document, stored };
}

for (const [locale, expected] of [
  ["ja-JP", "ja"],
  ["ko-KR", "ko"],
  ["ko-KP", "ko"],
  ["zh-TW", "zh"],
  ["fr-FR", "en"],
]) {
  test(`without a preference, ${locale} selects ${expected}`, async (t) => {
    const h = await setup(t, null, locale),
      result = h.render();
    assert.equal(result.languagePreference, "system");
    assert.equal(result.language, expected);
    assert.equal(
      h.document.documentElement.lang,
      expected === "zh" ? "zh-CN" : expected,
    );
  });
}

for (const language of ["ja", "ko"]) {
  test(`${language} overrides system changes and survives loading preferences again`, async (t) => {
    const h = await setup(t, language, "en-US");
    let result = h.render();
    h.navigator.language = "zh-CN";
    h.win.dispatchEvent(new Event("languagechange"));
    result = h.render();
    assert.equal(result.language, language);
    assert.equal(h.stored.get("mini-mindmap-language"), language);
    assert.equal(h.document.documentElement.lang, language);
    h.runtime.unmount();
    const restarted = hookRuntime(),
      { usePreferences } = await h.load(restarted.hooks);
    const restored = restarted.render(usePreferences);
    assert.equal(restored.languagePreference, language);
    assert.equal(restored.language, language);
    restarted.unmount();
  });
}

test("system mode responds to locale changes and can be restored after a manual choice", async (t) => {
  const h = await setup(t, "system", "ja-JP");
  let result = h.render();
  assert.equal(result.language, "ja");
  result.setLanguagePreference("en");
  result = h.render();
  h.navigator.language = "ko-KR";
  h.win.dispatchEvent(new Event("languagechange"));
  result = h.render();
  assert.equal(result.language, "en");
  result.setLanguagePreference("system");
  result = h.render();
  assert.equal(result.language, "ko");
  assert.equal(h.document.documentElement.lang, "ko");
});

test("invalid or inaccessible saved preferences safely follow the system", async (t) => {
  for (const blocked of [false, true]) {
    await t.test(
      blocked ? "blocked storage" : "invalid preference",
      async (inner) => {
        const h = await setup(inner, "constructor", "ja-JP", blocked);
        const result = h.render();
        assert.equal(result.languagePreference, "system");
        assert.equal(result.language, "ja");
      },
    );
  }
});

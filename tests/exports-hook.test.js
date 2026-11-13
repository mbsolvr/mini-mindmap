import { test } from "node:test";
import assert from "node:assert/strict";
import { hookRuntime, loadHook } from "./helpers/hooks.mjs";

test("PDF export reports a failed image decode instead of printing incomplete content", async () => {
  const runtime = hookRuntime();
  const { useExports } = await loadHook(new URL("../src/hooks/useExports.ts", import.meta.url), runtime.hooks, {
    'import { flushSync } from "react-dom";': 'const flushSync = (fn) => fn();',
  });
  const previous = { window: globalThis.window, document: globalThis.document };
  const errors = [];
  let printed = false;
  globalThis.window = { addEventListener() {}, removeEventListener() {}, print() { printed = true; } };
  globalThis.document = { querySelectorAll: () => [{ decode: () => Promise.reject(new Error("Broken image")) }] };
  try {
    const hook = runtime.render(() => useExports({ workspaceRef: { current: { active: 0, tabs: [{ tree: {} }] } }, busyRef: { current: false }, composingRef: { current: false }, working() {}, setEpoch() {}, setError: error => errors.push(error), setStatus() {} }));
    await hook.exportPdf();
    assert.equal(printed, false);
    assert.match(errors.at(-1), /PDF export failed:.*Broken image/);
  } finally { runtime.unmount(); Object.assign(globalThis, previous); }
});

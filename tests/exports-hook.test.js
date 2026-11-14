import { test } from "node:test";
import assert from "node:assert/strict";
import { hookRuntime, loadHook, deferred } from "./helpers/hooks.mjs";

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

for (const failure of [false, true]) {
  test(`PDF export awaits the native print command ${failure ? 'and reports rejection' : 'before setting its hint'}`, async () => {
    const runtime = hookRuntime(), printing = deferred(), started = deferred();
    const { useExports } = await loadHook(new URL('../src/hooks/useExports.ts', import.meta.url), runtime.hooks, {
      'import { flushSync } from "react-dom";': 'const flushSync = fn => fn();',
    });
    const previous = { window: globalThis.window, document: globalThis.document };
    const errors = [], statuses = [], busyRef = { current: false };
    globalThis.window = { addEventListener() {}, removeEventListener() {}, print() { started.resolve(); return printing.promise; } };
    globalThis.document = { querySelectorAll: () => [], fonts: { ready: Promise.resolve() } };
    try {
      const hook = runtime.render(() => useExports({ workspaceRef: { current: { active: 0, tabs: [{ tree: {} }] } }, busyRef,
        composingRef: { current: false }, working: value => { busyRef.current = value; }, setEpoch() {},
        setError: value => { if (value) errors.push(value); }, setStatus: value => statuses.push(value) }));
      const pending = hook.exportPdf();
      await started.promise;
      assert.equal(busyRef.current, true);
      assert.deepEqual(statuses, []);
      if (failure) printing.reject(new Error('Printing unavailable'));
      else printing.resolve();
      await pending;
      assert.equal(busyRef.current, false);
      if (failure) {
        assert.match(errors[0], /PDF export failed:.*Printing unavailable/);
        assert.deepEqual(statuses, []);
      } else {
        assert.deepEqual(errors, []);
        assert.deepEqual(statuses, ['Choose Save to File in the print dialog to export a PDF']);
      }
    } finally { runtime.unmount(); Object.assign(globalThis, previous); }
  });
}

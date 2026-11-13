import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_SAVE_KEY, readAutoSave, shouldAutoSave } from "../src/autosave.ts";

test("automatic saving defaults on and remembers when it is disabled", () => {
  assert.equal(readAutoSave({ getItem: key => { assert.equal(key, AUTO_SAVE_KEY); return null; } }), true);
  assert.equal(readAutoSave({ getItem: () => "false" }), false);
  assert.equal(readAutoSave({ getItem: () => "true" }), true);
  assert.equal(readAutoSave({ getItem: () => { throw Error("unavailable"); } }), true);
});

test("automatic saving runs only with a file, unsaved changes and no pending blockers", () => {
  const ready = { enabled: true, path: "/map.json", composing: false, busy: false, paused: false, dirty: true };
  assert.equal(shouldAutoSave(ready), true);
  for (const change of [{ enabled: false }, { path: "" }, { composing: true }, { busy: true }, { paused: true }, { dirty: false }]) {
    assert.equal(shouldAutoSave({ ...ready, ...change }), false);
  }
});

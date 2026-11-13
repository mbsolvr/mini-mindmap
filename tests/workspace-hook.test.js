import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

test("workspace commits record history and ignore changes while opening", async () => {
  const source = await readFile(new URL("../src/hooks/useWorkspace.ts", import.meta.url), "utf8");
  const compiled = await transform(source, { loader: "ts", format: "esm" });
  const code = compiled.code.replace(/import \{ useRef, useState \} from "react";/, 'const { useRef, useState } = globalThis.__workspaceHookTest;')
    .replaceAll('"../model.ts"', `"${new URL("../src/model.ts", import.meta.url).href}"`)
    .replaceAll('"../limits.ts"', `"${new URL("../src/limits.ts", import.meta.url).href}"`)
    .replaceAll('"../summaries.ts"', `"${new URL("../src/summaries.ts", import.meta.url).href}"`);
  const previous = globalThis.__workspaceHookTest;
  let rendered, notices = 0, error = "";
  globalThis.__workspaceHookTest = { useRef: value => ({ current: value }), useState: initial => [typeof initial === "function" ? initial() : initial, value => { rendered = value; }] };
  try {
    const { useWorkspace } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    const opening = { current: false }, hook = useWorkspace(opening, () => notices++, "Central Topic", message => { error = message; });
    const original = hook.workspaceRef.current, key = original.tabs[0].tree.key;
    assert.equal(hook.changeMap(map => map), false);
    assert.equal(hook.historyRef.current.length, 0);
    const children = Array.from({ length: 5000 }, (_, i) => ({ key: String(i), text: "", children: [] }));
    assert.equal(hook.changeTree(key, node => ({ ...node, children })), false);
    assert.match(error, /5000/);
    assert.equal(hook.workspaceRef.current, original);
    assert.equal(hook.historyRef.current.length, 0);
    assert.equal(hook.isTabDirty(original.tabs[0]), false);
    hook.changeTree(key, node => ({ ...node, text: "changed" }));
    assert.equal(hook.workspaceRef.current.tabs[0].tree.text, "changed");
    assert.equal(hook.historyRef.current[0], original);
    assert.equal(rendered, hook.workspaceRef.current);
    assert.equal(hook.dirtyRef.current, true);
    assert.equal(hook.isTabDirty(hook.workspaceRef.current.tabs[0]), true);
    assert.equal(notices, 1);
    const changed = hook.workspaceRef.current;
    assert.equal(hook.travel(hook.historyRef.current, hook.redoRef.current), original);
    assert.equal(hook.dirtyRef.current, false);
    assert.equal(hook.isTabDirty(original.tabs[0]), false);
    assert.equal(hook.redoRef.current[0], changed);
    assert.equal(hook.travel(hook.redoRef.current, hook.historyRef.current), changed);
    opening.current = true;
    hook.changeTree(key, node => ({ ...node, text: "ignored" }));
    assert.equal(hook.workspaceRef.current.tabs[0].tree.text, "changed");
    assert.equal(hook.historyRef.current.length, 1);
    hook.markTabsSaved(changed);
    assert.equal(hook.isTabDirty(changed.tabs[0]), false);
    hook.historyRef.current = Array.from({ length: 130 }, () => original);
    hook.redoRef.current = [changed];
    hook.recordHistory(changed);
    assert.equal(hook.historyRef.current.length, 100);
    assert.equal(hook.historyRef.current.at(-1), changed);
    assert.deepEqual(hook.redoRef.current, []);
  } finally { globalThis.__workspaceHookTest = previous; }
});

test("snapshot comparison skips shared image payloads and unchanged subtrees", async () => {
  const { sameSnapshot } = await import("../src/model.ts");
  let reads = 0;
  const image = { get src() { reads++; return "large-image"; } };
  const shared = { children: [], image };
  const first = { text: "before", children: [shared], image };
  assert.equal(sameSnapshot(first, { ...first, text: "after" }), false);
  assert.equal(sameSnapshot(first, { ...first }), true);
  assert.equal(sameSnapshot({ ...first, extra: undefined }, first), true);
  assert.equal(reads, 0);
});

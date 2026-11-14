import { test } from "node:test";
import assert from "node:assert/strict";
import { hookRuntime, loadHook } from "./helpers/hooks.mjs";

test("a document revision cancels node dragging before a stale drop can commit", async t => {
  const runtime = hookRuntime();
  runtime.hooks.useLayoutEffect = runtime.hooks.useEffect;
  const { useNodeDrag } = await loadHook(new URL("../src/hooks/useNodeDrag.ts", import.meta.url), runtime.hooks);
  const original = { tree: { key: "r", children: [] } };
  const workspaceRef = { current: { active: 0, tabs: [original] } };
  let edits = 0;
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  t.after(() => { runtime.unmount(); globalThis.window = previousWindow; });
  const hook = runtime.render(() => useNodeDrag({ workspace: workspaceRef.current, workspaceRef, layoutBefore: { current: null }, changeMap() { edits++; } }));
  hook.dragRef.current = { pointer: 1, map: original, moved: true };
  workspaceRef.current = { active: 0, tabs: [{ tree: { ...original.tree } }] };
  hook.dragEnd({ pointerId: 1 });
  assert.equal(hook.dragRef.current, null);
  assert.equal(edits, 0);
});

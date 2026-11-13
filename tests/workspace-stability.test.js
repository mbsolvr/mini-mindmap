import { test } from "node:test";
import assert from "node:assert/strict";
import { hookRuntime, loadHook } from "./helpers/hooks.mjs";
import { serializeWorkspace, parseDocument, tabViewKey } from "../src/model.ts";
import { createArchive, readArchive } from "../src/archive.ts";
import { richWorkspace } from "./samples.mjs";
import { createSummary } from "../src/summaries.ts";

test("structural edits reconcile summary members atomically and reject invalid layouts", async (t) => {
  const runtime = hookRuntime();
  const { useWorkspace } = await loadHook(new URL("../src/hooks/useWorkspace.ts", import.meta.url), runtime.hooks);
  const errors = [];
  const ws = runtime.render(() => useWorkspace({ current: false }, () => {}, "Root", (error) => errors.push(error)));
  t.after(() => runtime.unmount());
  const node = (key, extra = {}) => ({ key, text: key, children: [], ...extra });
  const map = createSummary({ tree: node("root", { children: [node("a"), node("b")] }) }, ["a", "b"], "s", "Summary");
  ws.changeMap(() => map);
  const before = ws.workspaceRef.current;
  assert.equal(ws.changeTree("root", (root) => ({ ...root, children: [root.children[0], node("inserted"), ...root.children.slice(1)] })), true);
  assert.deepEqual(new Set(ws.workspaceRef.current.tabs[0].tree.summaries[0].topics), new Set(["a", "b", "inserted"]));
  assert.equal(ws.travel(ws.historyRef.current, ws.redoRef.current), before);
  assert.deepEqual(ws.workspaceRef.current.tabs[0].tree.summaries[0].topics, ["a", "b"]);
  const logic = createSummary({ tree: node("root", { layout: "logic", children: [node("left", { side: "left" }), node("right", { side: "right" })] }) }, ["left", "right"], "both", "Summary");
  ws.changeMap(() => logic);
  const saved = ws.workspaceRef.current;
  assert.equal(ws.changeTree("root", (root) => ({ ...root, layout: "mindmap" })), false);
  assert.equal(ws.workspaceRef.current, saved);
  assert.deepEqual(errors, ["This change would create conflicting summaries"]);
});

test("rerendering an unchanged workspace does not serialize it again", async () => {
  const runtime = hookRuntime();
  const { useWorkspace } = await loadHook(
    new URL("../src/hooks/useWorkspace.ts", import.meta.url), runtime.hooks,
  );
  const opening = { current: false };
  const render = () => runtime.render(() => useWorkspace(opening, () => {}));
  const ws = render();
  let reads = 0;
  Object.defineProperty(ws.workspace.tabs[0].tree, "text", {
    enumerable: true,
    get() { reads++; return "Root"; },
  });
  render();
  render();
  assert.equal(reads, 0);
  ws.updateDirty();
  assert.equal(reads, 0);
  runtime.unmount();
});

async function setup(t) {
  const runtime = hookRuntime();
  const { useWorkspace } = await loadHook(
    new URL("../src/hooks/useWorkspace.ts", import.meta.url),
    runtime.hooks,
  );
  const { useRelations } = await loadHook(
    new URL("../src/hooks/useRelations.ts", import.meta.url),
    runtime.hooks,
  );
  const opening = { current: false };
  let result;
  function render() {
    return (result = runtime.render(() => {
      const ws = useWorkspace(
        opening,
        () => {},
        "Root",
        (error) => {
          throw new Error(error);
        },
      );
      const relations = useRelations({
        workspace: ws.workspace,
        workspaceRef: ws.workspaceRef,
        changeTree: ws.changeTree,
        selected: null,
        multiKeys: new Set(),
        selectOne() {},
        setPane() {},
        setContext() {},
        setStatus() {},
      });
      return { ws, relations };
    }));
  }
  render();
  const initial = { ...richWorkspace(), active: 0 };
  result.ws.commit(initial, false);
  result.ws.savedRef.current = serializeWorkspace(initial);
  result.ws.updateDirty();
  result.ws.markTabsSaved(initial);
  render();
  t.after(() => runtime.unmount());
  return { render, initial };
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

test("mixed edits undo and redo exactly, keep tab identity, and restore the saved checkpoint", async (t) => {
  const h = await setup(t),
    snapshots = [freeze(h.initial)],
    expected = [structuredClone(h.initial)];
  const identity = tabViewKey(h.initial.tabs[0]);
  let saved;
  for (let i = 1; i <= 80; i++) {
    const { ws, relations } = h.render(),
      current = ws.workspaceRef.current.tabs[0];
    if (i % 4 === 0)
      relations.adjustRelation(
        "rel",
        { start: { x: i, y: -i - 40 }, end: { x: i / 2, y: -i * 2 } },
        current.tree,
      );
    if (i % 4 === 1)
      ws.changeTree("a", (node) => ({ ...node, text: `Edit ${i} 中文` }));
    if (i % 4 === 2)
      ws.changeMap((map) => ({
        floatingTopics: map.floatingTopics.map((topic) => ({
          ...topic,
          x: topic.x + 3,
          y: topic.y - 2,
        })),
      }));
    if (i % 4 === 3)
      ws.changeMap((map) => ({
        floatingNotes: map.floatingNotes.map((note) => ({
          ...note,
          text: `Note ${i}`,
        })),
      }));
    const next = ws.workspaceRef.current;
    assert.equal(ws.historyRef.current.length, i);
    assert.equal(tabViewKey(next.tabs[0]), identity);
    assert.equal(next.tabs[1], h.initial.tabs[1]);
    snapshots.push(freeze(next));
    expected.push(structuredClone(next));
    if (i === 32) {
      saved = serializeWorkspace(next);
      ws.savedRef.current = saved;
      ws.markTabsSaved(next);
      ws.updateDirty();
    }
    if (i % 10 === 0)
      assert.deepEqual(
        parseDocument(
          await readArchive(await createArchive(serializeWorkspace(next))),
        ),
        next,
      );
  }
  const { ws } = h.render();
  for (let i = 79; i >= 0; i--) {
    const state = ws.travel(ws.historyRef.current, ws.redoRef.current);
    assert.deepEqual(state, expected[i]);
    assert.equal(ws.dirtyRef.current, serializeWorkspace(state) !== saved);
    assert.equal(ws.isTabDirty(state.tabs[0]), i !== 32);
    assert.equal(tabViewKey(state.tabs[0]), identity);
  }
  assert.equal(ws.travel(ws.historyRef.current, ws.redoRef.current), null);
  for (let i = 1; i <= 80; i++)
    assert.deepEqual(
      ws.travel(ws.redoRef.current, ws.historyRef.current),
      expected[i],
    );
  assert.equal(ws.travel(ws.redoRef.current, ws.historyRef.current), null);
  snapshots.forEach((snapshot, i) =>
    assert.deepEqual(snapshot, expected[i], `mutated history at ${i}`),
  );
  for (let i = 0; i < 3; i++)
    ws.travel(ws.historyRef.current, ws.redoRef.current);
  ws.changeTree("a", (node) => ({ ...node, text: "New history branch" }));
  assert.equal(ws.redoRef.current.length, 0);
});

test("history eviction bounds undo without corrupting retained snapshots", async (t) => {
  const h = await setup(t);
  for (let i = 1; i <= 140; i++)
    h.render().ws.changeTree("a", (node) => ({
      ...node,
      text: `Revision ${i}`,
    }));
  const { ws } = h.render();
  assert.equal(ws.historyRef.current.length, 100);
  for (let i = 139; i >= 40; i--) {
    const next = ws.travel(ws.historyRef.current, ws.redoRef.current);
    assert.equal(next.tabs[0].tree.children[0].text, `Revision ${i}`);
  }
  assert.equal(ws.travel(ws.historyRef.current, ws.redoRef.current), null);
  assert.equal(ws.redoRef.current.length, 100);
});

test("a stale curve commit cannot enter another tab's history", async (t) => {
  const h = await setup(t);
  const { ws, relations } = h.render(),
    original = ws.workspaceRef.current;
  ws.commit({ ...original, active: 1 }, false);
  relations.adjustRelation(
    "rel",
    { start: { x: 1, y: 2 }, end: { x: 3, y: 4 } },
    original.tabs[0].tree,
  );
  assert.equal(ws.historyRef.current.length, 0);
  assert.equal(ws.workspaceRef.current.tabs[1], original.tabs[1]);
});

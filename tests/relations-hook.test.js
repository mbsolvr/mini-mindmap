import { test } from "node:test";
import assert from "node:assert/strict";
import { hookRuntime, loadHook } from "./helpers/hooks.mjs";
import { tabViewKey, tabWithTree } from "../src/model.ts";

async function setup(t) {
  const runtime = hookRuntime();
  const { useRelations } = await loadHook(
    new URL("../src/hooks/useRelations.ts", import.meta.url),
    runtime.hooks,
  );
  const tree = {
    key: "root",
    text: "Root",
    children: [
      { key: "a", text: "A", children: [] },
      { key: "b", text: "B", children: [] },
    ],
    relations: [
      {
        relKey: "r",
        from: "a",
        to: "b",
        label: "Original",
        controls: { start: { x: 10, y: -30 }, end: { x: 20, y: -40 } },
      },
    ],
  };
  const first = { tree },
    second = structuredClone(first);
  const workspaceRef = { current: { active: 0, tabs: [first, second] } },
    edits = [],
    statuses = [],
    selections = [];
  const options = {
    workspaceRef,
    selected: "a",
    multiKeys: new Set(),
    setPane() {},
    setContext() {},
    selectOne: (key) => selections.push(key),
    setStatus: (value) => statuses.push(value),
    changeTree(key, transform) {
      const ws = workspaceRef.current,
        current = ws.tabs[ws.active],
        tree = transform(current.tree);
      edits.push(tree);
      const tabs = ws.tabs.slice();
      tabs[ws.active] = tabWithTree(current, tree);
      workspaceRef.current = { ...ws, tabs };
      return true;
    },
  };
  const render = (effects = true) =>
    runtime.render(
      () => useRelations({ ...options, workspace: workspaceRef.current }),
      effects,
    );
  t.after(() => runtime.unmount());
  return {
    runtime,
    options,
    workspaceRef,
    first,
    second,
    tree,
    edits,
    statuses,
    selections,
    render,
  };
}

test("curve updates resolve the connection ID and reject stale documents or invalid coordinates", async (t) => {
  const h = await setup(t),
    hook = h.render(),
    controls = { start: { x: 10, y: -20 }, end: { x: 30, y: -40 } };
  hook.adjustRelation("r", controls, h.tree);
  assert.equal(h.edits.length, 1);
  assert.equal(h.edits[0].relations[0].controls, controls);
  assert.equal(h.tree.relations[0].controls.start.y, -30);
  const current = h.workspaceRef.current.tabs[0].tree;
  hook.adjustRelation("missing", controls, current);
  hook.adjustRelation(
    "r",
    { start: { x: Infinity, y: 0 }, end: controls.end },
    current,
  );
  hook.adjustRelation("r", controls, h.tree);
  assert.equal(h.edits.length, 1);
});

test("renaming a connection preserves its endpoints, curve controls and other topics", async (t) => {
  const h = await setup(t);
  h.render().editRelation(0);
  h.render().saveRelationLabel("x".repeat(150));
  assert.equal(h.edits.length, 1);
  assert.equal(h.edits[0].relations[0].label, "x".repeat(100));
  assert.equal(h.edits[0].relations[0].controls, h.tree.relations[0].controls);
  assert.equal(h.edits[0].children, h.tree.children);
  assert.equal(h.tree.relations[0].label, "Original");
});

test("edits to other topics do not invalidate a label edit within the same tab", async (t) => {
  const h = await setup(t);
  h.render().editRelation(0);
  h.options.changeTree("root", (root) => ({ ...root, text: "Changed root" }));
  h.render().saveRelationLabel("New label");
  assert.equal(h.edits.at(-1).text, "Changed root");
  assert.equal(h.edits.at(-1).relations[0].label, "New label");
});

for (const reason of ["cancel", "unchanged", "deleted", "tab-switch"]) {
  test(`connection label blur does not save after ${reason}`, async (t) => {
    const h = await setup(t);
    h.render().editRelation(0);
    let hook = h.render();
    if (reason === "cancel") hook.cancelRelationEdit.current = true;
    if (reason === "deleted")
      h.workspaceRef.current = {
        ...h.workspaceRef.current,
        tabs: [{ tree: { ...h.tree, relations: [] } }, h.second],
      };
    if (reason === "tab-switch")
      h.workspaceRef.current = { ...h.workspaceRef.current, active: 1 };
    hook.saveRelationLabel(
      reason === "unchanged" ? "Original" : "Do not write",
    );
    assert.deepEqual(h.edits, []);
  });
}

test("replacing a workspace with matching IDs cannot redirect a pending label edit", async (t) => {
  const h = await setup(t);
  h.render().editRelation(0);
  const hook = h.render();
  h.workspaceRef.current = { active: 0, tabs: [h.second] };
  hook.saveRelationLabel("Wrong document");
  assert.deepEqual(h.edits, []);
});

test("closing the active tab cannot redirect a pending context command to a matching ID", async (t) => {
  const h = await setup(t),
    hook = h.render(),
    identity = tabViewKey(h.first);
  assert.equal(hook.relationIndex("r", 0, identity), 0);
  h.workspaceRef.current = { active: 0, tabs: [h.second] };
  assert.equal(hook.relationIndex("r", 0, identity), -1);
});

test("closing a tab cannot carry a pending connection into the next map", async (t) => {
  const h = await setup(t);
  globalThis.document = { activeElement: { blur() {} } };
  t.after(() => delete globalThis.document);
  h.render().startRelation("a");
  const hook = h.render();
  h.workspaceRef.current = { active: 0, tabs: [h.second] };
  hook.relationPick("b");
  assert.deepEqual(h.edits, []);
  h.render();
  assert.equal(h.render().relationSource, null);
});

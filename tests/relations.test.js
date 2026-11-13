import { test } from "node:test";
import { templates, resolveTemplate } from "../src/templates.ts";
import assert from "node:assert/strict";
import { addRelation, relationCurve } from "../src/relations.ts";
import { serializeWorkspace, parseDocument, workspaceFromDocument, moveNodes } from "../src/model.ts";
import { resolveLayout } from "../src/layouts.ts";
import { createArchive, readArchive } from "../src/archive.ts";
const node = (key, children = []) => ({ key, text: key, children });

test("relations reject self links, missing nodes and duplicate edges in either direction", () => {
  const tree = node("root", [node("a"), node("b")]);
  const connected = addRelation(tree, "a", "b");
  assert.equal(connected.relations.length, 1);
  assert.equal(addRelation(connected, "b", "a"), connected);
  assert.equal(addRelation(connected, "a", "a"), connected);
  assert.equal(addRelation(connected, "a", "missing"), connected);
  const restored = parseDocument(serializeWorkspace(workspaceFromDocument({ tree: connected })));
  assert.deepEqual(restored.tree.relations, connected.relations);
  const moved = moveNodes(connected, ["a"], "b", "inside");
  assert.notEqual(moved, connected);
  assert.deepEqual(parseDocument(serializeWorkspace(workspaceFromDocument({ tree: moved }))).tree.relations, connected.relations);
});

test("relation curves connect facing edges in all directions", () => {
  const a = { x: 0, y: 0, width: 20, height: 20 };
  assert.match(relationCurve(a, { x: 100, y: 0, width: 20, height: 20 }).d, /^M20,10 C/);
  assert.match(relationCurve(a, { x: -100, y: 0, width: 20, height: 20 }).d, /^M0,10 C/);
  assert.match(relationCurve(a, { x: 0, y: 100, width: 20, height: 20 }).d, /^M10,20 C/);
  assert.match(relationCurve(a, { x: 0, y: -100, width: 20, height: 20 }).d, /^M10,0 C/);
});

test("custom curves attach toward their handles and follow each endpoint independently", () => {
  const a = { x: 0, y: 0, width: 20, height: 20 }, b = { ...a, x: 100 };
  const controls = { start: { x: 0, y: -80 }, end: { x: -20, y: -100 } };
  const curve = relationCurve(a, b, controls);
  assert.deepEqual(curve.start, { x: 10, y: 0 });
  assert.deepEqual(curve.end, { x: 108, y: 0 });
  assert.deepEqual(curve.c1, { x: 10, y: -70 });
  assert.deepEqual(curve.c2, { x: 90, y: -90 });
  assert.equal(curve.x, (10 + 3 * 10 + 3 * 90 + 108) / 8);
  assert.equal(curve.y, -65);
  const moved = relationCurve({ ...a, x: 40, y: 20 }, b, controls);
  assert.deepEqual(moved.c1, { x: 50, y: -50 });
  assert.deepEqual(moved.c2, curve.c2);
  assert.deepEqual(moved.end, curve.end);
  const both = relationCurve({ ...a, x: 40, y: 20 }, { ...b, x: 140, y: 20 }, controls);
  assert.deepEqual(both.start, { x: curve.start.x + 40, y: curve.start.y + 20 });
  assert.deepEqual(both.end, { x: curve.end.x + 40, y: curve.end.y + 20 });
  const zero = relationCurve(a, a, { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } });
  assert.ok(!/NaN|Infinity/.test(zero.d));
});

test("connection control points survive minimap archives and reject invalid coordinates", async () => {
  const tree = addRelation(node("root", [node("a"), node("b")]), "a", "b");
  tree.relations[0].controls = { start: { x: -12.5, y: -80 }, end: { x: 40, y: -100 } };
  const serialized = serializeWorkspace(workspaceFromDocument({ tree }));
  assert.deepEqual(parseDocument(await readArchive(await createArchive(serialized))).tree.relations, tree.relations);
  for (const controls of [null, [], {}, { start: { x: 0, y: 1 } }, { start: { x: "1", y: 0 }, end: { x: 0, y: 0 } }, { start: { x: 100001, y: 0 }, end: { x: 0, y: 0 } }]) {
    const malformed = JSON.parse(serialized);
    malformed.tree.relations[0].controls = controls;
    assert.throws(() => parseDocument(JSON.stringify(malformed)), /Invalid connection/);
  }
  assert.throws(() => parseDocument(serialized.replace(/"x":\s*-12\.5/, '"x":1e999')), /Invalid connection/);
});
test("all original layouts resolve and unknown ones use the default", () => {
  for (const key of ["logic", "mindmap", "reverse", "org", "fishbone", "reverse-fishbone"]) assert.equal(resolveLayout(key), key);
  assert.equal(resolveLayout("unknown"), "mindmap");
});
test("themes default to the standard style and preserve supported selections", () => {
  assert.deepEqual(templates, [["default", "Default"], ["midnight", "Midnight"]]);
  assert.equal(resolveTemplate(undefined), "default");
  assert.equal(resolveTemplate("unknown"), "default");
  assert.equal(resolveTemplate("midnight"), "midnight");
  assert.equal(resolveTemplate("default"), "default");
});

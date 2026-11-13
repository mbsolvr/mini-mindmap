import { test } from "node:test";
import assert from "node:assert/strict";
import { moveMapTopics, selectedMapTopics } from "../src/mapMove.ts";

const node = (key, children = [], extra = {}) => ({ key, text: key, children, ...extra });
function fixture() {
  return { tree: node("root", [node("a", [node("a1")]), node("b", [], { collapsed: true })], { relations: [{ relKey: "r", from: "a1", to: "f1", label: "link" }] }), floatingTopics: [{ x: -10, y: 20, tree: node("f", [node("f1")]) }], floatingNotes: [{ key: "n", text: "note", x: 1, y: 2 }] };
}
test("detaching a subtree preserves its children and all connections", () => {
  const map = fixture(), positions = new Map([["a", { x: -40, y: 80 }]]);
  const next = moveMapTopics(map, ["a"], { kind: "float", positions });
  assert.deepEqual(next.tree.children.map(item => item.key), ["b"]);
  assert.equal(next.floatingTopics[1].tree, map.tree.children[0]);
  assert.deepEqual(next.floatingTopics[1].tree.children.map(item => item.key), ["a1"]);
  assert.deepEqual(next.tree.relations, map.tree.relations);
  assert.equal(map.tree.children.length, 2);
});
test("attaching floating and cross-tree topics preserves subtrees, order and relations", () => {
  const map = fixture();
  const next = moveMapTopics(map, ["f"], { kind: "attach", key: "b", position: "inside", side: null, layout: "mindmap" });
  assert.equal(next.floatingTopics.length, 0);
  assert.equal(next.tree.children[1].collapsed, false);
  assert.equal(next.tree.children[1].children[0].children[0].key, "f1");
  assert.deepEqual(next.tree.relations, map.tree.relations);
  const cross = moveMapTopics(map, ["a1"], { kind: "attach", key: "f1", position: "inside", side: null, layout: "logic" });
  assert.equal(cross.tree.children[0].children.length, 0);
  assert.equal(cross.floatingTopics[0].tree.children[0].children[0].key, "a1");
  assert.deepEqual(cross.tree.relations, map.tree.relations);
});
test("group operations avoid duplicates, cycles, invalid positions and primary root moves", () => {
  const map = fixture();
  assert.deepEqual(selectedMapTopics(map, ["a", "a1", "f"]).map(item => item.key), ["a", "f"]);
  assert.equal(moveMapTopics(map, ["a"], { kind: "attach", key: "a1", position: "inside", side: null, layout: "logic" }), map);
  assert.equal(moveMapTopics(map, ["root"], { kind: "float", positions: new Map([["root", { x: 1, y: 2 }]]) }), map);
  assert.equal(moveMapTopics(map, ["a"], { kind: "float", positions: new Map([["a", { x: Infinity, y: 2 }]]) }), map);
  const moved = moveMapTopics(map, ["a", "a1", "f"], { kind: "float", positions: new Map([["a", { x: 1, y: 2 }], ["f", { x: 3, y: 4 }]]) });
  assert.deepEqual(moved.floatingTopics.map(item => item.tree.key), ["a", "f"]);
  assert.equal(moved.floatingTopics[0].tree.children[0].key, "a1");
});
test("moves that exceed the supported tree depth are rejected", () => {
  let tree = node("deep");
  for (let i = 0; i < 100; i++) tree = node(`p${i}`, [tree]);
  const map = { tree, floatingTopics: [{ x: 0, y: 0, tree: node("free") }] };
  assert.equal(moveMapTopics(map, ["free"], { kind: "attach", key: "deep", position: "inside", side: null, layout: "logic" }), map);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { newDocument, parseDocument, updateNode, findParent, pastedImage, serializeWorkspace, workspaceFromDocument, setAllCollapsed, moveNode, moveNodes, topLevelSelection } from "../src/model.ts";

test("tab view identity survives edits while duplicate maps remain independent", async () => {
  const { tabViewKey, tabWithTree } = await import("../src/model.ts");
  const tree = newDocument().tree, first = { tree }, second = { tree };
  const changed = tabWithTree(first, { ...tree, text: "edited" });
  assert.equal(tabViewKey(first), tabViewKey(changed));
  assert.notEqual(tabViewKey(first), tabViewKey(second));
  assert.deepEqual(Object.keys(changed), ["tree"]);
});

test("map validation rejects malformed styles and connections and applies limits per map", () => {
  const root = { key: "root", text: "r", children: [] };
  const document = tree => JSON.stringify({ format: "mini-mindmap", version: 2, type: "map", tree });
  assert.throws(() => parseDocument(document({ ...root, textStyle: { size: {} } })), /style/);
  assert.throws(() => parseDocument(document({ ...root, relations: [{ relKey: "a", from: "root", to: "missing", label: "" }] })), /connection/);
  const many = { ...root, children: Array.from({ length: 4999 }, (_, i) => ({ key: String(i), text: "", children: [] })) };
  assert.doesNotThrow(() => parseDocument(JSON.stringify({ format: "mini-mindmap", version: 2, type: "workspace", active: 0, tabs: [{ tree: many }, { tree: many }] })));
  assert.throws(() => parseDocument(document({ ...many, children: [...many.children, { key: "extra", text: "", children: [] }] })), /complex/);
  let deep = { key: "leaf", text: "", children: [] };
  for (let i = 0; i < 100; i++) deep = { key: `d${i}`, text: "", children: [deep] };
  assert.doesNotThrow(() => parseDocument(document(deep)));
  assert.throws(() => parseDocument(document({ key: "too-deep", text: "", children: [deep] })), /complex/);
});

test("children change immutably and can navigate to their parent", () => {
  const doc = newDocument();
  const child = { key: "child", text: "child", children: [] };
  const result = updateNode(doc.tree, doc.tree.key, node => ({ ...node, children: [...node.children, child] }));
  assert.equal(doc.tree.children.length, 0);
  assert.equal(findParent(result, "child"), result.key);
  assert.equal(findParent(result, result.key), null);
});
test("single maps and workspaces preserve node and tab properties", () => {
  const raw = { format: "mini-mindmap", version: 2, type: "map", tree: { key: "root", text: "", image: { src: "data:image/png;base64,AA==" }, textStyle: { bold: true }, children: [] } };
  const single = parseDocument(JSON.stringify(raw));
  assert.deepEqual(Object.keys(JSON.parse(serializeWorkspace(workspaceFromDocument(single)))), ["format", "version", "type", "tree"]);
  assert.throws(() => parseDocument(JSON.stringify({ ...raw, version: 1 })), /version/);
  assert.deepEqual(single.tree.image, raw.tree.image);
  assert.equal(single.tree.textStyle.bold, true);
  const ws = { format: "mini-mindmap", version: 2, type: "workspace", active: 1, tabs: [{ name: "one", tree: raw.tree }, { label: "two", tree: raw.tree }] };
  const restored = parseDocument(serializeWorkspace(ws));
  assert.equal(restored.format, "mini-mindmap");
  assert.equal(restored.type, "workspace");
  assert.equal(restored.active, 1);
  assert.equal(restored.tabs[1].label, undefined);
  assert.deepEqual(restored.tabs[1].tree.image, raw.tree.image);
  assert.equal(parseDocument(serializeWorkspace(workspaceFromDocument(single))).tree.textStyle.bold, true);
  assert.throws(() => parseDocument('{"format":"mini-mindmap","version":2,"type":"workspace","active":0,"tabs":[]}'), /workspace/);
  assert.throws(() => parseDocument('{"format":"mini-mindmap","version":2,"type":"map","tree":{"text":"x","children":[{"key":"x","text":"a"},{"key":"x","text":"b"}]}}'), /duplicate/);
});
test("detects a pasted image and ignores non-image content", () => {
  const file = { type: "image/png" };
  assert.equal(pastedImage([{ kind: "string", type: "text/plain" }, { kind: "file", type: "image/png", getAsFile: () => file }]), file);
  assert.equal(pastedImage([{ kind: "file", type: "image/svg+xml" }]), null);
});

test("collapse all keeps the root open and expand all restores descendant visibility", () => {
  const tree = { key: "root", text: "root", collapsed: true, children: [{ key: "a", text: "a", children: [{ key: "b", text: "b", children: [] }] }] };
  const collapsed = setAllCollapsed(tree, true);
  assert.equal(collapsed.collapsed, false);
  assert.equal(collapsed.children[0].collapsed, true);
  assert.equal(tree.collapsed, true);
  const expanded = setAllCollapsed(collapsed, false);
  assert.equal(expanded.children[0].collapsed, false);
  assert.equal(setAllCollapsed(expanded, false), expanded);
});

test("move nodes between branches and reorder siblings without mutating the original", () => {
  const child = (key, children = []) => ({ key, text: key, children });
  const tree = child("root", [child("a", [child("a1")]), child("b", [child("b1")]), child("c")]);
  const moved = moveNode(tree, "a1", "b", "inside");
  assert.deepEqual(tree.children[0].children.map(n => n.key), ["a1"]);
  assert.deepEqual(moved.children[0].children, []);
  assert.deepEqual(moved.children[1].children.map(n => n.key), ["b1", "a1"]);
  const reordered = moveNode(tree, "a", "c", "after");
  assert.deepEqual(reordered.children.map(n => n.key), ["b", "c", "a"]);
  assert.equal(moveNode(tree, "a", "b", "before"), tree);
  assert.equal(moveNode(tree, "root", "a", "inside"), tree);
  assert.equal(moveNode(tree, "a", "a1", "inside"), tree);
  assert.equal(moveNode(tree, "a", "missing", "inside"), tree);
});

test("moving inside a collapsed branch opens it and preserves node data", () => {
  const tree = { key: "r", text: "r", children: [
    { key: "a", text: "a", image: { src: "data:image/png;base64,AA==" }, children: [] },
    { key: "b", text: "b", collapsed: true, children: [] }
  ] };
  const result = moveNode(tree, "a", "b", "inside");
  assert.equal(result.children[0].collapsed, false);
  assert.equal(result.children[0].children[0].image.src, tree.children[0].image.src);
});

test("group move preserves tree order, images and subtrees across branches", () => {
  const node = (key, children = [], extra = {}) => ({ key, text: key, children, ...extra });
  const tree = node("root", [node("a", [node("a1")]), node("b", [node("b1", [], { image: { src: "data:image/png;base64,AA==" } })]), node("c"), node("d")]);
  const moved = moveNodes(tree, ["c", "a1", "b1"], "d", "inside");
  assert.deepEqual(moved.children.map(n => n.key), ["a", "b", "d"]);
  assert.deepEqual(moved.children[2].children.map(n => n.key), ["a1", "b1", "c"]);
  assert.equal(moved.children[2].children[1].image.src, "data:image/png;base64,AA==");
  assert.deepEqual(tree.children.map(n => n.key), ["a", "b", "c", "d"]);
  assert.deepEqual(tree.children[0].children.map(n => n.key), ["a1"]);
});

test("group selection moves ancestors only once and rejects circular or root moves", () => {
  const node = (key, children = []) => ({ key, text: key, children });
  const tree = node("root", [node("a", [node("a1")]), node("b"), node("c"), node("d")]);
  assert.deepEqual(topLevelSelection(tree, ["root", "a", "a1", "c"]).map(n => n.key), ["a", "c"]);
  assert.equal(moveNodes(tree, ["a", "c"], "a1", "inside"), tree);
  assert.equal(moveNodes(tree, ["root"], "b", "inside"), tree);
  const moved = moveNodes(tree, ["c", "a1", "a"], "d", "before");
  assert.deepEqual(moved.children.map(n => n.key), ["b", "a", "c", "d"]);
  assert.deepEqual(moved.children[1].children.map(n => n.key), ["a1"]);
  assert.equal(moveNodes(tree, ["a", "b"], "c", "before"), tree);
  assert.equal(moveNodes(tree, ["a", "b"], "root", "before"), tree);
});

test("mindmap branch side changes preserve subtrees and ignore non-root keys", async () => {
  const { setRootBranchSides } = await import("../src/model.ts");
  const tree = { key: "r", text: "r", children: [{ key: "a", text: "a", children: [{ key: "nested", text: "n", children: [] }] }, { key: "b", text: "b", side: "left", children: [] }] };
  const changed = setRootBranchSides(tree, ["a", "nested"], "left");
  assert.equal(changed.children[0].side, "left");
  assert.equal(changed.children[0].children[0].side, undefined);
  assert.equal(tree.children[0].side, undefined);
  assert.equal(setRootBranchSides(changed, ["a"], "left"), changed);
});

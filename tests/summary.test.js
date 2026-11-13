import { test } from "node:test";
import assert from "node:assert/strict";
import { createArchive, readArchive } from "../src/archive.ts";
import { parseDocument } from "../src/model.ts";
import { removeMapTopics } from "../src/mapOperations.ts";
import { moveMapTopics } from "../src/mapMove.ts";
import { toMarkdown } from "../src/markdown.ts";
import JSZip from "jszip";
import { createSummary, hasSummaryConflict, nodeDepth, prepareSummaryTopics, settleSummaries } from "../src/summaries.ts";
import { findNode, treeForKey, updateNode } from "../src/model.ts";

const node = (key, children = []) => ({ key, text: key, children });
function example() {
  return createSummary({ format: "mini-mindmap", version: 2, type: "map",
    tree: node("root", [node("a"), node("b")]),
    floatingTopics: [{ x: 20, y: 30, tree: node("f") }] }, ["a", "f"], "s", "Group");
}

test("summary survives save, reopen and moving topics across trees", async () => {
  const map = example();
  const archive = await createArchive(JSON.stringify(map));
  const zip = await JSZip.loadAsync(archive, { base64: true });
  assert.equal(JSON.parse(await zip.file("manifest.json").async("string")).version, 4);
  assert.deepEqual(parseDocument(await readArchive(archive)), map);
  const moved = moveMapTopics(map, ["a"], { kind: "attach", key: "f", position: "inside", side: null, layout: "mindmap" });
  assert.deepEqual(moved.tree.summaries, map.tree.summaries);
  assert.deepEqual(parseDocument(await readArchive(await createArchive(JSON.stringify(moved)))).tree.summaries, map.tree.summaries);
  assert.match(toMarkdown(map.tree, map.floatingTopics), /## Summaries\n\n- Group: a, f/);
});

test("deleting topics updates summaries without mutating the undo snapshot", () => {
  const map = example();
  const one = removeMapTopics(map, new Set(["a"]));
  assert.deepEqual(one.tree.summaries, [{ key: "s", topics: ["f"] }]);
  assert.deepEqual(removeMapTopics(one, new Set(["f"])).tree.summaries, []);
  assert.deepEqual(map.tree.summaries[0].topics, ["a", "f"]);
});

test("invalid summary references and duplicates are rejected", () => {
  for (const invalid of [
    { key: "s", topics: ["missing"] },
    { key: "s", topics: ["a", "a"] },
    { key: "s", topics: ["s"] },
    { key: "missing", topics: ["a"] },
  ]) {
    const map = example();
    map.tree.summaries = [invalid];
    assert.throws(() => parseDocument(JSON.stringify(map)), /Invalid summary/);
  }
});

test("nested, duplicate, and crossing summaries are rejected when reopening", () => {
  let map = { format: "mini-mindmap", version: 2, type: "map", tree: node("root", [node("a", [node("a1"), node("a2")]), node("b"), node("c"), node("d")]) };
  map = createSummary(map, ["a", "b"], "s1", "One");
  findNode(map.tree, "s1").children.push(node("child1"), node("child2"));
  for (const topics of [["a", "b"], ["a1", "a2"], ["a", "b", "c"], ["b", "c"], ["s1", "c"], ["child1", "child2"]]) {
    const invalid = structuredClone(map);
    invalid.tree.children.push(node("s2"));
    invalid.tree.summaries.push({ key: "s2", topics });
    assert.throws(() => parseDocument(JSON.stringify(invalid)), /Invalid summary/, topics.join(","));
  }
  const nestedTitle = structuredClone(map);
  findNode(nestedTitle.tree, "s1").children.push(node("s2"));
  nestedTitle.tree.summaries.push({ key: "s2", topics: ["c", "d"] });
  assert.throws(() => parseDocument(JSON.stringify(nestedTitle)), /Invalid summary/);
  const ownChild = structuredClone(map);
  ownChild.tree.summaries[0].topics = ["child1"];
  assert.throws(() => parseDocument(JSON.stringify(ownChild)), /Invalid summary/);
});

test("opening rejects summaries that overlap after filling gaps or cross root sides", () => {
  const map = { format: "mini-mindmap", version: 2, type: "map", tree: {
    ...node("root", [node("a"), node("b"), node("c"), node("s1"), node("s2")]),
    summaries: [{ key: "s1", topics: ["a", "c"] }, { key: "s2", topics: ["b"] }],
  } };
  assert.throws(() => parseDocument(JSON.stringify(map)), /Invalid summary/);
  map.tree.summaries = [{ key: "s1", topics: ["a", "c"] }];
  assert.doesNotThrow(() => parseDocument(JSON.stringify(map)));
  map.tree.children[0].side = "left";
  map.tree.children[2].side = "right";
  assert.throws(() => parseDocument(JSON.stringify(map)), /Invalid summary/);
});

test("summary creation fills intervening topics and removes redundant descendants", () => {
  const map = { tree: node("root", [node("p", [node("a"), node("b")]), node("q", [node("c"), node("d")])]) };
  assert.deepEqual(prepareSummaryTopics(map, ["a", "d"]), ["a", "b", "c", "d"]);
  assert.deepEqual(createSummary(map, ["a", "d"], "s", "Summary").tree.summaries[0].topics, ["a", "b", "c", "d"]);
  assert.deepEqual(prepareSummaryTopics(map, ["p", "a", "q"]), ["p", "q"]);
  assert.equal(prepareSummaryTopics(map, ["p", "a"]), null);
  assert.equal(createSummary(map, ["p", "a"], "invalid", "Summary"), map);
  const plain = { tree: node("root", [node("a"), node("b"), node("c")]) };
  const grouped = createSummary(plain, ["a", "c"], "s", "Summary");
  assert.deepEqual(grouped.tree.summaries[0].topics, ["a", "b", "c"]);
  const remaining = removeMapTopics(grouped, new Set(["a", "c"]));
  assert.deepEqual(remaining.tree.summaries[0].topics, ["b"]);
  assert.ok(findNode(remaining.tree, "s"));
  assert.equal(findNode(removeMapTopics(remaining, new Set(["b"])).tree, "s"), null);
});

test("summary creation does not cross opposite sides of a root", () => {
  const left = { ...node("left"), side: "left" }, right = { ...node("right"), side: "right" };
  const anotherLeft = { ...node("left2"), side: "left" };
  const map = { tree: node("root", [left, right, anotherLeft]) };
  assert.equal(prepareSummaryTopics(map, ["left", "right"]), null);
  assert.equal(createSummary(map, ["left", "right"], "s", "Summary"), map);
  assert.deepEqual(prepareSummaryTopics(map, ["left", "left2"]), ["left", "left2"]);
  assert.deepEqual(prepareSummaryTopics({ tree: { ...map.tree, layout: "logic" } }, ["left", "right"]), ["left", "right"]);
  const floating = { tree: node("root"), floatingTopics: [{ x: 0, y: 0, tree: node("free", [left, right]) }] };
  assert.equal(prepareSummaryTopics(floating, ["left", "right"]), null);
});

test("moving topics cannot introduce conflicting summaries or opposite-side ranges", () => {
  let map = { tree: node("root", [node("a"), node("b"), node("c"), node("d")]) };
  map = createSummary(map, ["a", "b"], "s1", "One");
  map = createSummary(map, ["c", "d"], "s2", "Two");
  let blocked = false;
  const intoA = { kind: "attach", key: "a", position: "inside", side: null, layout: "mindmap" };
  assert.equal(moveMapTopics(map, ["c"], intoA, undefined, () => { blocked = true; }), map);
  assert.equal(blocked, true);
  const intoGap = { kind: "attach", key: "b", position: "before", side: null, layout: "mindmap" };
  assert.equal(moveMapTopics(map, ["d"], intoGap), map);
  blocked = false;
  assert.equal(moveMapTopics(map, ["c", "d"], intoA, undefined, () => { blocked = true; }), map);
  assert.equal(blocked, true);
  map = { ...map, tree: updateNode(map.tree, "s1", (topic) => ({ ...topic, children: [...topic.children, node("child")] })) };
  blocked = false;
  assert.equal(moveMapTopics(map, ["c"], { ...intoA, key: "child" }, undefined, () => { blocked = true; }), map);
  assert.equal(blocked, true);
  const toLeft = { kind: "attach", key: "root", position: "inside", side: "left", layout: "mindmap" };
  assert.equal(moveMapTopics(map, ["a"], toLeft), map);
  assert.deepEqual(map.tree.summaries.map((summary) => summary.topics), [["a", "b"], ["c", "d"]]);
});

test("moving a topic into a summarized gap includes it in the same transaction", () => {
  let map = { tree: node("root", [node("a"), node("b"), node("c")]) };
  map = createSummary(map, ["a", "b"], "s", "Summary");
  const moved = moveMapTopics(map, ["c"], { kind: "attach", key: "b", position: "before", side: null, layout: "mindmap" });
  assert.notEqual(moved, map);
  assert.deepEqual(moved.tree.summaries[0].topics, ["a", "c", "b"]);
  assert.deepEqual(map.tree.summaries[0].topics, ["a", "b"]);
  const nested = moveMapTopics(map, ["c"], { kind: "attach", key: "a", position: "inside", side: null, layout: "mindmap" });
  assert.notEqual(nested, map);
  assert.deepEqual(nested.tree.summaries[0].topics, ["a", "b"]);
});

test("deleting the last members deletes their summary, children, and connections", () => {
  let map = { tree: node("root", [node("a"), node("b"), node("target")]) };
  map = createSummary(map, ["a", "b"], "s1", "One");
  map = { ...map, tree: updateNode(map.tree, "s1", (topic) => ({ ...topic, children: [...topic.children, node("child")] })) };
  map.tree.relations = [{ relKey: "r", from: "child", to: "target", label: "" }];
  const partial = removeMapTopics(map, new Set(["a"]));
  assert.ok(findNode(partial.tree, "s1"));
  const next = removeMapTopics(map, new Set(["a", "b"]));
  assert.deepEqual(next.tree.summaries, []);
  assert.equal(findNode(next.tree, "s1"), null);
  assert.equal(findNode(next.tree, "child"), null);
  assert.deepEqual(next.tree.relations, []);
  assert.ok(findNode(map.tree, "s1"));
  assert.equal(map.tree.summaries.length, 1);
});

test("repeated moves preserve summary invariants and immutable undo snapshots", () => {
  const keys = ["a", "b", "c", "d", "e", "f", "g", "h"];
  let map = { tree: node("root", keys.map((key) => node(key))) };
  map = createSummary(map, ["a", "b"], "s1", "One");
  map = createSummary(map, ["e", "f"], "s2", "Two");
  let seed = 12345, changed = 0, rejected = 0;
  const random = (max) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max; };
  for (let i = 0; i < 160; i++) {
    const source = keys[random(keys.length)], target = ["root", ...keys][random(keys.length + 1)];
    const drop = { kind: "attach", key: target, position: "inside", side: random(2) ? "left" : "right", layout: "mindmap" };
    const snapshot = JSON.stringify(map);
    const next = moveMapTopics(map, [source], drop);
    assert.equal(JSON.stringify(map), snapshot);
    if (next === map) rejected++; else changed++;
    assert.equal(settleSummaries(next), next);
    assert.equal(hasSummaryConflict(next), false);
    assert.equal(parseDocument(JSON.stringify({ format: "mini-mindmap", version: 2, type: "map", ...next })).type, "map");
    if (i % 10 === 0) {
      const deleted = removeMapTopics(next, new Set([keys[random(keys.length)]]));
      assert.equal(hasSummaryConflict(deleted), false);
      assert.equal(parseDocument(JSON.stringify({ format: "mini-mindmap", version: 2, type: "map", ...deleted })).type, "map");
    }
    map = next;
  }
  assert.ok(changed > 0 && rejected > 0);
});

test("every member-deletion combination leaves valid separate summaries", () => {
  const keys = ["a", "b", "c", "d", "e"];
  let map = { tree: node("root", keys.map((key) => node(key))) };
  map = createSummary(map, ["a", "c"], "first", "First");
  map = createSummary(map, ["d", "e"], "separate", "Separate");
  const snapshot = JSON.stringify(map);
  for (let mask = 0; mask < 1 << keys.length; mask++) {
    const removed = new Set(keys.filter((_, i) => mask & (1 << i)));
    const next = removeMapTopics(map, removed);
    assert.equal(JSON.stringify(map), snapshot);
    assert.equal(hasSummaryConflict(next), false);
    for (const summary of next.tree.summaries || []) {
      assert.ok(summary.topics.length);
      assert.ok(treeForKey(next, summary.key));
      assert.ok(summary.topics.every((key) => !!treeForKey(next, key)));
    }
    assert.equal(parseDocument(JSON.stringify({ format: "mini-mindmap", version: 2, type: "map", ...next })).type, "map");
  }
});

test("nested and overlapping summaries cannot be created, but separate summaries can", () => {
  const map = createSummary({ tree: node("root", [node("a", [node("a1"), node("a2")]), node("b"), node("c"), node("d")]) }, ["a", "b"], "s", "Summary");
  findNode(map.tree, "s").children.push(node("child1"), node("child2"));
  for (const topics of [["a", "b"], ["a1", "a2"], ["a", "b", "c"], ["b", "c"], ["a1", "c"], ["s", "c"], ["child1", "child2"]]) {
    assert.equal(prepareSummaryTopics(map, topics), null, topics.join(","));
    assert.equal(createSummary(map, topics, "invalid", "Invalid"), map);
  }
  assert.notEqual(createSummary(map, ["c", "d"], "separate", "Separate"), map);
  assert.equal(prepareSummaryTopics(example(), ["a", "b"]), null);
  const middle = createSummary({ tree: node("root", [node("a"), node("b"), node("c"), node("d")]) }, ["b", "c"], "s", "Summary");
  assert.equal(prepareSummaryTopics(middle, ["a", "d"]), null);
});

test("summary titles cannot be moved alone or as part of a selection", () => {
  const map = createSummary({ tree: node("root", [node("a"), node("b"), node("target")]) }, ["a", "b"], "s", "Summary");
  const attach = { kind: "attach", key: "target", position: "inside", side: null, layout: "mindmap" };
  const float = { kind: "float", positions: new Map([["s", { x: 30, y: 40 }], ["a", { x: 80, y: 40 }]]) };
  assert.equal(moveMapTopics(map, ["s"], attach), map);
  assert.equal(moveMapTopics(map, ["s"], float), map);
  assert.equal(moveMapTopics(map, ["a", "s"], float), map);
  assert.notEqual(moveMapTopics(map, ["a"], attach), map);
  assert.deepEqual(map.tree.summaries, [{ key: "s", topics: ["a", "b"] }]);
});

test("summary is a sibling of the shallowest selected topic and its node data survives", async () => {
  const tree = node("root", [node("branch", [node("deep")]), node("shallow")]);
  const map = createSummary({ format: "mini-mindmap", version: 2, type: "map", tree }, ["deep", "shallow"], "s", "Summary");
  assert.equal(nodeDepth(map, "s"), nodeDepth(map, "shallow"));
  const summary = map.tree.children.find((item) => item.key === "s");
  summary.children.push(node("child"));
  summary.textStyle = { bold: true, color: "#123456" };
  summary.image = { src: "data:image/png;base64,AAAA" };
  const reopened = parseDocument(await readArchive(await createArchive(JSON.stringify(map))));
  assert.deepEqual(reopened.tree.children.find((item) => item.key === "s"), summary);
  assert.match(toMarkdown(reopened.tree), /child/);
});

test("deleting one branch preserves an unselected summary subtree and its connections", () => {
  const tree = node("root", [node("p", [node("a")]), node("q", [node("b")])]);
  const map = createSummary({ tree }, ["a", "b"], "s", "Summary");
  const summary = map.tree.children[0].children.find((item) => item.key === "s");
  summary.children.push(node("child"));
  map.tree.relations = [{ relKey: "r", from: "child", to: "b", label: "" }];
  const next = removeMapTopics(map, new Set(["p"]));
  assert.deepEqual(next.tree.summaries, [{ key: "s", topics: ["b"] }]);
  assert.equal(findNode(treeForKey(next, "s"), "s").children[0].key, "child");
  assert.equal(next.tree.relations[0].from, "child");
  assert.equal(nodeDepth(next, "s"), nodeDepth(next, "b"));
  assert.equal(parseDocument(JSON.stringify({ format: "mini-mindmap", version: 2, type: "map", ...next })).type, "map");
});

test("moving all grouped topics deeper keeps the summary at the shallowest level", () => {
  const map = createSummary({ tree: node("root", [node("a"), node("b"), node("target")]) }, ["a", "b"], "s", "Summary");
  const moved = moveMapTopics(map, ["a", "b"], { kind: "attach", key: "target", position: "inside", side: null, layout: "mindmap" });
  assert.equal(nodeDepth(moved, "s"), nodeDepth(moved, "a"));
  assert.equal(findNode(moved.tree, "target").children.some((item) => item.key === "s"), true);
  assert.deepEqual(moved.tree.summaries[0].topics, ["a", "b"]);
});

test("moving a grouped image into its summary preserves the remaining group and the image", async () => {
  const map = createSummary({ format: "mini-mindmap", version: 2, type: "map", tree: node("root", [node("a"), node("b")]) }, ["a", "b"], "s", "Summary");
  map.tree.children.find((item) => item.key === "a").image = { src: "data:image/png;base64,AAAA" };
  findNode(map.tree, "s").textStyle = { bold: true, color: "#123456" };
  const next = moveMapTopics(map, ["a"], { kind: "attach", key: "s", position: "inside", side: null, layout: "mindmap" });
  assert.deepEqual(next.tree.summaries, [{ key: "s", topics: ["b"] }]);
  assert.equal(findNode(next.tree, "s").children[0].image.src, "data:image/png;base64,AAAA");
  assert.deepEqual(findNode(next.tree, "s").textStyle, { bold: true, color: "#123456" });
  assert.deepEqual(parseDocument(await readArchive(await createArchive(JSON.stringify(next)))), next);
  assert.deepEqual(map.tree.summaries[0].topics, ["a", "b"]);
});

test("moving the last grouped topic into its own summary is rejected without changing the map", () => {
  const map = createSummary({ tree: node("root", [node("a"), node("b")]) }, ["a", "b"], "s", "Summary");
  let blocked = false;
  const next = moveMapTopics(map, ["a", "b"], { kind: "attach", key: "s", position: "inside", side: null, layout: "mindmap" }, () => { blocked = true; });
  assert.equal(next, map);
  assert.equal(blocked, true);
});

test("moving an unrelated image into a summary leaves its membership unchanged", () => {
  const map = createSummary({ tree: node("root", [node("a"), node("b"), node("c")]) }, ["a", "b"], "s", "Summary");
  findNode(map.tree, "c").image = { src: "data:image/png;base64,AAAA" };
  const next = moveMapTopics(map, ["c"], { kind: "attach", key: "s", position: "inside", side: null, layout: "mindmap" });
  assert.deepEqual(next.tree.summaries, [{ key: "s", topics: ["a", "b"] }]);
  assert.equal(findNode(next.tree, "s").children[0].image.src, "data:image/png;base64,AAAA");
});

test("moving a grouped topic between branches or onto the canvas preserves the member IDs", () => {
  const map = createSummary({ tree: node("root", [node("a"), node("b"), node("target")]) }, ["a", "b"], "s", "Summary");
  const attached = moveMapTopics(map, ["a"], { kind: "attach", key: "target", position: "inside", side: null, layout: "mindmap" });
  const detached = moveMapTopics(attached, ["b"], { kind: "float", positions: new Map([["b", { x: 50, y: 60 }]]) });
  assert.deepEqual(detached.tree.summaries[0].topics, ["a", "b"]);
  assert.equal(nodeDepth(detached, "s"), nodeDepth(detached, "b"));
});

test("deleting a shallow member preserves a summary subtree when alignment would exceed depth 100", () => {
  let deep = node("deep");
  for (let i = 98; i >= 0; i--) deep = node(`level${i}`, [deep]);
  const map = { tree: { ...node("root", [node("shallow"), deep, node("s", [node("s-child")])]), summaries: [{ key: "s", topics: ["shallow", "deep"] }] } };
  const next = removeMapTopics(map, new Set(["shallow"]));
  assert.equal(findNode(next.tree, "shallow"), null);
  assert.equal(nodeDepth(next, "s"), 1);
  assert.equal(nodeDepth(next, "s-child"), 2);
  assert.deepEqual(next.tree.summaries[0].topics, ["deep"]);
});

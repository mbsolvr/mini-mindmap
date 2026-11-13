import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createArchive, readArchive } from "../src/archive.ts";
import { moveNode, parseDocument, updateNode } from "../src/model.ts";

const cycles = Number(process.env.MINIMAP_STRESS_CYCLES || 200);
if (!Number.isSafeInteger(cycles) || cycles < 1 || cycles > 10000) throw new Error("MINIMAP_STRESS_CYCLES must be between 1 and 10000");
const node = (key, children = []) => ({ key, text: `Topic ${key} 中文`, children });
let tree = node("root", Array.from({ length: 500 }, (_, i) => node(`p${i}`, Array.from({ length: 3 }, (_, j) => node(`n${i}-${j}`)))));
tree.relations = [{ relKey: "r1", from: "p0", to: "p1", label: "reference" }];
const started = performance.now();
for (let i = 0; i < cycles; i++) {
  const key = `n${i % 500}-0`, destination = `p${(i + 1) % 500}`;
  tree = updateNode(tree, key, current => ({ ...current, text: `Revision ${i} 测试` }));
  tree = moveNode(tree, key, destination, "inside");
  const expected = { format: "mini-mindmap", version: 2, type: "map", tree };
  const restored = parseDocument(await readArchive(await createArchive(JSON.stringify(expected))));
  assert.deepEqual(restored, expected);
  tree = restored.tree;
}
console.log(`PASS: ${cycles} edit/move/save/open cycles, 2001 nodes, ${((performance.now() - started) / 1000).toFixed(1)}s, RSS ${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MiB`);

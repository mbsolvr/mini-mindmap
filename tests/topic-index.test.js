import { test } from "node:test";
import assert from "node:assert/strict";
import { treeIndex, treeOwners } from "../src/topicIndex.ts";
import { verticalIndex } from "../src/selection.ts";

test("immutable tree indexes cache lookups and invalidate changed trees and floating roots", () => {
  const child = { key: "a", children: [] }, root = { key: "r", children: [child] };
  const first = treeIndex(root);
  assert.equal(treeIndex(root), first);
  assert.equal(first.get("a").depth, 1);
  assert.equal(first.get("a").parent, "r");
  assert.equal(first.get("r").height, 1);
  const changed = { ...root, children: [] };
  assert.equal(treeIndex(changed).has("a"), false);
  assert.equal(treeIndex(root).has("a"), true);
  const map = { tree: root };
  assert.equal(treeOwners(map).get("a"), root);
  const floating = { key: "f", children: [] };
  assert.equal(treeOwners({ ...map, floatingTopics: [{ tree: floating }] }).get("f"), floating);
  assert.equal(treeOwners(map).has("f"), false);
});

test("summary collision candidates match a complete scan", () => {
  const items = Array.from({ length: 5000 }, (_, i) => ({ top: i * 5, bottom: i * 5 + (i % 11) * 10 + 1 }));
  const query = verticalIndex(items);
  for (let top = -10; top < 25000; top += 347)
    assert.deepEqual(query(top, top + 40), items.filter((r) => r.bottom > top && r.top < top + 40));
});

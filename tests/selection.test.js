import { test } from "node:test";
import assert from "node:assert/strict";
import { selectionBox, intersects } from "../src/selection.ts";
test("selection rectangle works in any drag direction and selects overlapping nodes", () => {
  const rect = selectionBox(50, 80, 10, 20);
  assert.deepEqual(rect, { left: 10, top: 20, right: 50, bottom: 80 });
  assert.equal(intersects(rect, { left: 40, right: 60, top: 70, bottom: 90 }), true);
  assert.equal(intersects(rect, { left: 50, right: 60, top: 70, bottom: 90 }), false);
  assert.equal(intersects(rect, { left: 0, right: 5, top: 70, bottom: 90 }), false);
});

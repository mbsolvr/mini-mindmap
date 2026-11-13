import { test } from "node:test";
import assert from "node:assert/strict";
import { relationCurve } from "../src/relations.ts";
import { validRelationControls } from "../src/limits.ts";
import { createArchive, readArchive } from "../src/archive.ts";
import { parseDocument } from "../src/model.ts";
import { moveMapTopics } from "../src/mapMove.ts";
import { removeMapTopic } from "../src/mapOperations.ts";
import { richWorkspace } from "./samples.mjs";

const near = (actual, expected, message) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-7,
    `${message}: ${actual} != ${expected}`,
  );
function randomFrom(seed) {
  return (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
}

for (const seed of [42, 90210, 20261109, 0xffffffff]) {
  test(`seed ${seed}: 512 curves stay finite, attach to edges, and translate consistently`, () => {
    const random = randomFrom(seed);
    const rectangle = () =>
      Object.freeze({
        x: random(200000) - 100000,
        y: random(200000) - 100000,
        width: random(2000) + 1,
        height: random(2000) + 1,
      });
    const point = () =>
      Object.freeze({ x: random(200001) - 100000, y: random(200001) - 100000 });
    for (let i = 0; i < 512; i++) {
      const a = rectangle(),
        b = rectangle(),
        controls = Object.freeze({ start: point(), end: point() });
      const curve = relationCurve(a, b, controls);
      for (const value of [
        curve.start,
        curve.end,
        curve.c1,
        curve.c2,
        { x: curve.x, y: curve.y },
      ])
        assert.ok(Number.isFinite(value.x) && Number.isFinite(value.y));
      for (const [rect, endpoint] of [
        [a, curve.start],
        [b, curve.end],
      ]) {
        assert.ok(
          endpoint.x >= rect.x - 1e-7 &&
            endpoint.x <= rect.x + rect.width + 1e-7,
        );
        assert.ok(
          endpoint.y >= rect.y - 1e-7 &&
            endpoint.y <= rect.y + rect.height + 1e-7,
        );
        assert.ok(
          Math.min(
            Math.abs(endpoint.x - rect.x),
            Math.abs(endpoint.x - rect.x - rect.width),
            Math.abs(endpoint.y - rect.y),
            Math.abs(endpoint.y - rect.y - rect.height),
          ) < 1e-7,
        );
      }
      near(curve.c1.x, a.x + a.width / 2 + controls.start.x, "source handle");
      near(curve.c2.y, b.y + b.height / 2 + controls.end.y, "target handle");
      const dx = random(10000) - 5000,
        dy = random(10000) - 5000;
      const translated = relationCurve(
        { ...a, x: a.x + dx, y: a.y + dy },
        { ...b, x: b.x + dx, y: b.y + dy },
        controls,
      );
      for (const key of ["start", "end", "c1", "c2"]) {
        near(translated[key].x, curve[key].x + dx, key);
        near(translated[key].y, curve[key].y + dy, key);
      }
      near(translated.x, curve.x + dx, "label x");
      near(translated.y, curve.y + dy, "label y");
      const reversed = relationCurve(b, a, {
        start: controls.end,
        end: controls.start,
      });
      assert.deepEqual(reversed.start, curve.end);
      assert.deepEqual(reversed.end, curve.start);
      near(reversed.x, curve.x, "reversed label x");
      near(reversed.y, curve.y, "reversed label y");
    }
  });
}

test("connection coordinate validation covers both endpoints and exact numeric boundaries", () => {
  const valid = { start: { x: -100000, y: 100000 }, end: { x: 0, y: -0.125 } };
  assert.equal(validRelationControls(valid), true);
  for (const end of ["start", "end"])
    for (const axis of ["x", "y"]) {
      for (const bad of [
        undefined,
        null,
        "0",
        true,
        NaN,
        Infinity,
        -Infinity,
        100000.001,
        -100000.001,
      ]) {
        assert.equal(
          validRelationControls({
            ...valid,
            [end]: { ...valid[end], [axis]: bad },
          }),
          false,
          `${end}.${axis}: ${String(bad)}`,
        );
      }
    }
  for (const bad of [
    undefined,
    null,
    [],
    {},
    "",
    { start: [], end: valid.end },
  ])
    assert.equal(validRelationControls(bad), false);
  for (const rect of [
    { x: 0, y: 0, width: 0, height: 0 },
    { x: 0, y: 0, width: 50, height: 20 },
  ]) {
    const curve = relationCurve(rect, rect, {
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
    });
    assert.ok(!/NaN|Infinity/.test(curve.d));
  }
});

test("curved connections survive repeated cross-tree moves and disappear only with an endpoint", async () => {
  const workspace = richWorkspace(),
    original = structuredClone(workspace);
  let map = workspace.tabs[0];
  map.tree.relations[0].controls = {
    start: { x: -125.5, y: -80 },
    end: { x: 44, y: -120 },
  };
  const expected = structuredClone(map.tree.relations);
  for (let i = 0; i < 60; i++) {
    const drop =
      i % 2 === 0
        ? {
            kind: "float",
            positions: new Map([["c", { x: i + 1, y: -i - 1 }]]),
          }
        : {
            kind: "attach",
            key: "b",
            position: "inside",
            side: null,
            layout: "mindmap",
          };
    map = moveMapTopics(map, ["c"], drop);
    assert.deepEqual(map.tree.relations, expected);
    const file = { ...workspace, tabs: [map, workspace.tabs[1]] };
    const restored = parseDocument(
      await readArchive(await createArchive(JSON.stringify(file))),
    );
    assert.deepEqual(restored, file);
    map = restored.tabs[0];
  }
  assert.deepEqual(
    removeMapTopic(map, "a").tree.relations,
    expected,
    "unrelated node removed a connection",
  );
  assert.deepEqual(removeMapTopic(map, "c").tree.relations, []);
  assert.deepEqual(map.tree.relations, expected);
  assert.deepEqual(workspace.tabs[1], original.tabs[1]);
});

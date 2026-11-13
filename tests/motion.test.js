import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeOffset, animateNodePositions } from "../src/motion.ts";

test("animation offsets convert screen displacement to unzoomed coordinates", () => {
  assert.deepEqual(nodeOffset({ left: 130, top: 50 }, { left: 100, top: 80 }, 2), { x: 15, y: -15 });
  assert.deepEqual(nodeOffset({ left: 10, top: 10 }, { left: 10, top: 10 }, .5), { x: 0, y: 0 });
});

test("movement animates only changed nodes and respects reduced motion", () => {
  const calls = [];
  const animation = {};
  const node = { dataset: { dropKey: "a" }, getBoundingClientRect: () => ({ left: 20, top: 10 }), animate: (...args) => { calls.push(args); return animation; } };
  const map = { querySelectorAll: () => [node] };
  const original = globalThis.window;
  try {
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    assert.deepEqual(animateNodePositions(map, new Map([["a", { left: 10, top: 10 }]]), 2), [animation]);
    assert.equal(animation.id, "node-move");
    assert.equal(calls[0][0][0].transform, "translate(-5px, 0px)");
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    assert.deepEqual(animateNodePositions(map, new Map([["a", { left: 10, top: 10 }]]), 2), []);
    assert.equal(calls.length, 1);
  } finally { globalThis.window = original; }
});

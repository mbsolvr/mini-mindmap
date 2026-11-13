import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { relationCurve } from "../src/relations.ts";

test("relation overlay mounts before the parent ref is attached", async () => {
  const file = new URL("../src/components/RelationLayer.tsx", import.meta.url);
  const source = await readFile(file, "utf8");
  const compiled = await transform(source, { loader: "tsx", format: "esm" });
  const relations = new URL("../src/relations.ts", import.meta.url).href;
  const code = compiled.code
    .replace(/import React, \{([^}]+)\} from "react";/, 'const React = globalThis.__mountTest.React; const {$1} = globalThis.__mountTest;')
    .replace('import { useT } from "../i18n.ts";', 'const useT = () => text => text;')
    .replace('import { useRelationDrag } from "../hooks/useRelationDrag.ts";', 'const useRelationDrag = () => ({ preview: null, start() {} });')
    .replace('from "../relations.ts"', `from "${relations}"`);
  const effects = [];
  let paths;
  const previous = { mock: globalThis.__mountTest, observer: globalThis.ResizeObserver, cancel: globalThis.cancelAnimationFrame };
  globalThis.__mountTest = {
    React: { createElement: () => null },
    useState: () => [[], value => { paths = value; }],
    useEffect: callback => effects.push(callback),
    useLayoutEffect: callback => callback()
  };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const { default: RelationLayer } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}#movement`);
    const ref = { current: null };
    assert.doesNotThrow(() => RelationLayer({ mapRef: ref, tree: { relations: [] }, zoom: 1 }));
    ref.current = { getBoundingClientRect: () => ({ left: 0, top: 0 }), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
    assert.equal(effects.length, 1);
    const cleanup = effects[0]();
    assert.deepEqual(paths, []);
    cleanup();
  } finally {
    globalThis.__mountTest = previous.mock;
    globalThis.ResizeObserver = previous.observer;
    globalThis.cancelAnimationFrame = previous.cancel;
  }
});

test("relation hit area exposes double-click editing and context menu", async () => {
  const source = await readFile(new URL("../src/components/RelationLayer.tsx", import.meta.url), "utf8");
  const compiled = await transform(source, { loader: "tsx", format: "esm" });
  const code = compiled.code.replace(/import React, \{([^}]+)\} from "react";/, 'const React = globalThis.__mountTest.React; const {$1} = globalThis.__mountTest;')
    .replace('import { useT } from "../i18n.ts";', 'const useT = () => text => text;')
    .replace('import { useRelationDrag } from "../hooks/useRelationDrag.ts";', 'const useRelationDrag = () => ({ preview: null, start() {} });')
    .replace('from "../relations.ts"', `from "${new URL("../src/relations.ts", import.meta.url).href}"`);
  const previous = globalThis.__mountTest;
  const calls = [];
  globalThis.__mountTest = { React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) }, useState: () => [[{ key: "r", index: 0, from: { x: 0, y: 0, width: 20, height: 20 }, to: { x: 100, y: 0, width: 20, height: 20 }, label: "" }], () => {}], useEffect() {} };
  try {
    const { default: RelationLayer } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}#events`);
    const root = RelationLayer({ mapRef: {}, tree: { relations: [{ relKey: "r" }] }, zoom: 1, selected: null, onSelect() {}, onEdit: (...args) => calls.push(["edit", ...args]), onContext: (...args) => calls.push(["context", ...args]) });
    const hit = root.children[1][0].children[1];
    const event = { clientX: 30, clientY: 40, stopPropagation() {}, preventDefault() {} };
    hit.props.onDoubleClick(event); hit.props.onContextMenu(event);
    assert.deepEqual(calls, [["edit", 0], ["context", 0, 30, 40]]);
  } finally { globalThis.__mountTest = previous; }
});

test("relation paths follow moving endpoints until the animation ends", async () => {
  const source = await readFile(new URL("../src/components/RelationLayer.tsx", import.meta.url), "utf8");
  const compiled = await transform(source, { loader: "tsx", format: "esm" });
  const code = compiled.code.replace(/import React, \{([^}]+)\} from "react";/, 'const React = globalThis.__mountTest.React; const {$1} = globalThis.__mountTest;')
    .replace('import { useT } from "../i18n.ts";', 'const useT = () => text => text;')
    .replace('import { useRelationDrag } from "../hooks/useRelationDrag.ts";', 'const useRelationDrag = () => ({ preview: null, start() {} });')
    .replace('from "../relations.ts"', `from "${new URL("../src/relations.ts", import.meta.url).href}"`);
  const previous = { mock: globalThis.__mountTest, observer: globalThis.ResizeObserver, raf: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
  const effects = []; let paths, callback, x = 100, running = true;
  const card = (key, left) => ({ dataset: { dropKey: key }, getBoundingClientRect: () => ({ left: typeof left === "function" ? left() : left, top: 0, width: 20, height: 20 }), getAnimations: () => key === "b" && running ? [{ id: "node-move", playState: "running" }] : [] });
  const cards = [card("a", 0), card("b", () => x)];
  globalThis.__mountTest = { React: { createElement: () => null }, useState: () => [[], value => { paths = value; }], useEffect: fn => effects.push(fn) };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = fn => { callback = fn; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const { default: RelationLayer } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    const map = { getBoundingClientRect: () => ({ left: 0, top: 0 }), querySelectorAll: () => cards, addEventListener() {}, removeEventListener() {} };
    RelationLayer({ mapRef: { current: map }, tree: { relations: [{ from: "a", to: "b" }] }, zoom: 1 });
    const cleanup = effects[0]();
    assert.match(relationCurve(paths[0].from, paths[0].to).d, /100,10$/);
    x = 150; running = false; callback();
    assert.match(relationCurve(paths[0].from, paths[0].to).d, /150,10$/);
    cleanup();
  } finally { globalThis.__mountTest = previous.mock; globalThis.ResizeObserver = previous.observer; globalThis.requestAnimationFrame = previous.raf; globalThis.cancelAnimationFrame = previous.cancel; }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { hookRuntime, loadHook } from "./helpers/hooks.mjs";

for (const height of [200, 1400]) {
  test(`zoom keeps the canvas center fixed for a ${height}px map, including batched gestures`, async () => {
    const runtime = hookRuntime();
    const { useCanvas } = await loadHook(new URL('../src/hooks/useCanvas.ts', import.meta.url), runtime.hooks);
    const viewKey = {}, viewport = { left: 40, top: 80, width: 800, height: 600 };
    const center = { x: 440, y: 380 }, origin = { x: 245, y: 375 };
    const render = () => runtime.render(() => useCanvas({ viewKey, inputs: { current: new Map() } }), false);
    let hook = render();
    hook.setPan({ x: 25, y: -35 });
    let rendered = render();
    const previousMatrix = globalThis.DOMMatrix;
    globalThis.DOMMatrix = class { constructor() { this.e = rendered.pan.x; this.f = rendered.pan.y; } };
    rendered.canvasRef.current = { getBoundingClientRect: () => viewport };
    rendered.mapRef.current = { style: { transform: '' }, getBoundingClientRect: () => ({
      left: origin.x + rendered.pan.x,
      top: origin.y + rendered.pan.y - height * rendered.zoom / 2,
      height: height * rendered.zoom,
    }) };
    function centerPoint(view) {
      return { x: (center.x - origin.x - view.pan.x) / view.zoom,
        y: height / 2 + (center.y - origin.y - view.pan.y) / view.zoom };
    }
    function assertCentered(view, point) {
      assert.ok(Math.abs(origin.x + view.pan.x + point.x * view.zoom - center.x) < 1e-8);
      assert.ok(Math.abs(origin.y + view.pan.y + (point.y - height / 2) * view.zoom - center.y) < 1e-8);
    }
    try {
      const point = centerPoint(rendered);
      rendered.adjustZoom(0.1);
      rendered.adjustZoom(0.1);
      hook = render();
      assert.equal(hook.zoom, 1.2);
      assertCentered(hook, point);
      rendered = hook;
      hook.setPan(pan => ({ x: pan.x + 50, y: pan.y - 20 }));
      const pannedPoint = centerPoint(render());
      hook.adjustZoom(-0.2);
      hook = render();
      assert.equal(hook.zoom, 1);
      assertCentered(hook, pannedPoint);
      rendered = hook;
      hook.adjustZoom(-100);
      hook.adjustZoom(100);
      hook = render();
      assert.equal(hook.zoom, 2);
      assertCentered(hook, pannedPoint);
    } finally { runtime.unmount(); globalThis.DOMMatrix = previousMatrix; }
  });
}

test("canvas distinguishes blank clicks from marquee selection", async () => {
  const source = await readFile(new URL("../src/hooks/useCanvas.ts", import.meta.url), "utf8");
  const compiled = await transform(source, { loader: "ts", format: "esm" });
  const code = compiled.code.replace(/import \{ useEffect, useRef, useState \} from "react";/, 'const { useEffect, useRef, useState } = globalThis.__canvasHookTest;')
    .replaceAll('"../selection.ts"', `"${new URL("../src/selection.ts", import.meta.url).href}"`);
  const previous = { hook: globalThis.__canvasHookTest, element: globalThis.Element, document: globalThis.document };
  globalThis.__canvasHookTest = { useEffect() {}, useRef: value => ({ current: value }), useState: initial => [initial, () => {}] };
  globalThis.Element = class {};
  globalThis.document = { activeElement: null };
  let blank = 0, chosen;
  try {
    const { useCanvas } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    const viewKey = {};
    const canvas = useCanvas({ viewKey, inputs: { current: new Map() }, finishMotion() {}, isDragging: () => false, getRootKey: () => "root", getDocument: () => viewKey, onBlank: () => blank++, onSelectMany: keys => { chosen = keys; } });
    const pointer = { button: 0, pointerId: 1, clientX: 0, clientY: 0, target: {}, currentTarget: { setPointerCapture() {} }, preventDefault() {}, type: "pointerup" };
    canvas.panStart(pointer); canvas.panEnd(pointer);
    assert.equal(blank, 1);
    const card = (key, left) => ({ dataset: { dropKey: key }, getBoundingClientRect: () => ({ left, top: 10, right: left + 10, bottom: 20 }) });
    canvas.canvasRef.current = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }) };
    canvas.mapRef.current = { querySelectorAll: () => [card("root", 10), card("selected", 20), card("outside", 80)] };
    canvas.panStart(pointer);
    canvas.panMove({ ...pointer, clientX: 50, clientY: 50 });
    canvas.panEnd(pointer);
    assert.deepEqual(chosen, ["selected"]);
    assert.equal(blank, 1);
  } finally { globalThis.__canvasHookTest = previous.hook; globalThis.Element = previous.element; globalThis.document = previous.document; }
});

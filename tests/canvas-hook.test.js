import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

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
    const canvas = useCanvas({ viewKey: {}, inputs: { current: new Map() }, finishMotion() {}, isDragging: () => false, getRootKey: () => "root", onBlank: () => blank++, onSelectMany: keys => { chosen = keys; } });
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

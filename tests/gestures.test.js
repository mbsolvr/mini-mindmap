import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { hookRuntime, loadHook } from './helpers/hooks.mjs';

async function canvas(t, blur = () => {}) {
  const previous = { window: globalThis.window, document: globalThis.document, Element: globalThis.Element };
  globalThis.window = new EventTarget();
  globalThis.document = { activeElement: { blur } };
  globalThis.Element = class {};
  const runtime = hookRuntime(), viewport = Object.assign(new EventTarget(), {
    classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 }),
  });
  const { useCanvas } = await loadHook(new URL('../src/hooks/useCanvas.ts', import.meta.url), runtime.hooks);
  let doc = { tree: { key: 'root', text: '', children: [] } }, selected = 0;
  const viewKey = {};
  const render = (effects = true) => runtime.render(() => useCanvas({ viewKey, inputs: { current: new Map() },
    finishMotion() {}, isDragging: () => false, getRootKey: () => 'root', getDocument: () => doc,
    onSelectMany() { selected++; }, onBlank() {} }), effects);
  const hook = render(false);
  hook.canvasRef.current = viewport;
  runtime.flushEffects();
  const pointer = { pointerId: 1, button: 0, clientX: 10, clientY: 10, target: {},
    currentTarget: { setPointerCapture() {} }, preventDefault() {} };
  function begin() { hook.panStart(pointer); hook.panMove({ ...pointer, clientX: 100, clientY: 100 }); }
  t.after(() => { runtime.unmount(); Object.assign(globalThis, previous); });
  return { hook, render, begin, pointer, get selected() { return selected; }, revise() { doc = { ...doc }; } };
}

test('a gesture records the document after blur commits a pending rename', async t => {
  let h;
  h = await canvas(t, () => h.revise());
  h.begin();
  assert.ok(h.render().marquee);
  h.revise(); h.render();
  assert.equal(h.render().marquee, null);
  assert.equal(h.hook.panRef.current, null);
});

for (const reason of ['blur', 'zoom', 'lostpointercapture', 'pointercancel', 'wheel']) {
  test(`${reason} cancels marquee selection without committing stale coordinates`, async t => {
    const h = await canvas(t);
    h.begin();
    assert.ok(h.render().marquee);
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    else if (reason === 'zoom') h.hook.setZoom(1.1);
    else if (reason === 'wheel') h.hook.canvasRef.current.dispatchEvent(Object.assign(new Event('wheel'), { deltaMode: 0, deltaX: 0, deltaY: 0 }));
    else h.hook.panEnd({ ...h.pointer, type: reason });
    assert.equal(h.hook.panRef.current, null);
    assert.equal(h.render().marquee, null);
    h.hook.panMove({ ...h.pointer, clientX: 200, clientY: 200 });
    assert.equal(h.render().marquee, null);
    assert.equal(h.selected, 0);
  });
}

test('node dragging survives its own current revision but cancels on zoom, blur and wheel', async t => {
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  const runtime = hookRuntime();
  runtime.hooks.useLayoutEffect = runtime.hooks.useEffect;
  const { useNodeDrag } = await loadHook(new URL('../src/hooks/useNodeDrag.ts', import.meta.url), runtime.hooks);
  const map = { tree: { key: 'root', children: [] } }, workspaceRef = { current: { active: 0, tabs: [map] } };
  let zoom = 1;
  const render = () => runtime.render(() => useNodeDrag({ workspace: workspaceRef.current, workspaceRef, zoom,
    layoutBefore: { current: null }, animationsRef: { current: [] }, changeMap() { assert.fail('unexpected drop'); } }));
  const hook = render();
  t.after(() => { runtime.unmount(); globalThis.window = previous; });
  hook.dragRef.current = { map, zoom };
  render();
  assert.ok(hook.dragRef.current);
  zoom = 1.1; render();
  assert.equal(hook.dragRef.current, null);
  for (const name of ['blur', 'wheel']) {
    hook.dragRef.current = { map, zoom };
    window.dispatchEvent(new Event(name));
    assert.equal(hook.dragRef.current, null);
  }
});

test('floating notes reject stale moves and drops before a document revision renders', async t => {
  const previous = { window: globalThis.window, document: globalThis.document, Element: globalThis.Element };
  globalThis.window = new EventTarget();
  globalThis.document = { activeElement: null };
  globalThis.Element = class {};
  const runtime = hookRuntime();
  runtime.hooks.useLayoutEffect = runtime.hooks.useEffect;
  globalThis.__floatingTest = { ...runtime.hooks,
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) } };
  t.after(() => { runtime.unmount(); Object.assign(globalThis, previous); delete globalThis.__floatingTest; });
  const source = await readFile(new URL('../src/components/FloatingLayer.tsx', import.meta.url), 'utf8');
  const compiled = await transform(source, { loader: 'tsx', format: 'esm' });
  const code = compiled.code
    .replace(/import React, \{([^}]+)\} from "react";/, 'const { React, $1 } = globalThis.__floatingTest;')
    .replace('import MindNode from "./MindNode.tsx";', 'const MindNode = () => null;')
    .replace('import { useT } from "../i18n.ts";', 'const useT = () => text => text;')
    .replace('"../textStyle.ts"', JSON.stringify(new URL('../src/textStyle.ts', import.meta.url).href));
  const { default: FloatingLayer } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  let doc = {}, commits = 0;
  const layer = FloatingLayer({ topics: [], notes: [{ key: 'note', x: 10, y: 20 }], zoom: 1,
    getDocument: () => doc, node: {}, onNoteFocus() {}, onMove() { commits++; } });
  const item = layer.props.children[1][0];
  const element = runtime.render(() => item.type(item.props)), handlers = element.props;
  const dom = { style: { left: '10px', top: '20px' }, focus() {}, setPointerCapture() {} };
  handlers.ref.current = dom;
  const pointer = { button: 0, pointerId: 1, clientX: 0, clientY: 0, target: {}, currentTarget: dom,
    preventDefault() {}, stopPropagation() {} };
  for (const event of ['onPointerMove', 'onPointerUp']) {
    handlers.onPointerDown(pointer);
    handlers.onPointerMove({ ...pointer, clientX: 20 });
    assert.equal(dom.style.left, '30px');
    doc = {};
    handlers[event]({ ...pointer, clientX: 40 });
    assert.equal(commits, 0, 'a stale drop must not enter the new document history');
    assert.equal(dom.style.left, '10px', 'a stale gesture must restore its preview');
    handlers.onPointerUp(pointer);
  }
});

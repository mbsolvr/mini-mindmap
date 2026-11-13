import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { tabWithTree } from '../src/model.ts';

test('closing a tab uses its stable identity after edits and keeps the active document when reordered', async () => {
  const source = await readFile(new URL('../src/hooks/useTabs.ts', import.meta.url), 'utf8');
  const compiled = await transform(source, { loader: 'ts', format: 'esm' });
  const code = compiled.code.replace('import { useState } from "react";', 'const useState = globalThis.__tabsHookTest;').replaceAll('"../model.ts"', `"${new URL('../src/model.ts', import.meta.url).href}"`);
  let closeKey = null, selection = null;
  const original = { hook: globalThis.__tabsHookTest, frame: globalThis.requestAnimationFrame, document: globalThis.document, element: globalThis.HTMLElement };
  globalThis.__tabsHookTest = () => [closeKey, value => { closeKey = value; }];
  globalThis.requestAnimationFrame = fn => fn();
  globalThis.document = { activeElement: null };
  globalThis.HTMLElement = class {};
  try {
    const { useTabs } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const tab = text => ({ tree: { key: text, text, children: [] } });
    const first = tab('first'), second = tab('second'), third = tab('third');
    const workspaceRef = { current: { active: 1, tabs: [first, second, third] } };
    const render = () => useTabs({ workspace: workspaceRef.current, workspaceRef, commit: next => { workspaceRef.current = next; return true; }, selectOne: key => { selection = key; }, setFocusTarget() {}, cancelRelation() {}, t: text => text });
    render().reorderTab(0, 3);
    assert.deepEqual(workspaceRef.current.tabs, [second, third, first]);
    assert.equal(workspaceRef.current.active, 0);
    render().closeTab(0);
    workspaceRef.current.tabs[0] = tabWithTree(second, { ...second.tree, text: 'edited while confirming' });
    const hook = render();
    assert.equal(hook.closeTarget.tree.text, 'edited while confirming');
    hook.confirmCloseTab();
    assert.deepEqual(workspaceRef.current.tabs, [third, first]);
    assert.equal(selection, 'third');
  } finally {
    globalThis.__tabsHookTest = original.hook;
    globalThis.requestAnimationFrame = original.frame;
    globalThis.document = original.document;
    globalThis.HTMLElement = original.element;
  }
});

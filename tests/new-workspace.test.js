import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookRuntime, loadHook, deferred } from './helpers/hooks.mjs';
import { sameSnapshot } from '../src/model.ts';
import { richWorkspace } from './samples.mjs';

async function setup(t, config = {}) {
  const previous = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement };
  const runtime = hookRuntime(), workspace = richWorkspace();
  let savedWorkspace = workspace;
  const workspaceRef = { current: workspace }, savedRef = { current: true };
  const pathRef = { current: '/tmp/original.minimap' }, dirtyRef = { current: !!config.dirty }, openingRef = { current: false };
  const historyRef = { current: [workspace] }, redoRef = { current: [workspace] };
  const calls = [], prompts = [], errors = [], marked = [], selected = [];
  globalThis.document = { activeElement: null };
  globalThis.HTMLElement = class {};
  globalThis.window = { localStorage: { getItem: () => 'false' }, __TAURI__: { core: { invoke: async (command, args) => {
    calls.push(command);
    return config.invoke?.(command, args);
  } } } };
  const { useDocumentFile } = await loadHook(new URL('../src/hooks/useDocumentFile.ts', import.meta.url), runtime.hooks, {
    'import { flushSync } from "react-dom";': 'const flushSync = fn => fn();',
    'import { useRecovery } from "./useRecovery.ts";': 'const useRecovery = () => ({ flush: () => window.__TAURI__.core.invoke("clear_recovery") });',
  });
  const options = { workspace, workspaceRef, savedRef, pathRef, dirtyRef, openingRef, historyRef, redoRef,
    markTabsSaved: value => { savedWorkspace = value; marked.push(value); }, onOpened: key => selected.push(key),
    updateDirty() { dirtyRef.current = !savedRef.current || !sameSnapshot(workspaceRef.current, savedWorkspace); },
    setWorkspace() {}, setStatus() {}, setError: error => { if (error) errors.push(error); },
    confirm: async prompt => { prompts.push(prompt); return config.confirm ? config.confirm(prompt) : true; },
  };
  const hook = runtime.render(() => useDocumentFile(options), false);
  t.after(() => { runtime.unmount(); Object.assign(globalThis, previous); });
  function unchanged() {
    assert.equal(workspaceRef.current, workspace);
    assert.equal(pathRef.current, '/tmp/original.minimap');
    assert.equal(savedRef.current, true);
    assert.deepEqual(historyRef.current, [workspace]);
    assert.deepEqual(redoRef.current, [workspace]);
    assert.deepEqual(marked, []);
    assert.deepEqual(selected, []);
    assert.equal(openingRef.current, false);
    assert.equal(hook.busyRef.current, false);
  }
  return { hook, options, workspace, workspaceRef, savedRef, pathRef, dirtyRef, openingRef, historyRef, redoRef, calls, prompts, errors, marked, selected, unchanged };
}

test('new workspace replaces all tabs, clears file/history/recovery and establishes a clean baseline', async t => {
  const h = await setup(t, { dirty: true });
  h.hook.pausedRef.current = true;
  await h.hook.newWorkspace('中心主题');
  const next = h.workspaceRef.current;
  assert.equal(next.tabs.length, 1);
  assert.equal(next.active, 0);
  assert.equal(next.tabs[0].tree.text, '中心主题');
  assert.deepEqual(next.tabs[0].tree.children, []);
  assert.notEqual(next.tabs[0].tree.key, h.workspace.tabs[0].tree.key);
  assert.equal(h.pathRef.current, '');
  assert.equal(h.savedRef.current, true);
  assert.equal(h.dirtyRef.current, false);
  assert.equal(h.hook.pausedRef.current, false);
  assert.deepEqual(h.historyRef.current, []);
  assert.deepEqual(h.redoRef.current, []);
  assert.deepEqual(h.marked, [next]);
  assert.deepEqual(h.selected, [next.tabs[0].tree.key]);
  assert.equal(h.prompts[0].action, 'Discard and create');
  assert.deepEqual(h.calls, ['clear_target', 'clear_recovery']);
  assert.deepEqual(h.errors, []);
  assert.equal(h.openingRef.current, false);
  assert.equal(h.hook.busyRef.current, false);
});

test('cancelling a new workspace preserves unsaved work, save association, history and recovery', async t => {
  const h = await setup(t, { dirty: true, confirm: () => false });
  await h.hook.newWorkspace();
  h.unchanged();
  assert.equal(h.dirtyRef.current, true);
  assert.deepEqual(h.calls, []);
});

test('new workspace commits pending editor text before deciding whether confirmation is required', async t => {
  const h = await setup(t, { confirm: () => false });
  class Editor extends HTMLElement {
    matches() { return true; }
    blur() { h.workspace.tabs[0].tree.tabTitle = 'Pending title'; h.dirtyRef.current = true; }
  }
  document.activeElement = new Editor();
  await h.hook.newWorkspace();
  assert.equal(h.prompts.length, 1);
  assert.equal(h.workspaceRef.current.tabs[0].tree.tabTitle, 'Pending title');
  assert.deepEqual(h.calls, []);
});

test('a clean workspace resets without confirmation and subsequent Save must choose a new file', async t => {
  const h = await setup(t, { invoke: command => command === 'save_as' ? null : undefined });
  await h.hook.newWorkspace();
  assert.deepEqual(h.prompts, []);
  await h.hook.save(false);
  assert.deepEqual(h.calls, ['clear_target', 'clear_recovery', 'save_as']);
});

test('failed native reset preserves the current workspace and saved file identity', async t => {
  const h = await setup(t, { invoke: () => { throw new Error('File state is unavailable'); } });
  await h.hook.newWorkspace();
  h.unchanged();
  assert.match(h.errors[0], /Could not create workspace:.*File state is unavailable/);
  assert.deepEqual(h.calls, ['clear_target']);
});

test('new workspace blocks overlapping file commands and respects IME and busy guards', async t => {
  const decision = deferred();
  const h = await setup(t, { dirty: true, confirm: () => decision.promise });
  const pending = h.hook.newWorkspace();
  assert.equal(h.openingRef.current, true);
  await h.hook.newWorkspace(); await h.hook.save(false); await h.hook.openCopy(); await h.hook.importXmind();
  assert.deepEqual(h.calls, []);
  assert.equal(h.prompts.length, 1);
  decision.resolve(false); await pending;
  h.hook.composingRef.current = true;
  await h.hook.newWorkspace();
  h.hook.composingRef.current = false;
  h.hook.busyRef.current = true;
  await h.hook.newWorkspace();
  h.hook.busyRef.current = false;
  h.unchanged();
  assert.equal(h.prompts.length, 1);
});

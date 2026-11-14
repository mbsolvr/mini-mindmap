import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookRuntime, loadHook, deferred } from './helpers/hooks.mjs';
import { newDocument, serializeWorkspace, workspaceFromDocument } from '../src/model.ts';
import { createXmind, readXmind } from '../src/xmind.ts';

test('XMind import appends all sheets with undo, preserves file identity and blocks overlapping commands', async () => {
  const originalWindow = globalThis.window;
  const runtime = hookRuntime();
  const initial = workspaceFromDocument(newDocument('Keep unsaved content'));
  const imported = { ...initial, active: 1, tabs: [{ tree: newDocument('First').tree }, { tree: newDocument('Second').tree }] };
  const archive = await createXmind(imported), waiting = deferred();
  const calls = [], errors = [], snapshots = [];
  globalThis.window = { localStorage: { getItem: () => null }, __TAURI__: { core: { invoke: async command => { calls.push(command); return waiting.promise; } } } };
  try {
    const { useDocumentFile } = await loadHook(new URL('../src/hooks/useDocumentFile.ts', import.meta.url), runtime.hooks, {
      'import { flushSync } from "react-dom";': 'const flushSync = fn => fn();',
      'import { useRecovery } from "./useRecovery.ts";': 'const useRecovery = () => ({ flush: async () => {} });',
    });
    const workspaceRef = { current: initial }, savedRef = { current: serializeWorkspace(initial) }, pathRef = { current: '/tmp/current.minimap' }, dirtyRef = { current: false };
    let selected;
    const hook = runtime.render(() => useDocumentFile({ workspace: initial, workspaceRef, savedRef, pathRef, dirtyRef,
      openingRef: { current: false }, historyRef: { current: [] }, redoRef: { current: [] },
      setWorkspace() {}, setStatus() {}, markTabsSaved() { assert.fail('import must remain unsaved'); },
      onOpened: key => { selected = key; }, recordHistory: snapshot => snapshots.push(snapshot),
      updateDirty() { dirtyRef.current = serializeWorkspace(workspaceRef.current) !== savedRef.current; }, setError: error => { if (error) errors.push(error); } }));
    const saving = hook.importXmind();
    await hook.importXmind(); await hook.save(false); await hook.openCopy();
    assert.deepEqual(calls, ['import_xmind']);
    waiting.resolve({ contents: archive.contents });
    await saving;
    assert.equal(workspaceRef.current.tabs.length, 3);
    assert.equal(workspaceRef.current.tabs[0], initial.tabs[0]);
    assert.equal(workspaceRef.current.active, 2);
    assert.equal(selected, imported.tabs[1].tree.key);
    assert.equal(pathRef.current, '/tmp/current.minimap');
    assert.equal(savedRef.current, serializeWorkspace(initial));
    assert.equal(dirtyRef.current, true);
    assert.deepEqual(snapshots, [initial]);
    assert.deepEqual(errors, []);
  } finally { runtime.unmount(); globalThis.window = originalWindow; }
});

test('cancelled and invalid XMind imports leave contents, history and save association intact', async () => {
  const originalWindow = globalThis.window;
  const runtime = hookRuntime(), errors = [];
  let result = null;
  globalThis.window = { localStorage: { getItem: () => null }, __TAURI__: { core: { invoke: async () => result } } };
  try {
    const { useDocumentFile } = await loadHook(new URL('../src/hooks/useDocumentFile.ts', import.meta.url), runtime.hooks, {
      'import { flushSync } from "react-dom";': 'const flushSync = fn => fn();',
      'import { useRecovery } from "./useRecovery.ts";': 'const useRecovery = () => ({ flush: async () => {} });',
    });
    const workspace = workspaceFromDocument(newDocument('Keep')), workspaceRef = { current: workspace }, pathRef = { current: '/tmp/keep.minimap' }, openingRef = { current: false };
    const hook = runtime.render(() => useDocumentFile({ workspace, workspaceRef, pathRef, openingRef,
      savedRef: { current: '' }, dirtyRef: { current: true }, setWorkspace() { assert.fail('changed workspace'); },
      setStatus() {}, setError: error => { if (error) errors.push(error); }, recordHistory() { assert.fail('changed history'); } }));
    await hook.importXmind();
    result = { contents: Buffer.from('broken').toString('base64') };
    await hook.importXmind();
    assert.match(errors[0], /XMind import failed:/);
    assert.equal(workspaceRef.current, workspace);
    assert.equal(pathRef.current, '/tmp/keep.minimap');
    assert.equal(openingRef.current, false);
    assert.equal(hook.busyRef.current, false);
    hook.composingRef.current = true;
    await hook.importXmind();
    assert.equal(errors.length, 1);
  } finally { runtime.unmount(); globalThis.window = originalWindow; }
});

test('XMind export writes the whole workspace after committing the editor and honors busy/IME guards', async () => {
  const previous = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement };
  const runtime = hookRuntime(), calls = [], statuses = [], errors = [];
  const workspaceRef = { current: workspaceFromDocument(newDocument('Before blur')) };
  class Editor { blur() { workspaceRef.current.tabs[0].tree.text = 'Committed title'; } }
  globalThis.HTMLElement = Editor;
  globalThis.document = { activeElement: new Editor() };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, __TAURI__: { core: { invoke: async (command, args) => { calls.push({ command, args }); return true; } } } };
  try {
    const { useExports } = await loadHook(new URL('../src/hooks/useExports.ts', import.meta.url), runtime.hooks, {
      'import { flushSync } from "react-dom";': 'const flushSync = fn => fn();',
    });
    const busyRef = { current: false }, composingRef = { current: false };
    const hook = runtime.render(() => useExports({ workspaceRef, busyRef, composingRef,
      working: value => { busyRef.current = value; }, setEpoch() {}, setError: error => errors.push(error), setStatus: status => statuses.push(status) }));
    await hook.exportXmind();
    assert.equal(calls[0].command, 'export_file');
    assert.equal(calls[0].args.format, 'xmind');
    assert.equal((await readXmind(calls[0].args.data)).workspace.tabs[0].tree.text, 'Committed title');
    assert.deepEqual(statuses, ['XMind exported']);
    assert.deepEqual(errors, ['']);
    busyRef.current = true; await hook.exportXmind(); busyRef.current = false;
    composingRef.current = true; await hook.exportXmind();
    assert.equal(calls.length, 1);
  } finally { runtime.unmount(); Object.assign(globalThis, previous); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookRuntime, loadHook } from './helpers/hooks.mjs';
import { parseDocument, serializeWorkspace } from '../src/model.ts';
import { createArchive, readArchive } from '../src/archive.ts';
import { checkWorkspaceBudget } from '../src/parseBudget.ts';
import { createXmind } from '../src/xmind.ts';
import { wideMap } from './samples.mjs';

async function setup(t) {
  const runtime = hookRuntime(), errors = [];
  const { useWorkspace } = await loadHook(new URL('../src/hooks/useWorkspace.ts', import.meta.url), runtime.hooks);
  const hook = runtime.render(() => useWorkspace({ current: false }, () => {}, 'Root', error => errors.push(error)));
  t.after(() => runtime.unmount());
  return { hook, errors };
}

test('over-budget workspace edits are rejected before history or recovery can diverge', async t => {
  const { hook, errors } = await setup(t), original = hook.workspaceRef.current;
  const tab = wideMap(5000);
  assert.equal(hook.commit({ ...original, tabs: Array(11).fill(tab) }), false);
  assert.match(errors.at(-1), /structure/);
  assert.equal(hook.workspaceRef.current, original);
  assert.equal(hook.historyRef.current.length, 0);
  const accepted = { ...original, tabs: Array(9).fill(tab) };
  assert.equal(hook.commit(accepted), true);
  const contents = serializeWorkspace(accepted);
  assert.deepEqual(parseDocument(contents), accepted, 'recovery accepts every committed snapshot');
  assert.deepEqual(parseDocument(await readArchive(await createArchive(contents))), accepted);
});

test('larger legacy workspaces open, save and remain editable while new tabs stay capped', async t => {
  const { hook, errors } = await setup(t), tab = { tree: { key: 'root', text: 'Legacy', children: [] } };
  const legacy = { ...hook.workspaceRef.current, tabs: Array(101).fill(tab) };
  assert.deepEqual(parseDocument(await readArchive(await createArchive(serializeWorkspace(legacy)))), legacy);
  hook.workspaceRef.current = legacy;
  const edited = { ...legacy, active: 1 };
  assert.equal(hook.commit(edited), true);
  assert.equal(hook.commit({ ...edited, tabs: [...edited.tabs, tab] }), false);
  assert.match(errors.at(-1), /100 tabs/);
  assert.equal(hook.workspaceRef.current, edited);
  assert.equal(hook.commit({ ...edited, tabs: edited.tabs.slice(0, 100) }), true);
});

test('workspace budget caches immutable tabs without re-reading image payloads', () => {
  let reads = 0;
  const tab = { tree: { key: 'r', text: '', children: [], image: { get src() { reads++; return 'image'; } } } };
  checkWorkspaceBudget([tab]);
  const first = reads;
  checkWorkspaceBudget([tab, tab]);
  assert.equal(reads, first);
});

test('XMind export checks its generated format against the reader budget before writing', async () => {
  const workspace = { format: 'mini-mindmap', version: 2, type: 'workspace', active: 0,
    tabs: Array(9).fill(wideMap(5000)) };
  checkWorkspaceBudget(workspace.tabs);
  await assert.rejects(createXmind(workspace), /structure/);
});

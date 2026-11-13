import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArchive, readArchive } from '../src/archive.ts';
import { parseDocument, updateNode } from '../src/model.ts';
import { moveMapTopics } from '../src/mapMove.ts';
import { removeMapTopic } from '../src/mapOperations.ts';
import { toMarkdown } from '../src/markdown.ts';
import { validateMapLimits } from '../src/limits.ts';
import { deepMap, richWorkspace, wideMap } from './samples.mjs';

test('complex workspace survives editing, cross-tree moves and archive round trips', async () => {
  const source = richWorkspace();
  const original = structuredClone(source);
  const map = source.tabs[0];
  const moved = moveMapTopics(map, ['c'], { kind: 'attach', key: 'f', position: 'inside', side: null, layout: 'mindmap' });
  assert.equal(moved.floatingTopics[0].tree.children[0].key, 'c');
  assert.deepEqual(moved.tree.relations, map.tree.relations);
  assert.deepEqual(source, original);
  const edited = { ...source, tabs: [moved, source.tabs[1]] };
  for (let i = 0; i < 3; i++) {
    const encoded = await createArchive(JSON.stringify(edited));
    assert.deepEqual(parseDocument(await readArchive(encoded)), edited);
  }
  const md = toMarkdown(moved.tree, moved.floatingTopics, moved.floatingNotes);
  for (const text of ['中文', 'hidden', 'independent', '说明']) assert.ok(md.includes(text));
  const deleted = removeMapTopic(moved, 'f');
  assert.deepEqual(deleted.tree.relations, []);
  assert.equal(deleted.floatingTopics.length, 0);
  assert.equal(moved.tree.relations.length, 1);
});

test('supported node count and depth boundaries remain consistent', () => {
  const map = tree => JSON.stringify({ format: 'mini-mindmap', version: 2, type: 'map', ...tree });
  assert.equal(parseDocument(map(wideMap(5000))).tree.children.length, 4999);
  assert.doesNotThrow(() => parseDocument(map(deepMap(100))));
  assert.throws(() => parseDocument(map(deepMap(101))), /complex/);
  const before = wideMap(20), after = updateNode(before.tree, 'n18', node => ({ ...node, text: 'changed' }));
  assert.equal(before.tree.children[18].text, '节点 18 & <test>');
  assert.equal(after.children[18].text, 'changed');
});

test('seeded repeated moves preserve every topic, connection and saved structure', async () => {
  let map = wideMap(80);
  map.tree.relations = [{ relKey: 'rel', from: 'n0', to: 'n1', label: 'link' }];
  let seed = 90210;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  function allKeys(value) {
    const keys = [];
    function walk(node) { keys.push(node.key); node.children.forEach(walk); }
    walk(value.tree);
    (value.floatingTopics || []).forEach(topic => walk(topic.tree));
    return keys;
  }
  const expected = allKeys(map).sort();
  for (let i = 0; i < 200; i++) {
    const keys = allKeys(map), source = keys[1 + random(keys.length - 1)], target = keys[random(keys.length)];
    const drop = i % 3 === 0 ? { kind: 'float', positions: new Map([[source, { x: i, y: -i }]]) } : { kind: 'attach', key: target, position: 'inside', side: null, layout: 'mindmap' };
    map = moveMapTopics(map, [source], drop);
    assert.deepEqual(allKeys(map).sort(), expected, `lost or duplicated topic in step ${i}`);
    assert.equal(map.tree.relations[0].from, 'n0');
    assert.equal(map.tree.relations[0].to, 'n1');
    validateMapLimits(map);
    if (i % 20 === 0) {
      const doc = { format: 'mini-mindmap', version: 2, type: 'map', ...map };
      const restored = parseDocument(await readArchive(await createArchive(JSON.stringify(doc))));
      assert.deepEqual(allKeys(restored).sort(), expected);
      assert.deepEqual(restored.tree.relations, map.tree.relations);
    }
  }
});

test('the main native window grants PDF printing permission', async () => {
  const { readFile } = await import('node:fs/promises');
  const capabilities = JSON.parse(await readFile(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
  assert.ok(capabilities.windows.includes('main'));
  assert.ok(capabilities.permissions.includes('core:webview:allow-print'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeMapTopic, removeMapTopics } from '../src/mapOperations.ts';

test('deleting primary or floating branches preserves unrelated connections and the undo snapshot', () => {
  const node = (key, children = []) => ({ key, text: key, children });
  const relation = (from, to) => ({ relKey: from + to, from, to, label: '' });
  const map = { tree: { ...node('root', [node('a'), node('b')]), relations: [relation('a', 'f'), relation('b', 'root'), relation('leaf', 'b')] }, floatingTopics: [{ x: 0, y: 0, tree: node('f', [node('leaf')]) }] };
  assert.equal(removeMapTopic(map, 'root'), map);
  assert.equal(removeMapTopic(map, 'missing'), map);
  assert.deepEqual(removeMapTopic(map, 'f').tree.relations, [relation('b', 'root')]);
  assert.equal(removeMapTopic(map, 'f').floatingTopics.length, 0);
  assert.deepEqual(removeMapTopic(map, 'leaf').tree.relations, [relation('a', 'f'), relation('b', 'root')]);
  assert.deepEqual(removeMapTopic(map, 'a').tree.relations, [relation('b', 'root'), relation('leaf', 'b')]);
  assert.equal(map.tree.relations.length, 3);
  assert.equal(map.floatingTopics[0].tree.children.length, 1);
});

test('batch deletion removes selected subtrees and their connections in one change', () => {
  const node = (key, children = []) => ({ key, text: key, children });
  const relation = (from, to) => ({ relKey: from + to, from, to, label: '' });
  const map = { tree: { ...node('root', [node('a', [node('child')]), node('b')]),
    relations: [relation('child', 'f'), relation('b', 'root'), relation('leaf', 'b')] },
    floatingTopics: [{ x: 0, y: 0, tree: node('f', [node('leaf')]) }] };
  const result = removeMapTopics(map, new Set(['root', 'a', 'child', 'leaf', 'missing']));
  assert.deepEqual(result.tree.children.map(n => n.key), ['b']);
  assert.deepEqual(result.floatingTopics[0].tree.children, []);
  assert.deepEqual(result.tree.relations, [relation('b', 'root')]);
  assert.equal(map.tree.children.length, 2);
  assert.equal(removeMapTopics(map, new Set(['root', 'missing'])), map);
  assert.equal(removeMapTopics(map, new Set(['a', 'f'])).floatingTopics.length, 0);
});

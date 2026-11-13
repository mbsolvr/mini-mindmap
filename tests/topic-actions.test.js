import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTopicActions } from '../src/hooks/useTopicActions.ts';

function setup() {
  const map = { tree: { key: 'root', text: 'Root', children: [] }, floatingNotes: [{ key: 'note', text: 'Text' }] };
  const workspaceRef = { current: { active: 0, tabs: [map] } };
  const calls = [];
  const options = {
    workspaceRef, multiKeys: new Set(), zoom: 1, canvasRef: { current: null }, mapRef: { current: null },
    openingRef: { current: false }, composingRef: { current: false },
    changeTree: () => false, changeMap: () => false,
    selectOne: key => calls.push(['select', key]), setFocusTarget: key => calls.push(['focus', key]),
    setNoteFocus() {}, cancelRelation() {}, closeCanvasMenu() {}, setStatus() {},
    setError: text => calls.push(['error', text]), t: text => text,
  };
  return { map, options, calls };
}

test('rejected edits do not change selection or focus', () => {
  const { options, calls } = setup();
  const actions = useTopicActions(options);
  actions.addChild('root');
  actions.addFloating('topic', { x: 10, y: 20 });
  assert.deepEqual(calls, []);
});

test('Enter finishes editing without adding a sibling and respects IME and key repeats', () => {
  const { map, options } = setup();
  map.tree.children = [{ key: 'a', text: 'A', children: [] }];
  options.changeTree = () => { throw new Error('Confirming text must not add a topic'); };
  const actions = useTopicActions(options), calls = [];
  const card = { focus: value => calls.push(value) };
  const makeEvent = overrides => ({
    key: 'Enter', nativeEvent: {}, currentTarget: { closest: () => card },
    preventDefault() { this.prevented = true; }, ...overrides,
  });
  const plain = makeEvent();
  actions.handleKey(plain, 'a');
  assert.equal(plain.prevented, true);
  assert.deepEqual(calls, [{ preventScroll: true }]);
  for (const overrides of [
    { shiftKey: true }, { nativeEvent: { isComposing: true } },
    { nativeEvent: { keyCode: 229 } }, { repeat: true },
  ]) {
    const event = makeEvent(overrides);
    actions.handleKey(event, 'a');
    assert.equal(!!event.prevented, !!overrides.repeat);
  }
  options.composingRef.current = true;
  const composing = makeEvent();
  actions.handleKey(composing, 'a');
  assert.equal(composing.prevented, undefined);
  assert.equal(calls.length, 1);
});

test('summary topics cannot create siblings but their children and ordinary topics can', () => {
  const { map, options } = setup();
  map.tree.children = [
    { key: 'a', text: 'a', children: [] },
    { key: 'b', text: 'b', children: [] },
    { key: 'summary', text: 'Summary', children: [{ key: 'child', text: 'Child', children: [] }] },
  ];
  map.tree.summaries = [{ key: 'summary', topics: ['a', 'b'] }];
  map.floatingTopics = [{ x: 0, y: 0, tree: { key: 'floating-summary', text: '', children: [] } }];
  map.tree.summaries.push({ key: 'floating-summary', topics: ['a', 'b'] });
  const changes = [];
  options.changeTree = key => { changes.push(key); return true; };
  const actions = useTopicActions(options);
  let prevented = false;
  actions.handleKey({ key: 'Enter', nativeEvent: {}, currentTarget: { closest: () => ({ focus() {} }) }, preventDefault() { prevented = true; } }, 'summary');
  assert.equal(prevented, true);
  actions.addChild('summary', true);
  actions.addChild('floating-summary', true);
  assert.deepEqual(changes, []);
  actions.addChild('summary');
  actions.addChild('child', true);
  actions.addChild('a', true);
  assert.deepEqual(changes, ['summary', 'summary', 'root']);
  prevented = false;
  actions.handleKey({ key: 'Enter', shiftKey: true, nativeEvent: {}, preventDefault() { prevented = true; } }, 'summary');
  assert.equal(prevented, false);
});

test('note composition with unchanged text creates no new workspace content', () => {
  const { map, options } = setup();
  let patch;
  options.changeMap = update => { patch = update(map); return false; };
  const actions = useTopicActions(options);
  actions.changeNoteText('note', 'Text');
  assert.deepEqual(patch, {});
  actions.changeNoteText('missing', 'Text');
  assert.deepEqual(patch, {});
  actions.changeNoteText('note', 'New text');
  assert.equal(patch.floatingNotes[0].text, 'New text');
  assert.equal(map.floatingNotes[0].text, 'Text');
});

test('an asynchronous image paste cannot apply to a changed workspace', () => {
  const { options, calls } = setup();
  const previous = globalThis.FileReader;
  let reader;
  globalThis.FileReader = class { constructor() { reader = this; } readAsDataURL() {} };
  options.changeTree = () => { throw new Error('Stale paste must not edit a topic'); };
  try {
    const actions = useTopicActions(options);
    actions.handlePaste({ preventDefault() {}, clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => ({ size: 10 }) }] } }, 'root');
    options.workspaceRef.current = { ...options.workspaceRef.current };
    reader.result = 'data:image/png;base64,AAAA';
    reader.onload();
    assert.deepEqual(calls, [['error', 'The map changed. Please paste the image again.']]);
  } finally { globalThis.FileReader = previous; }
});

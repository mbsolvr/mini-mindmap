import { test } from "node:test";
import assert from "node:assert/strict";
import { adjacentNode, isPlainEnter, deletesImage } from "../src/keyboard.ts";
const tree = { key: "r", children: [{ key: "a", collapsed: true, children: [{ key: "hidden", children: [] }] }, { key: "b", children: [] }] };

test("plain Enter excludes modifiers and IME composition", () => {
  assert.equal(isPlainEnter({ key: "Enter" }), true);
  assert.equal(isPlainEnter({ key: "Enter", shiftKey: true }), false);
  assert.equal(isPlainEnter({ key: "Enter", nativeEvent: { isComposing: true } }), false);
  assert.equal(isPlainEnter({ key: "Enter", ctrlKey: true }), false);
});

test("keyboard navigation respects hierarchy and collapsed branches", () => {
  assert.equal(adjacentNode(tree, "r", "ArrowRight"), "a");
  assert.equal(adjacentNode(tree, "a", "ArrowLeft"), "r");
  assert.equal(adjacentNode(tree, "a", "ArrowDown"), "b");
  assert.equal(adjacentNode(tree, "b", "ArrowUp"), "a");
  assert.equal(adjacentNode(tree, "a", "ArrowRight"), null);
  assert.equal(adjacentNode(tree, "missing", "ArrowDown"), null);
});

test("backspace removes an image only at the start of the text with no selection or modifiers", () => {
  const node = { image: { src: "data" } };
  const event = { key: "Backspace", currentTarget: { value: "文字", selectionStart: 0, selectionEnd: 0 } };
  assert.equal(deletesImage(node, event), true);
  assert.equal(deletesImage(node, { ...event, ctrlKey: true }), false);
  assert.equal(deletesImage(node, { ...event, currentTarget: { ...event.currentTarget, selectionEnd: 1 } }), false);
  assert.equal(deletesImage(node, { ...event, currentTarget: { ...event.currentTarget, selectionStart: 1, selectionEnd: 1 } }), false);
  assert.equal(deletesImage(node, { ...event, key: "Delete" }), false);
  assert.equal(deletesImage(node, { ...event, key: "Delete", currentTarget: { value: "", selectionStart: 0, selectionEnd: 0 } }), true);
});

test("global shortcuts commit editing before save and preserve local rename undo", async () => {
  const { handleEditorShortcut } = await import('../src/keyboard.ts');
  const previous = { Element: globalThis.Element, HTMLElement: globalThis.HTMLElement };
  const calls = [];
  class Editor {
    matches(selector) { return selector.includes(this.kind); }
    blur() { calls.push('blur'); }
  }
  globalThis.Element = globalThis.HTMLElement = Editor;
  const commands = { save: as => calls.push(['save', as]), undo: () => calls.push('undo'), redo: () => calls.push('redo'), openMenu: name => calls.push(name) };
  const editor = new Editor(); editor.kind = '.node-text textarea';
  const event = { key: 's', ctrlKey: true, shiftKey: false, target: editor, preventDefault() { calls.push('prevent'); } };
  try {
    assert.equal(handleEditorShortcut(event, commands), true);
    assert.deepEqual(calls, ['prevent', 'blur']);
    await Promise.resolve();
    assert.deepEqual(calls, ['prevent', 'blur', ['save', false]]);
    calls.length = 0; editor.kind = '.tab-rename';
    assert.equal(handleEditorShortcut({ ...event, key: 'z' }, commands), true);
    assert.deepEqual(calls, []);
    editor.kind = '.node-text textarea';
    handleEditorShortcut({ ...event, key: 'z' }, commands);
    handleEditorShortcut({ ...event, key: 'z', shiftKey: true }, commands);
    assert.deepEqual(calls, ['prevent', 'undo', 'prevent', 'redo']);
  } finally { Object.assign(globalThis, previous); }
});

test("navigation excludes hidden summary topics and their children in every direction", () => {
  const map = { key: "r", children: [{ key: "s", children: [{ key: "child", children: [] }] }, { key: "b", children: [] }] };
  const visible = new Set(["r", "b"]);
  assert.equal(adjacentNode(map, "r", "ArrowRight", visible), "b");
  assert.equal(adjacentNode(map, "r", "ArrowDown", visible), "b");
  assert.equal(adjacentNode(map, "b", "ArrowUp", visible), "r");
  assert.equal(adjacentNode(map, "s", "ArrowDown", visible), null);
});

test("zoom shortcuts accept plus, equals and keypad keys with Ctrl or Command and reject Alt", async () => {
  const { handleEditorShortcut } = await import('../src/keyboard.ts');
  const previous = { Element: globalThis.Element, HTMLElement: globalThis.HTMLElement };
  globalThis.Element = globalThis.HTMLElement = class {};
  try {
    for (const modifier of ['ctrlKey', 'metaKey']) {
      for (const [key, code, shiftKey, step] of [
        ['+', 'Equal', true, 0.1], ['=', 'Equal', false, 0.1],
        ['+', 'NumpadAdd', false, 0.1], ['-', 'Minus', false, -0.1], ['-', 'NumpadSubtract', false, -0.1],
      ]) {
        let prevented = false, zoom;
        const event = { key, code, shiftKey, [modifier]: true, preventDefault() { prevented = true; } };
        assert.equal(handleEditorShortcut(event, { zoom: step => { zoom = step; } }), true);
        assert.equal(prevented, true);
        assert.equal(zoom, step);
      }
    }
    for (const event of [{ key: '+' }, { key: '-', ctrlKey: true, altKey: true }, { key: '_', ctrlKey: true }]) {
      assert.equal(handleEditorShortcut(event, { zoom() { assert.fail('unexpected zoom'); } }), false);
    }
  } finally { Object.assign(globalThis, previous); }
});

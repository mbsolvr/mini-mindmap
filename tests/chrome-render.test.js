import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

async function loadComponentModule(name) {
  const file = new URL(`../src/components/${name}.tsx`, import.meta.url);
  const source = await readFile(file, "utf8");
  const compiled = await transform(source, { loader: "tsx", format: "esm" });
  const code = (compiled.code.includes("import React") ? compiled.code : `import React from "react";\n${compiled.code}`).replaceAll('from "react"', `from "${import.meta.resolve("react")}"`).replace('import { useT } from "../i18n.ts";', 'const useT = () => text => text;').replace('import { MenuLabel } from "./AppMenu.tsx";', 'const MenuLabel = ({ label }) => React.createElement("span", null, label);').replaceAll('"../contextMenu.ts"', `"${new URL("../src/contextMenu.ts", import.meta.url).href}"`).replaceAll('"../textStyle.ts"', `"${new URL("../src/textStyle.ts", import.meta.url).href}"`).replaceAll('"../summaries.ts"', `"${new URL("../src/summaries.ts", import.meta.url).href}"`).replaceAll('"../keyboard.ts"', `"${new URL("../src/keyboard.ts", import.meta.url).href}"`);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
async function loadComponent(name) { return (await loadComponentModule(name)).default; }

test("PDF outline includes summaries and their topic names", async () => {
  const PrintDocument = await loadComponent("PrintDocument");
  const tree = { key: "root", text: "Root", children: [{ key: "a", text: "Alpha", children: [] }, { key: "s", text: "Group", children: [] }], summaries: [{ key: "s", topics: ["a", "f"] }] };
  const floatingTopics = [{ x: 0, y: 0, tree: { key: "f", text: "Floating", children: [] } }];
  const html = renderToStaticMarkup(React.createElement(PrintDocument, { tree, floatingTopics, date: "2026-01-01" }));
  assert.match(html, /Summaries/);
  assert.match(html, /Group: Alpha, Floating/);
});

test("top tabs render the active document, close control and new-tab control", async () => {
  const TabBar = await loadComponent("TabBar");
  const tabs = [{ tree: { text: "第一张" } }, { tree: { text: "第二张" } }];
  const html = renderToStaticMarkup(React.createElement(TabBar, { tabs, active: 1, onSelect() {}, onClose() {}, onAdd() {} }));
  assert.match(html, /tab active/);
  assert.match(html, /第二张/);
  assert.match(html, /Close tab/);
  assert.match(html, /New tab/);
  assert.match(html, /<\/div><\/div><\/div><button class="new-tab"/);
  assert.doesNotMatch(html, /tab-icon/);
});

test("double-clicking only empty tab-strip space adds a tab", async () => {
  const source = await readFile(new URL("../src/components/TabBar.tsx", import.meta.url), "utf8");
  const compiled = await transform(source, { loader: "tsx", format: "esm" });
  const code = compiled.code.replace(/import \{([^}]+)\} from "react";/, 'const React = globalThis.__tabTest.React; const {$1} = globalThis.__tabTest;').replace('import { useT } from "../i18n.ts";', 'const useT = () => text => text;')
    .replaceAll('"../keyboard.ts"', `"${new URL("../src/keyboard.ts", import.meta.url).href}"`);
  globalThis.__tabTest = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    useRef: () => ({ current: null }), useState: value => [value, () => {}], useEffect() {}, useLayoutEffect() {}
  };
  try {
    const { default: TabBar } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    let added = 0;
    const root = TabBar({ tabs: [{ tree: { text: "主题" } }], active: 0, onAdd: () => added++ });
    const strip = root.children[0].children[1].children[0];
    const empty = {};
    strip.props.onDoubleClick({ target: empty, currentTarget: empty });
    strip.props.onDoubleClick({ target: {}, currentTarget: empty });
    assert.equal(added, 1);
  } finally { delete globalThis.__tabTest; }
});

test("application menu renders actionable nested export choices", async () => {
  const AppMenu = await loadComponent("AppMenu");
  const sections = [["File", [["Export", null, [["MD", () => {}], ["SVG", () => {}], ["PNG", () => {}]]]]]];
  const html = renderToStaticMarkup(React.createElement(AppMenu, { open: true, setOpen() {}, menu: "File", setMenu() {}, sections, busy: false }));
  assert.match(html, /menu-arrow/);
  assert.doesNotMatch(html, /Alt\+F|menu-shortcut/);
  assert.match(html, /export-submenu/);
  assert.match(html, />MD<\/span>/);
  assert.match(html, />SVG<\/span>/);
  assert.match(html, />PNG<\/span>/);
});

test("menu supports a direct open action, edit shortcuts and layout choices", async () => {
  const AppMenu = await loadComponent("AppMenu");
  const sections = [["Open…", () => {}], ["Edit", [["Undo", () => {}, "Ctrl+Z"]]], ["Structure", [["Layout", null, [["✓ Mind map", () => {}], ["Logic Chart (Right)", () => {}]]]]]];
  const render = menu => renderToStaticMarkup(React.createElement(AppMenu, { open: true, setOpen() {}, menu, setMenu() {}, sections, busy: false }));
  assert.match(render("Edit"), /Open…<\/span>/);
  assert.match(render("Edit"), /class="menu-icon"/);
  assert.match(render("Edit"), /Ctrl\+Z/);
  assert.match(render("Structure"), /✓ Mind map/);
  assert.match(render("Structure"), /Logic Chart \(Right\)/);
});

test("selected layouts retain their icons", async () => {
  const AppMenu = await loadComponent("AppMenu");
  const render = (name, items) => renderToStaticMarkup(React.createElement(AppMenu, { open: true, setOpen() {}, menu: name, setMenu() {}, sections: [[name, items]], busy: false }));
  const layout = render("Structure", [["Layout", null, [["Mind map", () => {}, true]]]]);
  assert.match(layout, /class="menu-icon"[^>]*>[\s\S]*?Mind map/);
  assert.match(layout, /Mind map<\/span><\/span><span class="menu-check"[^>]*>✓/);
});

test("workspace creation and XMind exchange have distinct decorative menu icons", async () => {
  const { MenuLabel } = await loadComponentModule("AppMenu");
  const paths = ["New workspace", "Import XMind…", "Export XMind…"].map(label => {
    const html = renderToStaticMarkup(React.createElement(MenuLabel, { label }));
    assert.match(html, /class="menu-icon"[^>]*aria-hidden="true"/);
    assert.ok(html.includes(label));
    return /<path d="([^"]+)"/.exec(html)?.[1];
  });
  assert.ok(paths.every(Boolean));
  assert.equal(new Set(paths).size, 3);
});

test("topic font menu offers compact sizes and preserves an existing custom size", async () => {
  const Menu = await loadComponent("NodeContextMenu");
  const html = renderToStaticMarkup(React.createElement(Menu, { x: 0, y: 0, node: { textStyle: { size: 21 } }, onStyle() {}, onRemove() {} }));
  assert.match(html, /value="10">10 px/);
  assert.match(html, /value="13">13 px/);
  assert.match(html, /value="21" selected="">21 px/);
});

test("multi-selection menu only offers summary and delete", async () => {
  const Menu = await loadComponent("NodeContextMenu");
  const props = { x: 0, y: 0, node: {}, onStyle() {}, onRelation() {}, onSummary() {}, onRemove() {} };
  const single = renderToStaticMarkup(React.createElement(Menu, props));
  assert.match(single, /Text color/);
  assert.match(single, /Font size/);
  assert.match(single, /Create connection/);
  assert.match(single, /<button type="button" disabled=""><span>Add summary<\/span><\/button>/);
  const multiple = renderToStaticMarkup(React.createElement(Menu, { ...props, multiple: true, canAddSummary: true }));
  assert.match(multiple, /Add summary/);
  assert.match(multiple, /Delete/);
  assert.equal((multiple.match(/<button/g) || []).length, 2);
  assert.doesNotMatch(multiple, /<button type="button" disabled=""><span>Add summary/);
  assert.doesNotMatch(multiple, /Text color|Font size|Create connection|<select/);
  const invalid = renderToStaticMarkup(React.createElement(Menu, { ...props, multiple: true }));
  assert.match(invalid, /<button type="button" disabled=""><span>Add summary<\/span><\/button>/);
  assert.match(invalid, /Delete/);
  assert.equal((invalid.match(/<button/g) || []).length, 2);
  assert.doesNotMatch(invalid, /Text color|Font size|Create connection|<select/);
  const note = renderToStaticMarkup(React.createElement(Menu, { ...props, onRelation: undefined, onSummary: undefined }));
  assert.doesNotMatch(note, /Add summary/);
});

test("outline nests floating topics and notes under the root and preserves their children", async () => {
  const StructurePanel = await loadComponent("StructurePanel");
  const node = (key, children = []) => ({ key, text: key, children });
  const render = tree => renderToStaticMarkup(React.createElement(StructurePanel, {
    tree, panelRef: { current: null }, floatingTopics: [{ tree: node("Floating", [node("Nested")]) }],
    floatingNotes: [{ key: "note", text: "Note" }], onSelect() {}, onToggle() {}, onText() {}, onComposition() {}, onClose() {},
  }));
  const html = render(node("Root"));
  assert.match(html, /Root[\s\S]*<ul><li>[\s\S]*Floating[\s\S]*<ul><li>[\s\S]*Nested/);
  assert.match(html, /aria-label="Floating note"[^>]*>Note/);
  assert.match(html, /aria-label="Locate note"/);
  assert.doesNotMatch(render({ ...node("Root"), collapsed: true }), /Floating note|>Floating</);
});

test("PDF outline includes collapsed descendants, images and escaped text", async () => {
  const PrintDocument = await loadComponent("PrintDocument");
  const tree = { key: "root", text: "Root <safe>", children: [{ key: "a", text: "Section", collapsed: true, children: [{ key: "b", text: "Subtopic", children: [{ key: "c", text: "Hidden detail", image: { src: "data:image/png;base64,AAAA" }, children: [] }] }] }] };
  const html = renderToStaticMarkup(React.createElement(PrintDocument, { tree, date: "2026-01-02" }));
  assert.match(html, /Root &lt;safe&gt;/);
  assert.match(html, /4 nodes · 1 main branches/);
  assert.match(html, /Section[\s\S]*Subtopic[\s\S]*Hidden detail/);
  assert.match(html, /src="data:image\/png;base64,AAAA"/);
});

test("PDF outline limits indentation and marks every deep level", async () => {
  const PrintDocument = await loadComponent("PrintDocument");
  let node = { key: "n20", text: "Last deep topic", children: [] };
  for (let level = 19; level >= 0; level--) node = { key: `n${level}`, text: `Topic ${level}`, children: [node] };
  const html = renderToStaticMarkup(React.createElement(PrintDocument, { tree: node, date: "2026-01-02" }));
  assert.match(html, /print-grid print-single-column/);
  assert.match(html, /class="print-level">L5</);
  assert.match(html, /class="print-level">L20<\/span><span>Last deep topic/);
  assert.equal((html.match(/<ul/g) || []).length, 3);
});

test("PDF outline retains floating note formatting", async () => {
  const PrintDocument = await loadComponent("PrintDocument");
  const html = renderToStaticMarkup(React.createElement(PrintDocument, { tree: { key: "root", text: "Root", children: [] }, date: "2026-01-02", floatingNotes: [{ key: "note", x: 0, y: 0, text: "A note", textStyle: { color: "#c45850", bold: true, underline: true, size: 18 } }] }));
  assert.match(html, /color:#c45850;font-weight:bold;text-decoration:underline;font-size:18px/);
  assert.match(html, /A note/);
});

test("clicking an unselected image selects its node and opens its preview", async () => {
  const { MindNode } = await loadComponentModule("MindNode");
  const calls = [];
  const props = { node: { key: "image", text: "说明", image: { src: "data:image/png;base64,AAAA" }, children: [] }, selected: "other", inputs: { current: new Map() }, handlers: { focus: key => calls.push(["select", key]), preview: (src, text) => calls.push(["preview", src, text]) }, multiKeys: new Set() };
  function imageOf(element) {
    if (!React.isValidElement(element)) return null;
    if (element.type === "img") return element;
    for (const child of React.Children.toArray(element.props.children)) { const found = imageOf(child); if (found) return found; }
    return null;
  }
  imageOf(MindNode(props)).props.onClick({ currentTarget: { dataset: {} } });
  assert.deepEqual(calls, [["select", "image"], ["preview", props.node.image.src, "说明"]]);
  calls.length = 0;
  imageOf(MindNode({ ...props, relationSource: "other" })).props.onClick({ currentTarget: { dataset: {} } });
  assert.deepEqual(calls, []);
  imageOf(MindNode(props)).props.onClick({ currentTarget: { dataset: { dragged: "true" } } });
  assert.deepEqual(calls, []);

  const image = imageOf(MindNode(props));
  assert.equal(image.props.width, undefined);
  const previousStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ width: "110px", height: "61.875px" });
  image.props.onLoad({ currentTarget: { naturalWidth: 320, naturalHeight: 180, width: 110, height: 62 } });
  globalThis.getComputedStyle = previousStyle;
  const remounted = imageOf(MindNode({ ...props, node: { ...props.node } }));
  assert.equal(remounted.props.width, 110);
  assert.equal(remounted.props.height, 61.875);
  const replaced = imageOf(MindNode({ ...props, node: { ...props.node, image: { src: "data:image/png;base64,BBBB" } } }));
  assert.equal(replaced.props.width, undefined);
});

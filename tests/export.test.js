import { test } from "node:test";
import assert from "node:assert/strict";
import { fishboneRibPath, makeSvg } from "../src/export.ts";
import { connectorPath } from "../src/connector.ts";

test("Branch curves bend toward the target and clear the collapse control", () => {
  assert.equal(connectorPath({ x: 0, y: 0 }, { x: 60, y: 30 }, false), "M0 0Q20 30 60 30");
  assert.equal(connectorPath({ x: 0, y: 0 }, { x: 60, y: 30 }, false, { x: 0, y: -4, width: 6, height: 8 }), "M0 0H6Q24 30 60 30");
  assert.equal(connectorPath({ x: 60, y: 0 }, { x: 0, y: 30 }, false, { x: 54, y: -4, width: 6, height: 8 }), "M60 0H54Q36 30 0 30");
  assert.equal(connectorPath({ x: 20, y: 0 }, { x: 50, y: 60 }, true, { x: 16, y: 0, width: 8, height: 6 }), "M20 0V6Q50 24 50 60");
  assert.equal(connectorPath({ x: 0, y: 0 }, { x: -60, y: 30 }, false, { x: 2, y: -4, width: 6, height: 8 }), "M0 0Q-20 30 -60 30");
});

test("fishbone ribs lean toward the head on both sides of the spine", () => {
  assert.equal(fishboneRibPath(10, 20, 0, true), "M10 20L18 0");
  assert.equal(fishboneRibPath(10, 20, 40, true), "M10 20L18 40");
  assert.equal(fishboneRibPath(10, 20, 0, false), "M10 20L2 0");
  assert.equal(fishboneRibPath(10, 20, 40, false), "M10 20L2 40");
});

test("SVG export preserves every line of node text", () => {
  const previous = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, XMLSerializer: globalThis.XMLSerializer };
  const box = { left: 0, top: 0, width: 100, height: 40 };
  const editor = { value: "第一行\n\n第三行", getBoundingClientRect: () => box };
  const card = { getBoundingClientRect: () => box, querySelector: selector => selector === ".node-text textarea" ? editor : null };
  const row = { querySelector: () => card, querySelectorAll: () => [] };
  const map = { getBoundingClientRect: () => box, querySelector: selector => selector === ":scope > .node-row" ? row : null, querySelectorAll: () => [] };
  globalThis.document = { documentElement: {}, body: { appendChild() {} },
    createElement: tag => ({ style: {}, appendChild() {}, remove() {}, getBoundingClientRect: () => ({ top: tag === "span" ? 11 : 0 }) }),
    createElementNS: (_, tag) => ({ tag, attributes: {}, children: [], setAttribute(name, value) { this.attributes[name] = value; }, appendChild(child) { this.children.push(child); } }) };
  globalThis.getComputedStyle = () => ({ backgroundColor: "#000", getPropertyValue: () => "", fontSize: "10px", lineHeight: "14px" });
  let svg;
  globalThis.XMLSerializer = class { serializeToString(element) { svg = element; return "svg"; } };
  try {
    makeSvg(map, {}, 1);
    const spans = svg.children[2].children.find(child => child.tag === "text").children;
    assert.deepEqual(spans.map(span => span.textContent), ["第一行", "", "第三行"]);
    assert.deepEqual(spans.map(span => span.attributes.y), ["43", "57", "71"]);
    globalThis.getComputedStyle = element => ({ backgroundColor: "#fff", getPropertyValue: () => "", fontSize: "10px", lineHeight: "14px", ...(element === card ? { borderTopWidth: "3px", borderTopColor: "#558ed5" } : {}) });
    makeSvg(map, {}, 1);
    assert.equal(svg.children[2].children.find(child => child.tag === "rect").attributes["stroke-width"], "3");
    globalThis.getComputedStyle = element => ({ backgroundColor: "transparent", getPropertyValue: () => "", fontSize: "10px", lineHeight: "14px", ...(element === card ? { borderTopWidth: "0px", borderBottomWidth: "2px", borderBottomColor: "#123456" } : {}), ...(element === editor ? { textDecorationLine: "underline" } : {}) });
    makeSvg(map, {}, 1);
    const underline = svg.children[2].children.find(child => child.tag === "line");
    assert.deepEqual(underline.attributes, { x1: "32", y1: "71", x2: "132", y2: "71", stroke: "#123456", "stroke-width": "2" });
    assert.equal(svg.children[2].children.find(child => child.tag === "text").attributes["text-decoration"], "underline");
    assert.throws(() => makeSvg({ ...map, querySelector: () => null }, {}, 1), /incomplete/);
    globalThis.XMLSerializer = class { serializeToString() { return "<svg>ok\u0001\u0000\uD800\uFFFE\n中文😀</svg>"; } };
    assert.equal(makeSvg(map, {}, 1).svg, "<svg>ok\uFFFD\uFFFD\uFFFD\uFFFD\n中文😀</svg>");
  } finally { Object.assign(globalThis, previous); }
});

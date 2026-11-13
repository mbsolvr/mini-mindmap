import { test } from "node:test";
import assert from "node:assert/strict";
import { toMarkdown } from "../src/markdown.ts";

const node = (text, children = [], extra = {}) => ({ text, children, ...extra });
test("exports the complete hierarchy including collapsed nodes and escapes Markdown syntax", () => {
  const tree = node("项目 #1", [node("第一项", [node("https://example.com/a_(b)")], { collapsed: true }), node("a * b", [], { textStyle: { bold: true } })]);
  assert.equal(toMarkdown(tree), "# 项目 \\#1\n\n- 第一项\n  - [https://example\\.com/a\\_\\(b\\)](<https://example.com/a_(b)>)\n- **a \\* b**\n");
});
test("embeds images and retains links and image-only nodes", () => {
  const tree = node("根", [node("", [], { image: { src: "data:image/png;base64,AA==", caption: "图片[1]" } }), node("说明", [], { link: { url: "https://example.com", label: "打开" } })]);
  const result = toMarkdown(tree);
  assert.match(result, /!\[图片\\\[1\\\]\]\(<data:image\/png;base64,AA==>\)/);
  assert.match(result, /说明 \[打开\]\(<https:\/\/example\.com>\)/);
  assert.throws(() => toMarkdown(node("x", [], { image: { src: "file:///tmp/image.png" } })), /image format/);
});

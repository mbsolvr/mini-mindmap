import { test } from "node:test";
import assert from "node:assert/strict";
import { fitContextMenu } from "../src/contextMenu.ts";

test("context menus fit their measured size and scroll within a small viewport", () => {
  const previous = globalThis.window;
  globalThis.window = { innerWidth: 320, innerHeight: 240 };
  try {
    const menu = { style: { left: "300px", top: "220px" }, getBoundingClientRect: () => ({ width: 250, height: 224 }) };
    fitContextMenu(menu);
    assert.equal(menu.style.left, "62px");
    assert.equal(menu.style.top, "8px");
    assert.equal(menu.style.maxHeight, "224px");
    assert.equal(menu.style.overflow, "auto");
  } finally { globalThis.window = previous; }
});

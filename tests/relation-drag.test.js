import { test } from "node:test";
import assert from "node:assert/strict";
import { hookRuntime, loadHook } from "./helpers/hooks.mjs";

class TrackedTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, options);
    const key = `${type}:${options === true}`;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(listener);
  }
  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, options);
    this.listeners.get(`${type}:${options === true}`)?.delete(listener);
  }
  get count() {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

async function setup(t, zoom = 1) {
  const runtime = hookRuntime(),
    previous = globalThis.window;
  const win = (globalThis.window = new TrackedTarget()),
    target = new TrackedTarget();
  const { useRelationDrag } = await loadHook(
    new URL("../src/hooks/useRelationDrag.ts", import.meta.url),
    runtime.hooks,
  );
  const tree = { key: "root" },
    commits = [];
  const controls = Object.freeze({
    start: Object.freeze({ x: 10, y: 20 }),
    end: Object.freeze({ x: -30, y: -40 }),
  });
  let captured = false,
    options = { tree, zoom, selected: 0, floatingTopics: undefined },
    hook;
  Object.assign(target, {
    setPointerCapture() {
      captured = true;
    },
    hasPointerCapture() {
      return captured;
    },
    releasePointerCapture() {
      captured = false;
      target.dispatchEvent(new Event("lostpointercapture"));
    },
  });
  const render = (patch = {}, effects = true) => {
    options = { ...options, ...patch };
    hook = runtime.render(
      () =>
        useRelationDrag(
          options.tree,
          options.zoom,
          options.selected,
          options.floatingTopics,
          (...args) => commits.push(args),
        ),
      effects,
    );
    return hook;
  };
  const pointer = (type, x = 100, y = 100, pointerId = 1) =>
    Object.assign(new Event(type, { cancelable: true }), {
      clientX: x,
      clientY: y,
      pointerId,
    });
  const dispatch = (...args) => win.dispatchEvent(pointer(...args));
  const begin = (end = "start", patch = {}) =>
    hook.start(
      {
        button: 0,
        pointerId: 1,
        currentTarget: target,
        clientX: 100,
        clientY: 100,
        preventDefault() {},
        stopPropagation() {},
        ...patch,
      },
      "rel",
      end,
      controls,
    );
  const clean = () => {
    assert.equal(captured, false);
    assert.equal(target.count, 0);
    assert.equal(win.count, 0, "gesture listeners leaked");
    assert.equal(render().preview, null);
  };
  render();
  t.after(() => {
    runtime.unmount();
    globalThis.window = previous;
  });
  return {
    runtime,
    win,
    target,
    tree,
    controls,
    commits,
    render,
    dispatch,
    begin,
    clean,
  };
}

for (const zoom of [0.2, 1, 1.1, 2]) {
  for (const end of ["start", "end"]) {
    test(`${end} handle uses map coordinates at ${Math.round(zoom * 100)}% and commits only once`, async (t) => {
      const h = await setup(t, zoom),
        other = end === "start" ? "end" : "start";
      h.begin(end);
      for (let i = 1; i <= 10; i++) {
        h.dispatch("pointermove", 100 + i * 3, 100 - i * 2);
        h.render();
        assert.equal(h.commits.length, 0);
      }
      const preview = h.render().preview;
      assert.equal(preview.controls[other], h.controls[other]);
      assert.ok(
        Math.abs(preview.controls[end].x - h.controls[end].x - 30 / zoom) <
          1e-8,
      );
      // The last pointerup position can differ from the last pointermove.
      h.dispatch("pointerup", 150, 50);
      assert.equal(h.commits.length, 1);
      assert.equal(h.commits[0][0], "rel");
      assert.equal(h.commits[0][2], h.tree);
      assert.deepEqual(h.commits[0][1], {
        ...h.controls,
        [end]: {
          x: h.controls[end].x + 50 / zoom,
          y: h.controls[end].y - 50 / zoom,
        },
      });
      h.dispatch("pointerup", 160, 60);
      assert.equal(h.commits.length, 1);
      h.clean();
    });
  }
}

test("unrelated pointers and non-primary buttons cannot alter a gesture", async (t) => {
  const h = await setup(t);
  for (const patch of [{ button: 1 }, { button: 2 }, { isPrimary: false }]) {
    h.begin("start", patch);
    h.clean();
  }
  h.begin();
  h.dispatch("pointermove", 140, 150, 2);
  h.dispatch("pointerup", 140, 150, 2);
  h.dispatch("pointercancel", 140, 150, 2);
  assert.equal(h.render().preview, null);
  assert.equal(h.commits.length, 0);
  h.dispatch("pointerup", 140, 150);
  assert.equal(h.commits.length, 1);
  h.clean();
});

test("clicks, small jitter, and dragging back to the origin create no edits", async (t) => {
  const h = await setup(t);
  for (const points of [
    [],
    [[102, 101]],
    [
      [150, 130],
      [100, 100],
    ],
  ]) {
    h.begin();
    points.forEach(([x, y]) => h.dispatch("pointermove", x, y));
    h.dispatch("pointerup", 100, 100);
    assert.equal(h.commits.length, 0);
    h.clean();
  }
});

for (const reason of [
  "pointercancel",
  "wheel",
  "blur",
  "lostpointercapture",
  "Escape",
  "Control+s",
  "Control+z",
  "Meta+s",
  "Delete",
  "Backspace",
  "unmount",
]) {
  test(`${reason} cancels preview, releases capture, and removes listeners`, async (t) => {
    const h = await setup(t);
    h.begin();
    h.dispatch("pointermove", 140, 150);
    assert.ok(h.render().preview);
    if (reason === "unmount") h.runtime.unmount();
    else if (reason === "lostpointercapture")
      h.target.dispatchEvent(new Event(reason));
    else if (["pointercancel", "wheel", "blur"].includes(reason))
      h.win.dispatchEvent(new Event(reason));
    else {
      const event = Object.assign(new Event("keydown", { cancelable: true }), {
        key: reason.split("+").at(-1),
        ctrlKey: reason.startsWith("Control+"),
        metaKey: reason.startsWith("Meta+"),
      });
      h.win.dispatchEvent(event);
      assert.equal(event.defaultPrevented, reason === "Escape");
    }
    h.dispatch("pointermove", 160, 160);
    h.dispatch("pointerup", 160, 160);
    assert.equal(h.commits.length, 0);
    h.clean();
  });
}

for (const change of ["tree", "zoom", "selected", "floatingTopics"]) {
  test(`changing ${change} rejects a pending release before effect cleanup`, async (t) => {
    const h = await setup(t);
    h.begin();
    h.dispatch("pointermove", 140, 150);
    const patch = {
      tree: { key: "other" },
      zoom: 2,
      selected: null,
      floatingTopics: [],
    };
    h.render({ [change]: patch[change] }, false);
    h.dispatch("pointerup", 170, 170);
    assert.equal(h.commits.length, 0);
    h.runtime.flushEffects();
    h.clean();
  });
}

test("starting a second gesture abandons the first and offsets stay within file limits", async (t) => {
  const h = await setup(t, 0.2);
  h.begin();
  h.dispatch("pointermove", 140, 150);
  h.begin("end");
  h.dispatch("pointerup", 1000000, -1000000);
  assert.equal(h.commits.length, 1);
  assert.deepEqual(h.commits[0][1], {
    start: h.controls.start,
    end: { x: 100000, y: -100000 },
  });
  h.clean();
});

test("repeated drags and cancellations do not accumulate callbacks or pointer captures", async (t) => {
  const h = await setup(t);
  for (let cycle = 0; cycle < 200; cycle++) {
    h.begin(cycle % 2 ? "start" : "end");
    for (let step = 0; step < 20; step++) {
      h.dispatch("pointermove", 120 + step, 90 - step);
      h.render();
    }
    if (cycle % 2) h.win.dispatchEvent(new Event("blur"));
    h.dispatch("pointerup", 150, 70);
    assert.equal(h.commits.length, Math.floor(cycle / 2) + 1);
    h.clean();
  }
});

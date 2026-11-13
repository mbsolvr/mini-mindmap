import { test } from "node:test";
import assert from "node:assert/strict";
import { hookRuntime, loadHook, deferred, settle } from "./helpers/hooks.mjs";
import {
  parseDocument,
  serializeWorkspace,
  workspaceFromDocument,
} from "../src/model.ts";
import { richWorkspace } from "./samples.mjs";

async function setup(t, config = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const runtime = hookRuntime(),
    previous = globalThis.window,
    calls = [],
    errors = [],
    restored = [],
    prompts = [];
  const workspaceRef = { current: richWorkspace() },
    dirtyRef = { current: true },
    openingRef = { current: false };
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push({ command, args });
          if (command === "read_recovery") return config.read ?? null;
          return config.operation?.(command, args);
        },
      },
    },
  };
  const { useRecovery } = await loadHook(
    new URL("../src/hooks/useRecovery.ts", import.meta.url),
    runtime.hooks,
  );
  let epoch = 0,
    hook;
  const options = {
    workspaceRef,
    dirtyRef,
    openingRef,
    working() {},
    restore: (value) => restored.push(value),
    setError: (value) => errors.push(value),
    confirmRef: {
      current: async (prompt) => {
        prompts.push(prompt);
        return config.confirm ?? true;
      },
    },
  };
  const render = () =>
    (hook = runtime.render(() =>
      useRecovery({
        ...options,
        workspace: workspaceRef.current,
        epoch: epoch++,
      }),
    ));
  render();
  t.after(() => {
    runtime.unmount();
    globalThis.window = previous;
  });
  return {
    calls,
    errors,
    restored,
    prompts,
    workspaceRef,
    dirtyRef,
    openingRef,
    runtime,
    render,
    ready: async () => {
      await settle();
      render();
    },
    flush: () => hook.flush(),
  };
}

test("recovery cannot overwrite a draft before startup has finished", async (t) => {
  const reading = deferred(),
    h = await setup(t, { read: reading.promise });
  assert.equal(h.openingRef.current, true);
  await assert.rejects(h.flush(), /Recovery data is unavailable/);
  assert.deepEqual(
    h.calls.map((call) => call.command),
    ["read_recovery"],
  );
  reading.resolve(null);
  await h.ready();
  assert.equal(h.openingRef.current, false);
  await h.flush();
  const contents = h.calls.at(-1).args.contents;
  assert.deepEqual(
    workspaceFromDocument(parseDocument(contents)),
    h.workspaceRef.current,
  );
});

for (const discard of [false, true]) {
  test(`an invalid recovery draft is ${discard ? "discarded only with consent" : "preserved when kept"}`, async (t) => {
    const h = await setup(t, { read: "{broken", confirm: discard });
    await h.ready();
    assert.equal(h.prompts[0].title, "Recovery draft is invalid");
    assert.equal(h.prompts[0].allowDismiss, false);
    assert.equal(h.restored.length, 0);
    if (!discard) {
      await assert.rejects(h.flush(), /Recovery data is unavailable/);
      t.mock.timers.tick(1000);
      await settle();
      assert.deepEqual(
        h.calls.map((call) => call.command),
        ["read_recovery"],
      );
      assert.match(h.errors[0], /Invalid recovery draft/);
    } else {
      assert.deepEqual(
        h.calls.map((call) => call.command),
        ["read_recovery", "clear_recovery"],
      );
      await h.flush();
      assert.equal(h.calls.at(-1).command, "write_recovery");
    }
  });
}

for (const recover of [false, true]) {
  test(`valid recovery data ${recover ? "restores connection controls" : "is cleared on discard"}`, async (t) => {
    const saved = richWorkspace();
    saved.tabs[0].tree.relations[0].controls = {
      start: { x: -10, y: -80 },
      end: { x: 20, y: -120 },
    };
    const h = await setup(t, {
      read: serializeWorkspace(saved),
      confirm: recover,
    });
    await h.ready();
    assert.equal(h.prompts[0].title, "Recover unsaved work?");
    assert.deepEqual(h.restored, recover ? [saved] : []);
    assert.deepEqual(
      h.calls.map((call) => call.command),
      recover ? ["read_recovery"] : ["read_recovery", "clear_recovery"],
    );
  });
}

test("an unmounted recovery reader cannot restore or clear a late result", async (t) => {
  const reading = deferred(),
    h = await setup(t, { read: reading.promise });
  h.runtime.unmount();
  reading.resolve(serializeWorkspace(richWorkspace()));
  await settle();
  assert.deepEqual(h.restored, []);
  assert.deepEqual(h.prompts, []);
  assert.deepEqual(
    h.calls.map((call) => call.command),
    ["read_recovery"],
  );
});

test("draft writes and clears remain ordered and a failed write does not poison the queue", async (t) => {
  const first = deferred(),
    second = deferred();
  let writes = 0;
  const h = await setup(t, {
    operation: (command) =>
      command === "write_recovery"
        ? ++writes === 1
          ? first.promise
          : second.promise
        : undefined,
  });
  await h.ready();
  const p1 = h.flush();
  await settle();
  const original = h.workspaceRef.current;
  h.workspaceRef.current = {
    ...original,
    tabs: [
      original.tabs[0],
      { tree: { ...original.tabs[1].tree, text: "Newer document" } },
    ],
  };
  const p2 = h.flush().catch((error) => error);
  h.dirtyRef.current = false;
  const p3 = h.flush();
  await settle();
  assert.equal(writes, 1, "overlapping recovery writes");
  first.resolve();
  await p1;
  await settle();
  assert.equal(writes, 2);
  const snapshots = h.calls
    .filter((call) => call.command === "write_recovery")
    .map((call) => parseDocument(call.args.contents));
  assert.equal(snapshots[0].tabs[1].tree.text, original.tabs[1].tree.text);
  assert.equal(snapshots[1].tabs[1].tree.text, "Newer document");
  second.reject(new Error("disk full"));
  assert.match((await p2).message, /disk full/);
  await p3;
  assert.deepEqual(
    h.calls.map((call) => call.command),
    ["read_recovery", "write_recovery", "write_recovery", "clear_recovery"],
  );
});

test("debounced recovery saves the latest edit and cancels timers on unmount", async (t) => {
  const h = await setup(t);
  await h.ready();
  for (let i = 0; i < 4; i++) {
    const ws = h.workspaceRef.current;
    h.workspaceRef.current = {
      ...ws,
      tabs: [
        { ...ws.tabs[0], tree: { ...ws.tabs[0].tree, text: `Edit ${i}` } },
        ws.tabs[1],
      ],
    };
    h.render();
    t.mock.timers.tick(200);
    await settle();
  }
  assert.equal(h.calls.length, 1);
  t.mock.timers.tick(300);
  await settle();
  assert.equal(h.calls.length, 2);
  assert.equal(
    parseDocument(h.calls[1].args.contents).tabs[0].tree.text,
    "Edit 3",
  );
  h.dirtyRef.current = false;
  h.render();
  t.mock.timers.tick(500);
  await settle();
  assert.equal(h.calls.at(-1).command, "clear_recovery");
  h.dirtyRef.current = true;
  h.render();
  h.runtime.unmount();
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(h.calls.length, 3);
});

test("a background recovery failure is reported and the next flush can retry", async (t) => {
  let failing = true;
  const h = await setup(t, {
    operation: () => {
      if (failing) throw new Error("read-only directory");
    },
  });
  await h.ready();
  t.mock.timers.tick(500);
  await settle();
  assert.match(
    h.errors.at(-1),
    /Could not save recovery data:.*read-only directory/,
  );
  failing = false;
  await h.flush();
  assert.deepEqual(
    h.calls.map((call) => call.command),
    ["read_recovery", "write_recovery", "write_recovery"],
  );
});

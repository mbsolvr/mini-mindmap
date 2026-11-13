import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { hookRuntime, loadHook, deferred } from "./helpers/hooks.mjs";
import { createArchive } from "../src/archive.ts";
import { serializeWorkspace, newDocument } from "../src/model.ts";
import { richWorkspace } from "./samples.mjs";

async function setup(t, invoke) {
  const previous = globalThis.window,
    runtime = hookRuntime(),
    calls = [],
    errors = [],
    marked = [],
    opened = [];
  const workspace = richWorkspace(),
    workspaceRef = { current: workspace };
  const savedRef = { current: serializeWorkspace(workspace) },
    dirtyRef = { current: false },
    pathRef = { current: "/tmp/original.minimap" };
  const historyRef = { current: [workspace] },
    redoRef = { current: [workspace] },
    openingRef = { current: false };
  globalThis.window = {
    localStorage: { getItem: () => "false" },
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push(command);
          return invoke(command, args);
        },
      },
    },
  };
  const { useDocumentFile } = await loadHook(
    new URL("../src/hooks/useDocumentFile.ts", import.meta.url),
    runtime.hooks,
    {
      'import { flushSync } from "react-dom";':
        "const flushSync = (fn) => fn();",
      'import { useRecovery } from "./useRecovery.ts";':
        "const useRecovery = () => ({ flush: async () => {} });",
    },
  );
  const options = {
    workspace,
    workspaceRef,
    savedRef,
    dirtyRef,
    pathRef,
    historyRef,
    redoRef,
    openingRef,
    setWorkspace() {},
    setStatus() {},
    onOpened: (key) => opened.push(key),
    markTabsSaved: (snapshot) => marked.push(snapshot),
    setError: (value) => {
      if (value) errors.push(value);
    },
    confirm: async () => true,
    updateDirty() {
      dirtyRef.current =
        serializeWorkspace(workspaceRef.current) !== savedRef.current;
    },
  };
  const hook = runtime.render(() => useDocumentFile(options));
  const unchanged = () => {
    assert.equal(workspaceRef.current, workspace);
    assert.equal(savedRef.current, serializeWorkspace(workspace));
    assert.equal(pathRef.current, "/tmp/original.minimap");
    assert.deepEqual(historyRef.current, [workspace]);
    assert.deepEqual(redoRef.current, [workspace]);
    assert.deepEqual(marked, []);
    assert.deepEqual(opened, []);
    assert.equal(hook.busyRef.current, false);
    assert.equal(openingRef.current, false);
  };
  t.after(() => {
    runtime.unmount();
    globalThis.window = previous;
  });
  return {
    hook,
    workspace,
    workspaceRef,
    savedRef,
    dirtyRef,
    pathRef,
    calls,
    errors,
    marked,
    unchanged,
  };
}

test("cancelling Save As or Open leaves file identity, saved markers and history intact", async (t) => {
  const h = await setup(t, () => null);
  await h.hook.save(true);
  h.unchanged();
  await h.hook.openCopy();
  h.unchanged();
  assert.deepEqual(h.calls, ["save_as", "open_copy"]);
  assert.deepEqual(h.errors, []);
});

for (const message of [
  "disk full",
  "The file changed outside the app; auto-save is paused. Save as a new file.",
]) {
  test(`failed save preserves data and allows retry: ${message}`, async (t) => {
    let fail = true;
    const h = await setup(t, () => {
      if (fail) throw new Error(message);
      return { path: "/tmp/original.minimap", warning: null };
    });
    const original = h.workspaceRef.current;
    h.workspaceRef.current = {
      ...original,
      tabs: [
        original.tabs[0],
        { tree: { ...original.tabs[1].tree, text: "Unsaved change" } },
      ],
    };
    h.dirtyRef.current = true;
    await h.hook.save(false);
    assert.equal(h.savedRef.current, serializeWorkspace(original));
    assert.equal(h.pathRef.current, "/tmp/original.minimap");
    assert.equal(h.workspaceRef.current.tabs[1].tree.text, "Unsaved change");
    assert.equal(h.hook.pausedRef.current, true);
    assert.equal(h.hook.busyRef.current, false);
    assert.equal(h.dirtyRef.current, true);
    assert.deepEqual(h.marked, []);
    assert.ok(h.errors.at(-1).includes(message));
    fail = false;
    await h.hook.save(false);
    assert.equal(h.hook.pausedRef.current, false);
    assert.equal(h.dirtyRef.current, false);
    assert.equal(h.marked[0], h.workspaceRef.current);
    assert.deepEqual(h.calls, ["save_current", "save_current"]);
  });
}

test("save and open operations cannot overlap while a write is pending", async (t) => {
  const writing = deferred(),
    started = deferred();
  const h = await setup(t, (command) => {
    assert.equal(command, "save_current");
    started.resolve();
    return writing.promise;
  });
  const first = h.hook.save(false);
  await h.hook.save(true);
  await h.hook.openCopy();
  await started.promise;
  assert.deepEqual(h.calls, ["save_current"]);
  assert.equal(h.hook.busyRef.current, true);
  writing.resolve({ path: "/tmp/original.minimap", warning: null });
  await first;
  assert.equal(h.hook.busyRef.current, false);
  h.hook.composingRef.current = true;
  await h.hook.save(false);
  await h.hook.openCopy();
  assert.deepEqual(
    h.calls,
    ["save_current"],
    "IME composition must not be interrupted by file operations",
  );
});

for (const kind of ["workspace", "map"]) {
  test(`accepting a ${kind} that changed on disk does not partially replace the workspace`, async (t) => {
    const contents = await createArchive(
      kind === "workspace"
        ? serializeWorkspace(richWorkspace())
        : JSON.stringify(newDocument("Imported")),
    );
    const h = await setup(t, (command) => {
      if (command === "open_copy") return { contents };
      throw new Error("The file changed while opening; open it again");
    });
    if (kind === "map") {
      // Exercise adoption of an unused blank tab, which also calls accept_open.
      h.workspace.tabs = [{ tree: newDocument().tree }];
      h.workspace.active = 0;
      h.pathRef.current = "";
      h.savedRef.current = serializeWorkspace(h.workspace);
    }
    const before = {
      workspace: h.workspaceRef.current,
      saved: h.savedRef.current,
      path: h.pathRef.current,
    };
    await h.hook.openCopy();
    assert.equal(h.workspaceRef.current, before.workspace);
    assert.equal(h.savedRef.current, before.saved);
    assert.equal(h.pathRef.current, before.path);
    assert.equal(h.hook.busyRef.current, false);
    assert.deepEqual(h.calls, ["open_copy", "accept_open"]);
    assert.match(h.errors.at(-1), /file changed while opening/);
    assert.deepEqual(h.marked, []);
  });
}

test("semantically corrupt connection controls are rejected before a file is accepted", async (t) => {
  const zip = await JSZip.loadAsync(
    await createArchive(serializeWorkspace(richWorkspace())),
    { base64: true },
  );
  const map = JSON.parse(await zip.file("maps/1.json").async("string"));
  map.tree.relations[0].controls = {
    start: { x: "invalid", y: 0 },
    end: { x: 0, y: 0 },
  };
  zip.file("maps/1.json", JSON.stringify(map));
  const contents = await zip.generateAsync({
    type: "base64",
    compression: "STORE",
  });
  const h = await setup(t, (command) => {
    assert.equal(command, "open_copy");
    return { contents };
  });
  await h.hook.openCopy();
  h.unchanged();
  assert.deepEqual(h.calls, ["open_copy"]);
  assert.match(h.errors.at(-1), /Invalid or unsupported minimap file/);
});

for (const title of [
  "Central Topic",
  "中心主题",
  "中心トピック",
  "중심 주제",
]) {
  test(`opening a map reuses an untouched blank tab named ${title}`, async (t) => {
    const contents = await createArchive(
      JSON.stringify(newDocument("Imported")),
    );
    const h = await setup(t, (command) =>
      command === "open_copy" ? { contents } : "/tmp/imported.minimap",
    );
    h.workspace.tabs = [{ tree: newDocument(title).tree }];
    h.workspace.active = 0;
    h.pathRef.current = "";
    h.savedRef.current = serializeWorkspace(h.workspace);
    await h.hook.openCopy();
    assert.equal(h.workspaceRef.current.tabs.length, 1);
    assert.equal(h.workspaceRef.current.tabs[0].tree.text, "Imported");
    assert.equal(h.pathRef.current, "/tmp/imported.minimap");
    assert.deepEqual(h.calls, ["open_copy", "accept_open"]);
    assert.deepEqual(h.errors, []);
  });
}

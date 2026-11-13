import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { newDocument, serializeWorkspace, workspaceFromDocument } from "../src/model.ts";

async function loadHook(tag) {
  const source = await readFile(new URL("../src/hooks/useDocumentFile.ts", import.meta.url), "utf8");
  const compiled = await transform(source, { loader: "ts", format: "esm" });
  const code = compiled.code.replace(/import \{ useEffect, useRef, useState \} from "react";/, 'const { useEffect, useRef, useState } = globalThis.__fileHookTest;')
    .replace('import { flushSync } from "react-dom";', 'const flushSync = fn => fn();')
    .replace('import { useRecovery } from "./useRecovery.ts";', 'const useRecovery = () => ({ flush: async () => {} });')
    .replaceAll('"../autosave.ts"', `"${new URL("../src/autosave.ts", import.meta.url).href}"`)
    .replaceAll('"../model.ts"', `"${new URL("../src/model.ts", import.meta.url).href}"`)
    .replaceAll('"../archive.ts"', `"${new URL("../src/archive.ts", import.meta.url).href}"`)
    .replaceAll('"../tauri.ts"', `"${new URL("../src/tauri.ts", import.meta.url).href}"`);
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${tag}`)).useDocumentFile;
}

test("saving a snapshot keeps edits made while the write is pending dirty", async () => {
  const previous = { hook: globalThis.__fileHookTest, window: globalThis.window };
  let finish, written, status, signalStarted, savedSnapshot;
  const started = new Promise(resolve => { signalStarted = resolve; });
  globalThis.__fileHookTest = { useEffect() {}, useRef: value => ({ current: value }), useState: initial => [typeof initial === "function" ? initial() : initial, () => {}] };
  globalThis.window = { localStorage: { getItem: () => null }, __TAURI__: { core: { invoke: (_command, args) => { written = args.contents; signalStarted(); return new Promise(resolve => { finish = resolve; }); } } } };
  try {
    const useDocumentFile = await loadHook("save");
    const workspace = workspaceFromDocument(newDocument());
    const workspaceRef = { current: workspace }, savedRef = { current: "" }, dirtyRef = { current: true };
    const hook = useDocumentFile({ markTabsSaved: snapshot => { savedSnapshot = snapshot; }, workspace, workspaceRef, savedRef, dirtyRef, setWorkspace() {}, historyRef: { current: [] }, redoRef: { current: [] }, openingRef: { current: false }, pathRef: { current: "/tmp/map.json" }, setStatus: value => { status = value; }, setError() {}, onOpened() {}, updateDirty: () => { dirtyRef.current = serializeWorkspace(workspaceRef.current) !== savedRef.current; } });
    const saving = hook.save(false);
    await started;
    workspaceRef.current = { ...workspace, tabs: [{ tree: { ...workspace.tabs[0].tree, text: "later edit" } }] };
    finish({ path: "/tmp/map.minimap", warning: null }); await saving;
    const { readArchive } = await import("../src/archive.ts");
    assert.deepEqual(JSON.parse(savedRef.current), JSON.parse(await readArchive(written)));
    assert.equal(dirtyRef.current, true);
    assert.equal(savedSnapshot, workspace);
    assert.equal(status, "Waiting to save further changes");
    assert.equal(hook.busyRef.current, false);
  } finally { globalThis.__fileHookTest = previous.hook; globalThis.window = previous.window; }
});

test("opening a workspace restores the saved tabs and file association", async () => {
  const { createArchive } = await import("../src/archive.ts");
  const initial = workspaceFromDocument(newDocument());
  const opened = { ...initial, active: 1, tabs: [{ tree: newDocument("one").tree }, { tree: newDocument("two").tree }] };
  const archive = await createArchive(serializeWorkspace(opened));
  const previous = { hook: globalThis.__fileHookTest, window: globalThis.window };
  globalThis.__fileHookTest = { useEffect() {}, useRef: value => ({ current: value }), useState: value => [typeof value === "function" ? value() : value, () => {}] };
  const commands = [];
  globalThis.window = { localStorage: { getItem: () => null }, __TAURI__: { core: { invoke: async command => { commands.push(command); return command === "open_copy" ? { contents: archive } : "/tmp/maps.minimap"; } } } };
  try {
    const useDocumentFile = await loadHook("open");
    const workspaceRef = { current: initial }, savedRef = { current: "" }, pathRef = { current: "" }, openingRef = { current: false };
    let selected;
    const hook = useDocumentFile({ markTabsSaved() {}, workspace: initial, workspaceRef, savedRef, pathRef, openingRef, dirtyRef: { current: false }, historyRef: { current: [] }, redoRef: { current: [] }, setWorkspace() {}, setStatus() {}, setError: error => { if (error) throw new Error(error); }, onOpened: key => { selected = key; }, updateDirty() {} });
    await hook.openCopy();
    assert.deepEqual(workspaceRef.current, opened);
    assert.equal(savedRef.current, serializeWorkspace(opened));
    assert.equal(pathRef.current, "/tmp/maps.minimap");
    assert.equal(selected, opened.tabs[1].tree.key);
    assert.deepEqual(commands, ["open_copy", "accept_open"]);
    assert.equal(openingRef.current, false);
  } finally { globalThis.__fileHookTest = previous.hook; globalThis.window = previous.window; }
});

test("opening a corrupt file leaves the workspace and file association untouched", async () => {
  const previous = { hook: globalThis.__fileHookTest, window: globalThis.window };
  globalThis.__fileHookTest = { useEffect() {}, useRef: value => ({ current: value }), useState: value => [typeof value === "function" ? value() : value, () => {}] };
  const commands = [];
  globalThis.window = { localStorage: { getItem: () => null }, __TAURI__: { core: { invoke: async command => { commands.push(command); return { contents: Buffer.from("corrupt").toString("base64") }; } } } };
  try {
    const useDocumentFile = await loadHook("corrupt");
    const workspace = workspaceFromDocument(newDocument("Keep this"));
    const workspaceRef = { current: workspace }, savedRef = { current: "saved snapshot" }, pathRef = { current: "/tmp/original.minimap" }, openingRef = { current: false };
    let error;
    const hook = useDocumentFile({ markTabsSaved() {}, workspace, workspaceRef, savedRef, pathRef, openingRef, dirtyRef: { current: true }, historyRef: { current: [] }, redoRef: { current: [] }, setWorkspace() { throw new Error("workspace changed"); }, setStatus() {}, setError: value => { if (value) error = value; }, onOpened() { throw new Error("opened invalid file"); }, updateDirty() {} });
    await hook.openCopy();
    assert.match(error, /Invalid or unsupported minimap file/);
    assert.equal(workspaceRef.current, workspace);
    assert.equal(savedRef.current, "saved snapshot");
    assert.equal(pathRef.current, "/tmp/original.minimap");
    assert.deepEqual(commands, ["open_copy"]);
    assert.equal(openingRef.current, false);
  } finally { globalThis.__fileHookTest = previous.hook; globalThis.window = previous.window; }
});

test("importing a single map records the old workspace through the shared history path", async () => {
  const { createArchive } = await import("../src/archive.ts");
  const initial = workspaceFromDocument(newDocument("Current"));
  const archive = await createArchive(JSON.stringify(newDocument("Imported")));
  const previous = { hook: globalThis.__fileHookTest, window: globalThis.window };
  globalThis.__fileHookTest = { useEffect() {}, useRef: value => ({ current: value }), useState: value => [typeof value === "function" ? value() : value, () => {}] };
  globalThis.window = { localStorage: { getItem: () => null }, __TAURI__: { core: { invoke: async () => ({ contents: archive }) } } };
  try {
    const useDocumentFile = await loadHook("import-history");
    const workspaceRef = { current: initial }, historyRef = { current: [] }, redoRef = { current: [initial] };
    let recorded;
    const hook = useDocumentFile({ workspace: initial, workspaceRef, historyRef, redoRef, savedRef: { current: "" }, pathRef: { current: "/tmp/current.minimap" }, openingRef: { current: false }, dirtyRef: { current: false }, setWorkspace() {}, setStatus() {}, setError: error => { if (error) throw new Error(error); }, onOpened() {}, updateDirty() {}, markTabsSaved() {}, confirm: async () => true, recordHistory: snapshot => { recorded = snapshot; historyRef.current.push(snapshot); redoRef.current = []; } });
    await hook.openCopy();
    assert.equal(recorded, initial);
    assert.equal(workspaceRef.current.tabs.length, 2);
    assert.equal(workspaceRef.current.tabs[1].tree.text, "Imported");
    assert.deepEqual(redoRef.current, []);
  } finally { globalThis.__fileHookTest = previous.hook; globalThis.window = previous.window; }
});

test("cancelling workspace replacement keeps unsaved changes and the current file", async () => {
  const { createArchive } = await import("../src/archive.ts");
  const initial = workspaceFromDocument(newDocument("Unsaved"));
  const opened = { ...initial, tabs: [{ tree: newDocument("First").tree }, { tree: newDocument("Second").tree }] };
  const archive = await createArchive(serializeWorkspace(opened));
  const previous = { hook: globalThis.__fileHookTest, window: globalThis.window };
  globalThis.__fileHookTest = { useEffect() {}, useRef: value => ({ current: value }), useState: value => [typeof value === "function" ? value() : value, () => {}] };
  const commands = [];
  globalThis.window = { localStorage: { getItem: () => null }, __TAURI__: { core: { invoke: async command => { commands.push(command); return { contents: archive }; } } } };
  try {
    const useDocumentFile = await loadHook("cancel-replace");
    const workspaceRef = { current: initial }, pathRef = { current: "/tmp/original.minimap" };
    const hook = useDocumentFile({ markTabsSaved() {}, workspace: initial, workspaceRef, pathRef, savedRef: { current: "" }, openingRef: { current: false }, dirtyRef: { current: true }, historyRef: { current: [] }, redoRef: { current: [] }, setWorkspace() { throw new Error("workspace changed"); }, setStatus() {}, setError: error => { if (error) throw new Error(error); }, onOpened() {}, updateDirty() {}, confirm: async () => false });
    await hook.openCopy();
    assert.equal(workspaceRef.current, initial);
    assert.equal(pathRef.current, "/tmp/original.minimap");
    assert.deepEqual(commands, ["open_copy"]);
  } finally { globalThis.__fileHookTest = previous.hook; globalThis.window = previous.window; }
});

test("a durability warning retains the new path and recovery state until retry succeeds", async () => {
  const previous = { hook: globalThis.__fileHookTest, window: globalThis.window };
  globalThis.__fileHookTest = { useEffect() {}, useRef: value => ({ current: value }), useState: value => [typeof value === 'function' ? value() : value, () => {}] };
  let warning = 'File replaced, but directory synchronization failed; durability is not confirmed: test', error = '', marked = 0;
  const commands = [];
  globalThis.window = { localStorage: { getItem: () => null }, __TAURI__: { core: { invoke: async command => { commands.push(command); return { path: '/tmp/new.minimap', warning }; } } } };
  try {
    const useDocumentFile = await loadHook('durability-warning');
    const workspace = workspaceFromDocument(newDocument('New contents'));
    const workspaceRef = { current: workspace }, savedRef = { current: 'previous snapshot' }, pathRef = { current: '' }, dirtyRef = { current: true };
    const hook = useDocumentFile({ workspace, workspaceRef, savedRef, pathRef, dirtyRef, openingRef: { current: false }, historyRef: { current: [] }, redoRef: { current: [] }, setWorkspace() {}, setStatus() {}, onOpened() {}, markTabsSaved() { marked++; }, setError: value => { error = value; }, updateDirty() { dirtyRef.current = serializeWorkspace(workspaceRef.current) !== savedRef.current; } });
    await hook.save(true);
    assert.equal(pathRef.current, '/tmp/new.minimap');
    assert.equal(savedRef.current, 'previous snapshot');
    assert.equal(marked, 0);
    assert.equal(dirtyRef.current, true);
    assert.equal(hook.pausedRef.current, true);
    assert.match(error, /durability is not confirmed/);
    warning = null;
    await hook.save(false);
    assert.deepEqual(commands, ['save_as', 'save_current']);
    assert.equal(dirtyRef.current, false);
    assert.equal(hook.pausedRef.current, false);
    assert.equal(marked, 1);
  } finally { globalThis.__fileHookTest = previous.hook; globalThis.window = previous.window; }
});

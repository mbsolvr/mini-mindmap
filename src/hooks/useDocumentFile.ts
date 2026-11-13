import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { AUTO_SAVE_KEY, readAutoSave, shouldAutoSave } from "../autosave.ts";
import {
  parseDocument,
  serializeWorkspace,
  workspaceFromDocument,
} from "../model.ts";
import type { Workspace } from "../types.ts";
import { invoke } from "../tauri.ts";
import { createArchive, readArchive } from "../archive.ts";
import type { Confirmation } from "../components/ConfirmDialog.tsx";
import { useRecovery } from "./useRecovery.ts";

interface Options {
  workspace: Workspace;
  setWorkspace: Dispatch<SetStateAction<Workspace>>;
  workspaceRef: RefObject<Workspace>;
  savedRef: RefObject<string>;
  historyRef: RefObject<Workspace[]>;
  redoRef: RefObject<Workspace[]>;
  dirtyRef: RefObject<boolean>;
  updateDirty: () => void;
  openingRef: RefObject<boolean>;
  pathRef: RefObject<string>;
  markTabsSaved: (workspace: Workspace) => void;
  recordHistory: (workspace: Workspace) => void;
  confirm: (prompt: Confirmation) => Promise<boolean>;
  setStatus: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  onOpened: (key: string) => void;
}
export function useDocumentFile({
  workspace,
  setWorkspace,
  workspaceRef,
  savedRef,
  historyRef,
  redoRef,
  dirtyRef,
  updateDirty,
  openingRef,
  pathRef,
  setStatus,
  setError,
  onOpened,
  confirm,
  markTabsSaved,
  recordHistory,
}: Options) {
  const [autoSave, setAutoSave] = useState(() => {
    try {
      return readAutoSave(window.localStorage);
    } catch {
      return true;
    }
  });
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const autoSaveRef = useRef(autoSave);
  const [path, setPath] = useState("");
  const busyRef = useRef(false),
    pausedRef = useRef(false),
    composingRef = useRef(false);
  const [composing, setComposing] = useState(false),
    [busy, setBusy] = useState(false),
    [epoch, setEpoch] = useState(0),
    [launchSignal, setLaunchSignal] = useState(0);
  const checkedLaunch = useRef(0);
  function working(value: boolean) {
    busyRef.current = value;
    setBusy(value);
  }
  function commitEditor() {
    const editor = globalThis.document?.activeElement;
    if (
      editor &&
      editor instanceof HTMLElement &&
      editor.matches(
        ".tab-rename, .relation-editor, .node-text textarea, .floating-note textarea, .summary-text",
      )
    )
      flushSync(() => editor.blur());
  }
  const recovery = useRecovery({
    workspace,
    workspaceRef,
    dirtyRef,
    openingRef,
    epoch,
    confirmRef,
    working,
    setError,
    restore: (recovered) => {
      workspaceRef.current = recovered;
      savedRef.current = "";
      historyRef.current = [];
      redoRef.current = [];
      updateDirty();
      setWorkspace(recovered);
      onOpened(recovered.tabs[recovered.active].tree.key);
      setStatus("Recovered draft · Save the file");
    },
  });
  function toggleAutoSave() {
    const enabled = !autoSaveRef.current;
    autoSaveRef.current = enabled;
    setAutoSave(enabled);
    try {
      window.localStorage.setItem(AUTO_SAVE_KEY, String(enabled));
    } catch {
      setError(
        "Could not save the auto-save setting; it remains active for this session",
      );
    }
  }
  async function save(choose: boolean) {
    if (busyRef.current || composingRef.current) return;
    working(true);
    setError("");
    // Save this snapshot; edits made while the file is being written must remain dirty.
    const snapshot = workspaceRef.current;
    try {
      const contents = serializeWorkspace(snapshot);
      const archive = await createArchive(contents);
      const result =
        choose || !pathRef.current
          ? await invoke("save_as", { contents: archive })
          : await invoke("save_current", { contents: archive });
      if (!result) return;
      pathRef.current = result.path;
      setPath(result.path);
      if (result.warning) {
        pausedRef.current = true;
        setError(result.warning);
        setStatus("Save durability unconfirmed · Auto-save paused");
        return;
      }
      savedRef.current = contents;
      markTabsSaved(snapshot);
      pausedRef.current = false;
      updateDirty();
      setStatus(
        dirtyRef.current ? "Waiting to save further changes" : "Saved to file",
      );
    } catch (cause) {
      pausedRef.current = true;
      setError(String(cause));
      setStatus("Auto-save paused");
    } finally {
      working(false);
      setEpoch((value) => value + 1);
    }
  }
  async function openFile(launched: boolean): Promise<boolean> {
    if (busyRef.current || composingRef.current) return false;
    working(true);
    if (!launched) setError("");
    let received = false;
    try {
      if (!launched) {
        commitEditor();
        openingRef.current = true;
      }
      let file: { name: string; contents: string } | null;
      if (launched) {
        const result = await invoke("open_launched");
        if (!result) return false;
        received = true;
        if ("Err" in result) {
          setError(result.Err);
          return true;
        }
        file = result.Ok;
      } else file = await invoke("open_copy");
      if (!file) return false;
      received = true;
      if (launched) {
        commitEditor();
        openingRef.current = true;
      }
      const data = parseDocument(await readArchive(file.contents));
      const ws = workspaceRef.current;
      if (data.type === "workspace") {
        if (
          dirtyRef.current &&
          !(await confirm({
            title: "Open workspace?",
            message:
              "Opening a workspace replaces the current tabs. Unsaved changes will be lost. Continue?",
            action: "Open workspace",
          }))
        )
          return true;
        const openedPath = await invoke("accept_open");
        pathRef.current = openedPath;
        setPath(openedPath);
        workspaceRef.current = data;
        savedRef.current = serializeWorkspace(data);
        markTabsSaved(data);
        historyRef.current = [];
        redoRef.current = [];
      } else {
        const blank =
          ws.tabs.length === 1 &&
          !dirtyRef.current &&
          !pathRef.current &&
          !ws.tabs[0].tree.children.length &&
          !ws.tabs[0].tree.image;
        // Only an unused blank tab adopts the opened file; other imports keep the current file association.
        const imported = workspaceFromDocument(data).tabs[0];
        const next = blank
          ? { ...ws, tabs: [imported], active: 0 }
          : { ...ws, tabs: [...ws.tabs, imported], active: ws.tabs.length };
        if (blank) {
          const openedPath = await invoke("accept_open");
          pathRef.current = openedPath;
          setPath(openedPath);
          savedRef.current = serializeWorkspace(next);
          markTabsSaved(next);
        }
        workspaceRef.current = next;
        if (blank) {
          historyRef.current = [];
          redoRef.current = [];
        } else recordHistory(ws);
      }
      pausedRef.current = false;
      updateDirty();
      setWorkspace(workspaceRef.current);
      onOpened(workspaceRef.current.tabs[workspaceRef.current.active].tree.key);
      setStatus(pathRef.current ? "Map imported" : "File opened");
    } catch (cause) {
      setError(String(cause));
    } finally {
      openingRef.current = false;
      working(false);
      setEpoch((value) => value + 1);
    }
    return received;
  }
  async function openCopy() {
    await openFile(false);
  }
  useEffect(() => {
    const events = window.__TAURI__?.event;
    if (!events) return;
    let disposed = false,
      unlisten: (() => void) | undefined;
    void events
      .listen("launch-file", () => {
        if (!disposed) setLaunchSignal((value) => value + 1);
      })
      .then((stop) => {
        if (disposed) stop();
        else {
          unlisten = stop;
          setLaunchSignal((value) => value + 1);
        }
      })
      .catch((cause: unknown) => {
        if (!disposed)
          setError("Could not receive opened files: " + String(cause));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    if (
      !launchSignal ||
      launchSignal === checkedLaunch.current ||
      recovery.checking ||
      busy ||
      composing ||
      busyRef.current ||
      composingRef.current
    )
      return;
    checkedLaunch.current = launchSignal;
    void (async () => {
      while (await openFile(true)) {
        // Drain requests received before the listener was ready.
      }
    })();
  }, [launchSignal, recovery.checking, busy, composing]);
  useEffect(() => {
    if (
      !shouldAutoSave({
        enabled: autoSave,
        path,
        composing,
        busy,
        paused: pausedRef.current,
        dirty: dirtyRef.current,
      })
    )
      return;
    const timer = setTimeout(() => {
      if (
        shouldAutoSave({
          enabled: autoSaveRef.current,
          path: pathRef.current,
          composing: composingRef.current,
          busy: busyRef.current,
          paused: pausedRef.current,
          dirty: dirtyRef.current,
        })
      )
        void save(false);
    }, 900);
    return () => clearTimeout(timer);
  }, [workspace, path, composing, busy, epoch, autoSave]);
  useEffect(() => {
    const api = window.__TAURI__?.window?.getCurrentWindow();
    if (api)
      api
        .setTitle(
          `Mini Mindmap${path ? ` · ${(path.split(/[\\/]/).pop() || "").replace(/\.minimap$/i, "")}` : ""}`,
        )
        .catch((cause: unknown) =>
          setError("Could not update the window title: " + String(cause)),
        );
  }, [path]);
  useEffect(() => {
    let unlisten: (() => void) | undefined,
      disposed = false;
    const api = window.__TAURI__?.window?.getCurrentWindow();
    if (!api) return;
    let closing = false;
    api
      .onCloseRequested((event: { preventDefault: () => void }) => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        void (async () => {
          try {
            commitEditor();
            if (
              (dirtyRef.current || busyRef.current) &&
              !(await confirmRef.current({
                title: "Quit Mini Mindmap?",
                message:
                  "There are unsaved changes or a save in progress. Exit anyway?",
                action: "Quit",
              }))
            )
              return;
            await recovery.flush();
            if (!disposed) await api.destroy();
          } catch (cause) {
            if (!disposed)
              setError("Could not close the window: " + String(cause));
          } finally {
            closing = false;
          }
        })();
      })
      .then((fn: () => void) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((cause: unknown) =>
        setError("Could not enable the exit guard: " + String(cause)),
      );
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);
  return {
    autoSave,
    path,
    busy,
    busyRef,
    pausedRef,
    composingRef,
    setComposing,
    working,
    setEpoch,
    toggleAutoSave,
    save,
    openCopy,
  };
}

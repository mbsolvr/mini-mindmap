import { useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  parseDocument,
  serializeWorkspace,
  workspaceFromDocument,
} from "../model.ts";
import { invoke } from "../tauri.ts";
import type { Workspace } from "../types.ts";
import type { Confirmation } from "../components/ConfirmDialog.tsx";

interface Options {
  workspace: Workspace;
  workspaceRef: RefObject<Workspace>;
  dirtyRef: RefObject<boolean>;
  openingRef: RefObject<boolean>;
  epoch: number;
  confirmRef: RefObject<(prompt: Confirmation) => Promise<boolean>>;
  working: (value: boolean) => void;
  restore: (workspace: Workspace) => void;
  setError: Dispatch<SetStateAction<string>>;
}

export function useRecovery({
  workspace,
  workspaceRef,
  dirtyRef,
  openingRef,
  epoch,
  confirmRef,
  working,
  restore,
  setError,
}: Options) {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const readyRef = useRef(false),
    pending = useRef<Promise<void>>(Promise.resolve());
  // Serialize draft writes and clears so an older operation cannot overwrite a newer one.
  function enqueue(task: () => Promise<void>) {
    const next = pending.current.catch(() => {}).then(task);
    pending.current = next;
    return next;
  }
  function writeCurrent() {
    return invoke("write_recovery", {
      contents: serializeWorkspace(workspaceRef.current),
    });
  }
  async function flush() {
    if (dirtyRef.current) {
      if (!readyRef.current)
        throw new Error(
          "Recovery data is unavailable; save the file before quitting",
        );
      await enqueue(writeCurrent);
    } else if (readyRef.current) await enqueue(() => invoke("clear_recovery"));
  }
  useEffect(() => {
    let disposed = false;
    openingRef.current = true;
    working(true);
    void (async () => {
      try {
        const contents = await invoke("read_recovery");
        if (disposed) return;
        if (contents) {
          // Do not replace an unreadable draft until the user explicitly discards it.
          let recovered: Workspace | undefined;
          try {
            recovered = workspaceFromDocument(parseDocument(contents));
          } catch {
            const discard = await confirmRef.current({
              title: "Recovery draft is invalid",
              message:
                "The recovery draft cannot be opened. Discard it to enable recovery for new changes, or keep it for later.",
              action: "Discard",
              cancelLabel: "Keep",
              allowDismiss: false,
            });
            if (disposed) return;
            if (!discard) {
              setError(
                "Could not restore recovery data: Invalid recovery draft",
              );
              return;
            }
            await invoke("clear_recovery");
          }
          if (recovered) {
            const accept = await confirmRef.current({
              title: "Recover unsaved work?",
              message:
                "A recovery draft was found. Restore it as an unsaved workspace?",
              action: "Recover",
              cancelLabel: "Discard",
              allowDismiss: false,
            });
            if (disposed) return;
            if (accept) restore(recovered);
            else await invoke("clear_recovery");
          }
        }
        if (!disposed) {
          readyRef.current = true;
          setReady(true);
        }
      } catch (cause) {
        if (!disposed)
          setError("Could not restore recovery data: " + String(cause));
      } finally {
        if (!disposed) {
          openingRef.current = false;
          working(false);
          setChecking(false);
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      const task = dirtyRef.current
        ? writeCurrent
        : () => invoke("clear_recovery");
      void enqueue(task).catch((cause) =>
        setError("Could not save recovery data: " + String(cause)),
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [workspace, epoch, ready]);
  return { checking, flush };
}

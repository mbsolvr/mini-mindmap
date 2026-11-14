import { useEffect, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { flushSync } from "react-dom";
import type { MapContent, Workspace } from "../types.ts";
import { makeSvg, pngBase64 } from "../export.ts";
import { toMarkdown } from "../markdown.ts";
import { invoke } from "../tauri.ts";
import { createXmind } from "../xmind.ts";

interface Options {
  workspaceRef: RefObject<Workspace>;
  mapRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLElement | null>;
  zoom: number;
  busyRef: RefObject<boolean>;
  composingRef: RefObject<boolean>;
  finishMotion: () => void;
  working: (value: boolean) => void;
  setEpoch: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string>>;
  setStatus: Dispatch<SetStateAction<string>>;
  t: (text: string) => string;
}
export function useExports({
  workspaceRef,
  mapRef,
  canvasRef,
  zoom,
  busyRef,
  composingRef,
  finishMotion,
  working,
  setEpoch,
  setError,
  setStatus,
  t,
}: Options) {
  const [printDocument, setPrintDocument] = useState<
    (MapContent & { date: string }) | null
  >(null);
  async function exportImage(format: "png" | "svg", clipboard = false) {
    if (busyRef.current || composingRef.current) return;
    finishMotion();
    working(true);
    setError("");
    try {
      if (!mapRef.current || !canvasRef.current)
        throw new Error("Canvas is not ready");
      const { svg, width, height } = makeSvg(
        mapRef.current,
        canvasRef.current,
        zoom,
      );
      const data = format === "svg" ? svg : await pngBase64(svg, width, height);
      if (clipboard) {
        await invoke("copy_png", { data });
        setStatus("PNG copied to clipboard");
      } else if (await invoke("export_file", { format, data }))
        setStatus(`${format.toUpperCase()} image exported`);
    } catch (cause) {
      setError(
        `${clipboard ? "Copy image failed: " : "Image export failed: "}${String(cause)}`,
      );
    } finally {
      working(false);
      setEpoch((value) => value + 1);
    }
  }
  async function exportMarkdown() {
    if (busyRef.current || composingRef.current) return;
    working(true);
    setError("");
    try {
      const map = workspaceRef.current.tabs[workspaceRef.current.active];
      const data = toMarkdown(
        map.tree,
        map.floatingTopics,
        map.floatingNotes,
        t,
      );
      if (await invoke("export_file", { format: "md", data }))
        setStatus("Markdown exported");
    } catch (cause) {
      setError(`Markdown export failed: ${String(cause)}`);
    } finally {
      working(false);
      setEpoch((value) => value + 1);
    }
  }
  async function exportPdf() {
    if (busyRef.current || composingRef.current) return;
    working(true);
    setError("");
    try {
      const now = new Date(),
        date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      flushSync(() =>
        setPrintDocument({
          ...workspaceRef.current.tabs[workspaceRef.current.active],
          date,
        }),
      );
      await Promise.all(
        Array.from(
          document.querySelectorAll<HTMLImageElement>(".print-document img"),
          (image) => image.decode(),
        ),
      );
      if (document.fonts) await document.fonts.ready;
      window.print();
      setStatus("Choose Save to File in the print dialog to export a PDF");
    } catch (cause) {
      setPrintDocument(null);
      setError(`PDF export failed: ${String(cause)}`);
    } finally {
      working(false);
      setEpoch((value) => value + 1);
    }
  }
  async function exportXmind() {
    if (busyRef.current || composingRef.current) return;
    working(true);
    setError("");
    try {
      const editor = document.activeElement;
      if (editor instanceof HTMLElement) flushSync(() => editor.blur());
      const { contents, limited } = await createXmind(workspaceRef.current);
      if (await invoke("export_file", { format: "xmind", data: contents })) {
        setStatus("XMind exported");
        if (limited) setError("Some summaries or connection curves use Mini Mindmap extensions and may look different in XMind.");
      }
    } catch (cause) {
      setError(`XMind export failed: ${String(cause)}`);
    } finally {
      working(false);
      setEpoch(value => value + 1);
    }
  }
  useEffect(() => {
    const clear = () => setPrintDocument(null);
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);
  return { printDocument, exportImage, exportMarkdown, exportPdf, exportXmind };
}

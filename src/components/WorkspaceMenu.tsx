import type React from "react";
import AppMenu from "./AppMenu.tsx";
import { layouts } from "../layouts.ts";

type Props = Omit<React.ComponentProps<typeof AppMenu>, "sections"> & {
  layout: string;
  onNew: () => void | Promise<void>;
  onOpen: () => void | Promise<void>;
  onSave: (as: boolean) => void | Promise<void>;
  importXmind: () => void | Promise<void>;
  exportXmind: () => void | Promise<void>;
  exportMarkdown: () => void | Promise<void>;
  exportImage: (format: "svg" | "png") => void | Promise<void>;
  exportPdf: () => void | Promise<void>;
  onUndo: () => void;
  onRedo: () => void;
  onAddChild: (sibling?: boolean) => void;
  canAddSibling: boolean;
  onAddFloating: (kind: "topic" | "note") => void;
  onAddSummary: () => void;
  canAddSummary: boolean;
  onZoom: (step: number) => void;
  onFit: () => void;
  onResetZoom: () => void;
  onCollapseAll: (collapsed: boolean) => void;
  onLayout: (layout: string) => void;
  onOutline: () => void;
  onSettings: () => void;
};
export default function WorkspaceMenu({
  open,
  setOpen,
  menu,
  setMenu,
  busy,
  layout,
  onNew,
  onOpen,
  onSave,
  importXmind,
  exportXmind,
  exportMarkdown,
  exportImage,
  exportPdf,
  onUndo,
  onRedo,
  onAddChild,
  canAddSibling,
  onAddFloating,
  onAddSummary,
  canAddSummary,
  onZoom,
  onFit,
  onResetZoom,
  onCollapseAll,
  onLayout,
  onOutline,
  onSettings,
}: Props) {
  return (
    <AppMenu
      open={open}
      setOpen={setOpen}
      menu={menu}
      setMenu={setMenu}
      busy={busy}
      sections={[
        ["New workspace", onNew],
        ["Open…", onOpen],
        [
          "File",
          [
            ["Save", () => onSave(false)],
            ["Save As…", () => onSave(true)],
            ["Import XMind…", importXmind],
            ["Export XMind…", exportXmind],
            [
              "Export",
              null,
              [
                ["MD", exportMarkdown],
                ["SVG", () => exportImage("svg")],
                ["PNG", () => exportImage("png")],
                ["PDF", exportPdf],
              ],
            ],
          ],
        ],
        [
          "Edit",
          [
            ["Undo", onUndo, "Ctrl+Z"],
            ["Redo", onRedo, "Ctrl+Y"],
            ["Add Child Topic", () => onAddChild(), "Tab"],
            [
              "Add Sibling Topic",
              canAddSibling ? () => onAddChild(true) : null,
              "Enter",
            ],
            ["Add independent topic", () => onAddFloating("topic")],
            ["Add floating note", () => onAddFloating("note")],
            ["Add summary", canAddSummary ? onAddSummary : null],
          ],
        ],
        [
          "View",
          [
            ["Zoom In", () => onZoom(0.1), "Ctrl++"],
            ["Zoom Out", () => onZoom(-0.1), "Ctrl+-"],
            ["Fit Canvas", onFit],
            ["Reset Zoom", onResetZoom],
            ["Expand All", () => onCollapseAll(false)],
            ["Collapse All", () => onCollapseAll(true)],
          ],
        ],
        [
          "Structure",
          [
            [
              "Layout",
              null,
              layouts.map(([id, label]) => [
                label,
                () => onLayout(id),
                layout === id,
              ]),
            ],
            ["Outline", onOutline],
          ],
        ],
        ["Settings", onSettings],
      ]}
    />
  );
}

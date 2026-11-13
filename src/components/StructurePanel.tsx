import React from "react";
import type { FloatingNote, FloatingTopic, MindNode } from "../types.ts";
import { useT } from "../i18n.ts";

interface OutlineProps {
  node: MindNode;
  selected: string | null;
  onSelect: (key: string, center?: boolean) => void;
  onToggle: (key: string) => void;
  onText: (key: string, text: string) => void;
  onComposition: (active: boolean) => void;
  floatingTopics?: FloatingTopic[];
  floatingNotes?: FloatingNote[];
  onNoteText?: (key: string, text: string) => void;
  onNoteSelect?: (key: string, center?: boolean) => void;
}
interface PanelProps extends Omit<OutlineProps, "node"> {
  tree: MindNode;
  onClose: () => void;
  panelRef: React.RefObject<HTMLElement | null>;
}

function OutlineNode({
  node,
  selected,
  onSelect,
  onToggle,
  onText,
  onComposition,
  floatingTopics = [],
  floatingNotes = [],
  onNoteText,
  onNoteSelect,
}: OutlineProps) {
  const t = useT();
  const hasChildren =
    node.children.length > 0 ||
    floatingTopics.length > 0 ||
    floatingNotes.length > 0;
  return (
    <li>
      <div className={"outline-row" + (selected === node.key ? " active" : "")}>
        <button
          className="outline-toggle"
          disabled={!hasChildren}
          aria-label={t(node.collapsed ? "Expand" : "Collapse")}
          onClick={() => onToggle(node.key)}
        >
          {hasChildren ? (node.collapsed ? "▸" : "▾") : "·"}
        </button>
        <textarea
          rows={1}
          aria-label={t("Topic name")}
          value={node.text}
          placeholder={node.image ? t("Image topic") : t("Empty topic")}
          onFocus={() => onSelect(node.key)}
          onChange={(event) => onText(node.key, event.target.value)}
          onCompositionStart={() => onComposition(true)}
          onCompositionEnd={(event) => {
            onText(node.key, event.currentTarget.value);
            onComposition(false);
          }}
          onKeyDown={(event) => {
            if (
              !event.nativeEvent.isComposing &&
              event.key === "Enter" &&
              !event.shiftKey
            ) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        <button
          aria-label={t("Locate topic")}
          onClick={() => onSelect(node.key, true)}
        >
          ⌖
        </button>
      </div>
      {!node.collapsed && hasChildren && (
        <ul>
          {node.children.map((child) => (
            <OutlineNode
              key={child.key}
              node={child}
              selected={selected}
              onSelect={onSelect}
              onToggle={onToggle}
              onText={onText}
              onComposition={onComposition}
            />
          ))}
          {floatingTopics.map(({ tree }) => (
            <OutlineNode
              key={tree.key}
              node={tree}
              selected={selected}
              onSelect={onSelect}
              onToggle={onToggle}
              onText={onText}
              onComposition={onComposition}
            />
          ))}
          {floatingNotes.map((note) => (
            <li key={note.key}>
              <div className="outline-row">
                <button className="outline-toggle" disabled aria-hidden="true">
                  ·
                </button>
                <textarea
                  rows={1}
                  aria-label={t("Floating note")}
                  value={note.text}
                  placeholder={t("Write a note")}
                  onFocus={() => onNoteSelect?.(note.key)}
                  onChange={(event) =>
                    onNoteText?.(note.key, event.target.value)
                  }
                  onCompositionStart={() => onComposition(true)}
                  onCompositionEnd={(event) => {
                    onNoteText?.(note.key, event.currentTarget.value);
                    onComposition(false);
                  }}
                />
                <button
                  aria-label={t("Locate note")}
                  onClick={() => onNoteSelect?.(note.key, true)}
                >
                  ⌖
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function StructurePanel({
  tree,
  selected,
  onClose,
  onSelect,
  onToggle,
  onText,
  onComposition,
  panelRef,
  floatingTopics,
  floatingNotes,
  onNoteText,
  onNoteSelect,
}: PanelProps) {
  const t = useT();
  return (
    <aside ref={panelRef} className="structure-panel" aria-label={t("Outline")}>
      <div className="structure-heading">
        <strong>{t("Outline")}</strong>
        <button aria-label={t("Close")} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="outline-list">
        <ul>
          <OutlineNode
            node={tree}
            selected={selected}
            onSelect={onSelect}
            onToggle={onToggle}
            onText={onText}
            onComposition={onComposition}
            floatingTopics={floatingTopics}
            floatingNotes={floatingNotes}
            onNoteText={onNoteText}
            onNoteSelect={onNoteSelect}
          />
        </ul>
      </div>
    </aside>
  );
}

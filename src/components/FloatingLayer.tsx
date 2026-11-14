import React, { useEffect, useLayoutEffect, useRef } from "react";
import MindNode from "./MindNode.tsx";
import type { FloatingNote, FloatingTopic, MapContent } from "../types.ts";
import { useT } from "../i18n.ts";
import { textStyleCss } from "../textStyle.ts";

interface Props {
  topics: FloatingTopic[];
  notes: FloatingNote[];
  node: React.ComponentProps<typeof MindNode>;
  zoom: number;
  getDocument: () => MapContent;
  noteFocus: string | null;
  fontSize: number;
  onNoteFocus: () => void;
  onNoteText: (key: string, text: string) => void;
  onNoteMenu: (key: string, x: number, y: number) => void;
  onMove: (kind: "topic" | "note", key: string, x: number, y: number) => void;
}
function FloatingItem({
  x,
  y,
  zoom,
  onMove,
  onSelect,
  onMenu,
  onContextMenu,
  children,
  className,
  noteKey,
  getDocument,
}: {
  x: number;
  y: number;
  zoom: number;
  onMove: (x: number, y: number) => void;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
  children: React.ReactNode;
  className: string;
  noteKey: string;
  getDocument: () => MapContent;
}) {
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
    document: MapContent;
  } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  function cancel() {
    if (!drag.current) return;
    drag.current = null;
    if (ref.current) {
      ref.current.style.left = `${x}px`;
      ref.current.style.top = `${y}px`;
      ref.current.parentElement?.dispatchEvent(new Event("floatingmove"));
    }
  }
  useLayoutEffect(cancel, [zoom]);
  useLayoutEffect(() => {
    if (drag.current && drag.current.document !== getDocument()) cancel();
  });
  useEffect(() => {
    window.addEventListener("blur", cancel);
    window.addEventListener("wheel", cancel, true);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("wheel", cancel, true);
    };
  }, [x, y, zoom]);
  function move(event: React.PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId || !ref.current) return;
    if (start.document !== getDocument()) {
      cancel();
      return;
    }
    if (
      !start.moved &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5
    )
      return;
    start.moved = true;
    ref.current.style.left = `${Math.max(-100000, Math.min(100000, start.left + (event.clientX - start.x) / zoom))}px`;
    ref.current.style.top = `${Math.max(-100000, Math.min(100000, start.top + (event.clientY - start.y) / zoom))}px`;
    ref.current.parentElement?.dispatchEvent(new Event("floatingmove"));
  }
  return (
    <div
      ref={ref}
      className={`floating-object ${className}`}
      data-note-key={noteKey}
      style={{ left: x, top: y }}
      tabIndex={0}
      onPointerDown={(event) => {
        if (
          event.button !== 0 ||
          (event.target instanceof Element &&
            event.target.closest("textarea:focus, button"))
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        (document.activeElement as HTMLElement | null)?.blur();
        event.currentTarget.focus({ preventScroll: true });
        onSelect();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          left: x,
          top: y,
          moved: false,
          document: getDocument(),
        };
      }}
      onPointerMove={move}
      onPointerUp={(event) => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        if (start.document !== getDocument()) {
          cancel();
          return;
        }
        drag.current = null;
        const left = parseFloat(ref.current?.style.left || "0"),
          top = parseFloat(ref.current?.style.top || "0");
        if (start.moved && (left !== x || top !== y)) onMove(left, top);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onDoubleClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("textarea:focus")
        )
          return;
        ref.current?.querySelector("textarea")?.focus({ preventScroll: true });
      }}
      onContextMenu={
        onContextMenu ||
        ((event) => {
          event.preventDefault();
          event.stopPropagation();
          onMenu(event.clientX, event.clientY);
        })
      }
    >
      {children}
    </div>
  );
}
function NoteText({
  note,
  focus,
  fontSize,
  onFocus,
  onText,
}: {
  note: FloatingNote;
  focus: boolean;
  fontSize: number;
  onFocus: () => void;
  onText: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null),
    t = useT();
  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${Math.max(60, ref.current.scrollHeight)}px`;
    }
  }, [note.text, note.textStyle, fontSize]);
  return (
    <textarea
      ref={ref}
      autoFocus={focus}
      style={textStyleCss(note.textStyle)}
      aria-label={t("Floating note")}
      placeholder={t("Write a note")}
      value={note.text}
      onFocus={onFocus}
      onChange={(event) => onText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
export default function FloatingLayer({
  topics,
  notes,
  node,
  zoom,
  getDocument,
  noteFocus,
  fontSize,
  onNoteFocus,
  onNoteText,
  onNoteMenu,
  onMove,
}: Props) {
  return (
    <>
      {topics
        .filter((topic) => !node.summaryKeys?.has(topic.tree.key))
        .map((topic) => (
          <div
            key={topic.tree.key}
            className={`floating-object floating-topic layout-${node.layout}`}
            style={{ left: topic.x, top: topic.y }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              node.handlers.openMenu(
                topic.tree.key,
                event.clientX,
                event.clientY,
              );
            }}
          >
            <MindNode {...node} node={topic.tree} />
          </div>
        ))}
      {notes.map((note) => (
        <FloatingItem
          getDocument={getDocument}
          key={note.key}
          x={note.x}
          y={note.y}
          zoom={zoom}
          className="floating-note"
          noteKey={note.key}
          onSelect={onNoteFocus}
          onMenu={(x, y) => onNoteMenu(note.key, x, y)}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onNoteMenu(note.key, event.clientX, event.clientY);
          }}
          onMove={(x, y) => onMove("note", note.key, x, y)}
        >
          <NoteText
            note={note}
            focus={noteFocus === note.key}
            fontSize={fontSize}
            onFocus={onNoteFocus}
            onText={(text) => onNoteText(note.key, text)}
          />
        </FloatingItem>
      ))}
    </>
  );
}

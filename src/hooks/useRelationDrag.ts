import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { FloatingTopic, MindNode, RelationControls } from "../types.ts";

type Preview = { key: string; controls: RelationControls };

export function useRelationDrag(
  tree: MindNode,
  zoom: number,
  selected: number | null,
  floatingTopics: FloatingTopic[] | undefined,
  onAdjust: (
    key: string,
    controls: RelationControls,
    original: MindNode,
  ) => void,
) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const revision = useRef({ tree, zoom, selected, floatingTopics });
  const current = revision.current;
  if (
    current.tree !== tree ||
    current.zoom !== zoom ||
    current.selected !== selected ||
    current.floatingTopics !== floatingTopics
  )
    revision.current = { tree, zoom, selected, floatingTopics };
  useEffect(() => {
    cancel.current?.();
    return () => cancel.current?.();
  }, [tree, zoom, selected, floatingTopics]);

  function start(
    event: ReactPointerEvent<SVGCircleElement>,
    key: string,
    end: keyof RelationControls,
    controls: RelationControls,
  ) {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    event.stopPropagation();
    cancel.current?.();
    const target = event.currentTarget,
      pointer = event.pointerId;
    const original = revision.current;
    const x = event.clientX,
      y = event.clientY;
    let next = controls,
      moved = false;
    function finish(commit: boolean) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("blur", abort);
      window.removeEventListener("wheel", abort, true);
      target.removeEventListener("lostpointercapture", abort);
      cancel.current = null;
      if (target.hasPointerCapture(pointer))
        target.releasePointerCapture(pointer);
      setPreview(null);
      // Preview never enters document history; a completed gesture is one edit.
      if (
        commit &&
        moved &&
        revision.current === original &&
        (next[end].x !== controls[end].x || next[end].y !== controls[end].y)
      )
        onAdjust(key, next, tree);
    }
    function abort(e?: Event) {
      if (e && "pointerId" in e && e.pointerId !== pointer) return;
      finish(false);
    }
    function move(e: PointerEvent) {
      if (e.pointerId !== pointer) return;
      if (revision.current !== original) {
        abort();
        return;
      }
      const dx = e.clientX - x,
        dy = e.clientY - y;
      if (!moved && Math.hypot(dx, dy) <= 3) return;
      moved = true;
      const clamp = (n: number) => Math.max(-100000, Math.min(100000, n));
      next = {
        ...controls,
        [end]: {
          x: clamp(controls[end].x + dx / zoom),
          y: clamp(controls[end].y + dy / zoom),
        },
      };
      setPreview({ key, controls: next });
    }
    function up(e: PointerEvent) {
      if (e.pointerId !== pointer) return;
      move(e);
      if (cancel.current) finish(true);
    }
    function keyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        abort();
      } else if (
        e.ctrlKey ||
        e.metaKey ||
        e.key === "Delete" ||
        e.key === "Backspace"
      ) {
        // Finish cancelling before a save, undo, or delete observes the document.
        abort();
      }
    }
    cancel.current = abort;
    target.setPointerCapture(pointer);
    target.addEventListener("lostpointercapture", abort);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", abort);
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("blur", abort);
    window.addEventListener("wheel", abort, true);
  }
  return { preview, start };
}

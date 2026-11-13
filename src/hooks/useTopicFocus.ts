import { useLayoutEffect, useRef } from "react";
import type { RefObject, Dispatch, SetStateAction } from "react";
import type { Workspace } from "../types.ts";
interface Options {
  selected: string | null;
  viewKey: object;
  multiKeys: Set<string>;
  focusTarget: string | null;
  setFocusTarget: (key: string | null) => void;
  inputs: RefObject<Map<string, HTMLTextAreaElement>>;
  canvasRef: RefObject<HTMLElement | null>;
  setPan: Dispatch<SetStateAction<{ x: number; y: number }>>;
  workspace: Workspace;
}
export function useTopicFocus({
  selected,
  viewKey,
  multiKeys,
  focusTarget,
  setFocusTarget,
  inputs,
  canvasRef,
  setPan,
  workspace,
}: Options) {
  const lastViewKey = useRef(viewKey);
  useLayoutEffect(() => {
    if (lastViewKey.current !== viewKey) {
      lastViewKey.current = viewKey;
      return;
    }
    const card = selected
      ? inputs.current.get(selected)?.closest(".node")
      : null;
    if (!card || !canvasRef.current || multiKeys.size > 1) return;
    const bounds = card.getBoundingClientRect(),
      viewport = canvasRef.current.getBoundingClientRect(),
      margin = 20;
    const dx =
      bounds.left < viewport.left + margin
        ? viewport.left + margin - bounds.left
        : bounds.right > viewport.right - margin
          ? viewport.right - margin - bounds.right
          : 0;
    const dy =
      bounds.top < viewport.top + margin
        ? viewport.top + margin - bounds.top
        : bounds.bottom > viewport.bottom - margin
          ? viewport.bottom - margin - bounds.bottom
          : 0;
    if (dx || dy) setPan((value) => ({ x: value.x + dx, y: value.y + dy }));
  }, [selected, viewKey]);
  useLayoutEffect(() => {
    if (!focusTarget) return;
    const input = inputs.current.get(focusTarget);
    if (input) {
      input.focus({ preventScroll: true });
      input.select();
    }
    setFocusTarget(null);
  }, [focusTarget, workspace]);
}

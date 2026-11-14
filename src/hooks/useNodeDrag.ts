import { treeIndex } from "../topicIndex.ts";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { containsNode, findNode, tabViewKey, treeForKey } from "../model.ts";
import { moveMapTopics, selectedMapTopics } from "../mapMove.ts";
import { captureNodePositions, animateNodePositions } from "../motion.ts";
import type { MapContent, MindNode, Workspace } from "../types.ts";
type DropTarget = {
  key: string;
  position: "inside" | "before" | "after";
  side: "left" | "right" | null;
};
type Drag = {
  key: string;
  keys: string[];
  offsets: Map<string, { x: number; y: number }>;
  pointer: number;
  x: number;
  y: number;
  moved: boolean;
  area: "invalid" | "blank" | "target";
  target: DropTarget | null;
  tab: number;
  viewKey: object;
  map: MapContent;
  zoom: number;
};
interface Options {
  workspace: Workspace;
  workspaceRef: RefObject<Workspace>;
  changeMap: (map: MapContent) => void;
  multiKeys: Set<string>;
  setMultiKeys: Dispatch<SetStateAction<Set<string>>>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setSelectedRelation: Dispatch<SetStateAction<number | null>>;
  busyRef: RefObject<boolean>;
  composingRef: RefObject<boolean>;
  mapRef: RefObject<HTMLDivElement | null>;
  layout: string;
  zoom: number;
  finishMotion: () => void;
  layoutBefore: RefObject<Map<
    string | undefined,
    { left: number; top: number }
  > | null>;
  animationsRef: RefObject<Animation[]>;
  setStatus: (text: string) => void;
  setError: (text: string) => void;
}
export function useNodeDrag({
  workspace,
  workspaceRef,
  changeMap,
  multiKeys,
  setMultiKeys,
  setSelected,
  setSelectedRelation,
  busyRef,
  composingRef,
  mapRef,
  layout,
  zoom,
  finishMotion,
  layoutBefore,
  animationsRef,
  setStatus,
  setError,
}: Options) {
  const dragRef = useRef<Drag | null>(null),
    ghostRef = useRef<HTMLDivElement>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [canDetach, setCanDetach] = useState(false);
  const [dragGhost, setDragGhost] = useState<{
    x: number;
    y: number;
    keys: string[];
    text: string;
  } | null>(null);
  function dragStart(event: React.PointerEvent<HTMLElement>, key: string) {
    if (event.button !== 0 || busyRef.current || composingRef.current) return;
    const ws = workspaceRef.current,
      map = ws.tabs[ws.active];
    if (!treeForKey(map, key) || key === map.tree.key || !mapRef.current)
      return;
    const requested = multiKeys.has(key) ? Array.from(multiKeys) : [key];
    const summaryKeys = new Set(
      map.tree.summaries?.map((summary) => summary.key),
    );
    if (requested.some((item) => summaryKeys.has(item))) {
      if (!multiKeys.has(key)) setMultiKeys(new Set());
      setSelected(key);
      setSelectedRelation(null);
      return;
    }
    const sources = selectedMapTopics(map, requested);
    if (
      !sources.length ||
      requested.some((item) => item === map.tree.key || !treeForKey(map, item))
    )
      return;
    event.preventDefault();
    finishMotion();
    const keys = sources.map((node) => node.key),
      offsets = new Map<string, { x: number; y: number }>();
    const keySet = new Set(keys);
    for (const card of mapRef.current.querySelectorAll<HTMLElement>(
      "[data-drop-key]",
    ))
      if (card.dataset.dropKey && keySet.has(card.dataset.dropKey)) {
        const root = map.floatingTopics?.some(
          (topic) => topic.tree.key === card.dataset.dropKey,
        )
          ? card.closest(".floating-topic")
          : card.closest(".node-row");
        const r = (root || card).getBoundingClientRect();
        offsets.set(card.dataset.dropKey, {
          x: event.clientX - r.left,
          y: event.clientY - r.top,
        });
      }
    if (offsets.size !== keys.length) {
      setStatus("Some selected topics are not visible");
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!multiKeys.has(key)) setMultiKeys(new Set());
    dragRef.current = {
      key,
      keys,
      offsets,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      area: "invalid",
      target: null,
      tab: ws.active,
      viewKey: tabViewKey(map),
      map,
      zoom,
    };
    setSelected(key);
    setSelectedRelation(null);
  }
  function dragMove(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    if (
      workspaceRef.current.tabs[workspaceRef.current.active] !== drag.map ||
      drag.zoom !== zoom
    ) {
      dragCancel();
      return;
    }
    if (
      !drag.moved &&
      Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5
    )
      return;
    if (!drag.moved) {
      drag.moved = true;
      const tree = treeForKey(
        workspaceRef.current.tabs[workspaceRef.current.active],
        drag.key,
      );
      if (!tree) return;
      setDragGhost({
        keys: drag.keys,
        text: findNode(tree, drag.key)?.text || "",
        x: event.clientX,
        y: event.clientY,
      });
    }
    if (ghostRef.current) {
      ghostRef.current.style.left = `${Math.max(0, Math.min(event.clientX + 16, window.innerWidth - ghostRef.current.offsetWidth - 8))}px`;
      ghostRef.current.style.top = `${Math.max(0, Math.min(event.clientY + 16, window.innerHeight - ghostRef.current.offsetHeight - 8))}px`;
    }
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const element = hit?.closest<HTMLElement>("[data-drop-key]");
    const ws = workspaceRef.current,
      map = ws.tabs[ws.active],
      canvas = mapRef.current?.closest(".canvas");
    const key = element?.dataset.dropKey;
    const sources = drag.keys.map((sourceKey) => {
      const tree = treeForKey(map, sourceKey);
      return tree && findNode(tree, sourceKey);
    });
    if (
      !canvas ||
      !hit ||
      !canvas.contains(hit) ||
      ws.active !== drag.tab ||
      tabViewKey(map) !== drag.viewKey ||
      sources.some((source) => !source)
    ) {
      drag.area = "invalid";
      drag.target = null;
      setCanDetach(false);
      setDropTarget(null);
      return;
    }
    if (!element || !key) {
      drag.area = hit.closest(
        ".floating-note,button,input,textarea,.relation-hit,.relation-label",
      )
        ? "invalid"
        : "blank";
      drag.target = null;
      setCanDetach(drag.area === "blank");
      setDropTarget(null);
      return;
    }
    const targetTree = treeForKey(map, key);
    if (
      !targetTree ||
      sources.some((source) => source && containsNode(source, key))
    ) {
      drag.area = "invalid";
      drag.target = null;
      setCanDetach(false);
      setDropTarget(null);
      return;
    }
    const bounds = element.getBoundingClientRect();
    const fraction = (event.clientY - bounds.top) / bounds.height;
    const position =
      key === targetTree.key
        ? "inside"
        : fraction < 0.15
          ? "before"
          : fraction > 0.85
            ? "after"
            : "inside";
    const side =
      layout === "mindmap" && key === targetTree.key
        ? event.clientX < bounds.left + bounds.width / 2
          ? "left"
          : "right"
        : null;
    drag.area = "target";
    setCanDetach(false);
    if (
      drag.target?.key !== key ||
      drag.target.position !== position ||
      drag.target.side !== side
    ) {
      drag.target = { key, position, side };
      setDropTarget(drag.target);
    }
  }
  function dragEnd(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    if (
      workspaceRef.current.tabs[workspaceRef.current.active] !== drag.map ||
      drag.zoom !== zoom
    ) {
      dragCancel();
      return;
    }
    dragRef.current = null;
    setDropTarget(null);
    setCanDetach(false);
    setDragGhost(null);
    if (!drag.moved) return;
    const ws = workspaceRef.current,
      map = ws.tabs[ws.active];
    if (
      ws.active !== drag.tab ||
      tabViewKey(map) !== drag.viewKey ||
      !mapRef.current
    )
      return;
    let next = map;
    if (drag.area === "target" && drag.target)
      next = moveMapTopics(
        map,
        drag.keys,
        {
          kind: "attach",
          ...drag.target,
          layout,
        },
        () => setError("Keep at least one topic outside its summary"),
        () => setError("This move would create conflicting summaries"),
      );
    else if (drag.area === "blank") {
      const bounds = mapRef.current.getBoundingClientRect(),
        positions = new Map<string, { x: number; y: number }>();
      drag.keys.forEach((key) => {
        const offset = drag.offsets.get(key)!;
        positions.set(key, {
          x: (event.clientX - bounds.left - offset.x) / zoom,
          y: (event.clientY - bounds.top - offset.y) / zoom,
        });
      });
      next = moveMapTopics(
        map,
        drag.keys,
        { kind: "float", positions },
        () => setError("Keep at least one topic outside its summary"),
        () => setError("This move would create conflicting summaries"),
      );
    }
    if (next === map) return;
    function hasImage(node: MindNode): boolean {
      return !!node.image || node.children.some(hasImage);
    }
    const sources = selectedMapTopics(map, drag.keys);
    const touchedKeys = [
      ...drag.keys,
      ...(drag.target ? [drag.target.key] : []),
    ];
    const affected = new Set<string>();
    for (const source of sources)
      for (const key of treeIndex(source).keys()) affected.add(key);
    for (const key of touchedKeys) {
      const tree = treeForKey(map, key);
      if (!tree) continue;
      const index = treeIndex(tree);
      let current: string | null = key;
      while (current) {
        affected.add(current);
        current = index.get(current)?.parent || null;
      }
    }
    const touchesSummary = map.tree.summaries?.some((summary) =>
      [summary.key, ...summary.topics].some((key) => affected.has(key)),
    );
    // shortcut: image and summary drops skip motion until the native flicker is isolated.
    if (mapRef.current && !touchesSummary && !sources.some(hasImage))
      layoutBefore.current = captureNodePositions(mapRef.current);
    else layoutBefore.current = null;
    changeMap(next);
  }
  function dragCancel() {
    dragRef.current = null;
    setDropTarget(null);
    setCanDetach(false);
    setDragGhost(null);
  }
  useLayoutEffect(() => {
    const drag = dragRef.current;
    if (
      drag &&
      (workspace.tabs[workspace.active] !== drag.map || drag.zoom !== zoom)
    )
      dragCancel();
  });
  useEffect(() => {
    window.addEventListener("blur", dragCancel);
    window.addEventListener("wheel", dragCancel, true);
    return () => {
      window.removeEventListener("blur", dragCancel);
      window.removeEventListener("wheel", dragCancel, true);
    };
  }, []);
  useLayoutEffect(() => {
    if (!layoutBefore.current) return;
    const before = layoutBefore.current;
    layoutBefore.current = null;
    if (mapRef.current)
      animationsRef.current = animateNodePositions(
        mapRef.current,
        before,
        zoom,
      );
  }, [workspace, zoom]);
  return {
    dragRef,
    ghostRef,
    dropTarget,
    canDetach,
    dragGhost,
    dragStart,
    dragMove,
    dragEnd,
    dragCancel,
  };
}

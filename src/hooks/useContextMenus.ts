import { useState } from "react";
import type React from "react";
import type { RefObject } from "react";
export type TopicMenuContext = { key: string; x: number; y: number };
interface Options {
  mapRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  selectOne: (key: string | null) => void;
  closeRelationMenu: () => void;
  isMultiSelected: (key: string) => boolean;
}
export function useContextMenus({
  mapRef,
  zoom,
  selectOne,
  closeRelationMenu,
  isMultiSelected,
}: Options) {
  const [context, setContext] = useState<TopicMenuContext | null>(null);
  const [noteContext, setNoteContext] = useState<TopicMenuContext | null>(null);
  const [canvasContext, setCanvasContext] = useState<{
    x: number;
    y: number;
    mapX: number;
    mapY: number;
  } | null>(null);
  function openNodeMenu(key: string, x: number, y: number) {
    if (!isMultiSelected(key)) selectOne(key);
    setNoteContext(null);
    closeRelationMenu();
    setCanvasContext(null);
    setContext({
      key,
      x: x,
      y: y,
    });
  }
  function openNoteMenu(key: string, x: number, y: number) {
    selectOne(null);
    setContext(null);
    closeRelationMenu();
    setCanvasContext(null);
    setNoteContext({
      key,
      x: x,
      y: y,
    });
  }
  function contextMenu(event: React.MouseEvent<HTMLDivElement>, key: string) {
    event.preventDefault();
    event.stopPropagation();
    openNodeMenu(key, event.clientX, event.clientY);
  }
  function canvasContextMenu(event: React.MouseEvent<HTMLElement>) {
    if (
      !(event.target instanceof Element) ||
      event.target.closest(
        ".node,.floating-object,button,input,textarea,.relation-hit,.relation-label",
      ) ||
      !mapRef.current
    )
      return;
    event.preventDefault();
    const bounds = mapRef.current.getBoundingClientRect();
    setContext(null);
    setNoteContext(null);
    closeRelationMenu();
    setCanvasContext({
      x: event.clientX,
      y: event.clientY,
      mapX: Math.max(
        -100000,
        Math.min(100000, (event.clientX - bounds.left) / zoom),
      ),
      mapY: Math.max(
        -100000,
        Math.min(100000, (event.clientY - bounds.top) / zoom),
      ),
    });
  }
  return {
    context,
    setContext,
    noteContext,
    setNoteContext,
    canvasContext,
    setCanvasContext,
    openNodeMenu,
    openNoteMenu,
    contextMenu,
    canvasContextMenu,
  };
}

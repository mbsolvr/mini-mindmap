import { useEffect, useRef, useState } from "react";
import type { RefObject, SetStateAction } from "react";
import { selectionBox, intersects } from "../selection.ts";

type Bounds = { left: number; top: number; right: number; bottom: number };
type PanGesture = {
  pointer: number;
  x: number;
  y: number;
  pan: { x: number; y: number };
  moved: boolean;
  selecting: boolean;
  box: Bounds | null;
};
interface Options {
  viewKey: object;
  inputs: RefObject<Map<string, HTMLTextAreaElement>>;
  finishMotion: () => void;
  isDragging: () => boolean;
  getRootKey: () => string;
  onSelectMany: (keys: string[]) => void;
  onBlank: () => void;
}

export function useCanvas({
  viewKey,
  inputs,
  finishMotion,
  isDragging,
  getRootKey,
  onSelectMany,
  onBlank,
}: Options) {
  const mapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLElement>(null);
  const views = useRef(
    new WeakMap<object, { zoom: number; pan: { x: number; y: number } }>(),
  );
  const activeView = useRef(viewKey),
    generation = useRef(0);
  const [, refresh] = useState(0);
  if (activeView.current !== viewKey) {
    activeView.current = viewKey;
    generation.current++;
  }
  const view = views.current.get(viewKey) || { zoom: 1, pan: { x: 0, y: 0 } };
  const { zoom, pan } = view;
  function setZoom(value: SetStateAction<number>) {
    const key = activeView.current,
      previous = views.current.get(key) || { zoom: 1, pan: { x: 0, y: 0 } };
    const next = typeof value === "function" ? value(previous.zoom) : value;
    if (next !== previous.zoom) {
      views.current.set(key, { ...previous, zoom: next });
      refresh((n) => n + 1);
    }
  }
  function setPan(value: SetStateAction<{ x: number; y: number }>) {
    const key = activeView.current,
      previous = views.current.get(key) || { zoom: 1, pan: { x: 0, y: 0 } };
    const next = typeof value === "function" ? value(previous.pan) : value;
    if (next.x !== previous.pan.x || next.y !== previous.pan.y) {
      views.current.set(key, { ...previous, pan: next });
      refresh((n) => n + 1);
    }
  }
  const panRef = useRef<PanGesture | null>(null);
  const spaceHeld = useRef(false);
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<Bounds | null>(null);

  function adjustZoom(step: number) {
    setZoom((value) =>
      Math.max(0.2, Math.min(2, Math.round((value + step) * 100) / 100)),
    );
  }
  function contentBounds(map: HTMLElement) {
    const rects = [
      map.getBoundingClientRect(),
      ...Array.from(
        map.querySelectorAll<Element>(
          ":scope > .floating-object,.relation-line,.relation-label,.summary-group,.summary-node",
        ),
        (item) => item.getBoundingClientRect(),
      ),
    ];
    const left = Math.min(...rects.map((rect) => rect.left)),
      top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right)),
      bottom = Math.max(...rects.map((rect) => rect.bottom));
    return { left, top, width: right - left, height: bottom - top };
  }
  function fitCanvas() {
    finishMotion();
    const canvas = canvasRef.current,
      map = mapRef.current;
    if (!canvas || !map) return;
    const bounds = contentBounds(map);
    if (!bounds.width || !bounds.height) return;
    const next = Math.max(
      0.2,
      Math.min(
        1.5,
        (canvas.clientWidth - 80) / (bounds.width / zoom),
        (canvas.clientHeight - 80) / (bounds.height / zoom),
      ),
    );
    setZoom(next);
    setPan({ x: 0, y: 0 });
    // A pending frame must not reposition a different tab after a quick switch.
    const currentGeneration = generation.current;
    requestAnimationFrame(() => {
      if (generation.current !== currentGeneration) return;
      const viewport = canvas.getBoundingClientRect(),
        content = contentBounds(map);
      setPan({
        x:
          viewport.left +
          viewport.width / 2 -
          (content.left + content.width / 2),
        y:
          viewport.top +
          viewport.height / 2 -
          (content.top + content.height / 2),
      });
    });
  }
  function centerNode(key: string) {
    const card =
        inputs.current.get(key)?.closest(".node") ||
        mapRef.current?.querySelector(`[data-note-key="${CSS.escape(key)}"]`),
      canvas = canvasRef.current;
    if (!card || !canvas) return;
    const r = card.getBoundingClientRect(),
      view = canvas.getBoundingClientRect();
    setPan((value) => ({
      x: value.x + view.left + view.width / 2 - r.left - r.width / 2,
      y: value.y + view.top + view.height / 2 - r.top - r.height / 2,
    }));
  }
  function panStart(event: React.PointerEvent<HTMLElement>) {
    if (
      event.button !== 0 ||
      (event.target instanceof Element &&
        event.target.closest(".node,.floating-object,button,input,textarea")) ||
      isDragging()
    )
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const selecting = !spaceHeld.current;
    if (selecting) (document.activeElement as HTMLElement)?.blur();
    panRef.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pan,
      moved: false,
      selecting,
      box: null,
    };
    setPanning(!selecting);
  }
  function panMove(event: React.PointerEvent<HTMLElement>) {
    const start = panRef.current;
    if (!start || start.pointer !== event.pointerId) return;
    const dx = event.clientX - start.x,
      dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > 3) start.moved = true;
    if (start.selecting) {
      start.box = selectionBox(start.x, start.y, event.clientX, event.clientY);
      if (start.moved) setMarquee(start.box);
    } else setPan({ x: start.pan.x + dx, y: start.pan.y + dy });
  }
  function panEnd(event: React.PointerEvent<HTMLElement>) {
    const start = panRef.current;
    if (!start || start.pointer !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
    setMarquee(null);
    if (event.type === "pointercancel") return;
    if (
      start.selecting &&
      start.moved &&
      start.box &&
      canvasRef.current &&
      mapRef.current
    ) {
      const viewport = canvasRef.current.getBoundingClientRect(),
        box = start.box;
      const rootKey = getRootKey();
      const keys = Array.from(
        mapRef.current.querySelectorAll(
          "[data-drop-key]",
        ) as NodeListOf<HTMLElement>,
      )
        .filter((card) => {
          if (card.dataset.dropKey === rootKey) return false;
          const r = card.getBoundingClientRect();
          const clipped = {
            left: Math.max(r.left, viewport.left),
            top: Math.max(r.top, viewport.top),
            right: Math.min(r.right, viewport.right),
            bottom: Math.min(r.bottom, viewport.bottom),
          };
          return (
            clipped.left < clipped.right &&
            clipped.top < clipped.bottom &&
            intersects(box, clipped)
          );
        })
        .map((card) => card.dataset.dropKey)
        .filter((key): key is string => !!key);
      onSelectMany(keys);
    } else if (start.selecting && !start.moved) {
      (document.activeElement as HTMLElement)?.blur();
      onBlank();
    }
  }
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function releaseSpace() {
      spaceHeld.current = false;
      canvas!.classList.remove("pan-ready");
    }
    function keyDown(event: KeyboardEvent) {
      if (
        event.code !== "Space" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target instanceof Element &&
          event.target.closest(
            "input,textarea,select,button,[contenteditable]:not([contenteditable='false'])",
          ))
      )
        return;
      event.preventDefault();
      spaceHeld.current = true;
      canvas!.classList.add("pan-ready");
    }
    function keyUp(event: KeyboardEvent) {
      if (event.code === "Space") releaseSpace();
    }
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const scaleX =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? canvas!.clientWidth
            : 1;
      const scaleY =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? canvas!.clientHeight
            : 1;
      const dx = event.deltaX * scaleX,
        dy = event.deltaY * scaleY;
      if (event.ctrlKey) {
        setZoom((value) =>
          Math.max(0.2, Math.min(2, value * Math.exp(-dy * 0.002))),
        );
      } else {
        setPan((value) => ({
          x: value.x - (event.shiftKey && !dx ? dy : dx),
          y: value.y - (event.shiftKey && !dx ? 0 : dy),
        }));
      }
    }
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", releaseSpace);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", releaseSpace);
    };
  }, []);
  return {
    mapRef,
    canvasRef,
    zoom,
    setZoom,
    pan,
    setPan,
    adjustZoom,
    fitCanvas,
    centerNode,
    panRef,
    panning,
    setPanning,
    marquee,
    setMarquee,
    panStart,
    panMove,
    panEnd,
  };
}

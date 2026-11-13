import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { connectorPath } from "../connector.ts";
import type { FloatingTopic, Rect } from "../types.ts";

export default function BranchLayer({
  mapRef,
  layout,
  zoom,
  floatingTopics,
}: {
  mapRef: RefObject<HTMLElement | null>;
  layout: string;
  zoom: number;
  floatingTopics: FloatingTopic[];
}) {
  const pathRef = useRef<SVGPathElement>(null);
  const zoomRef = useRef(zoom);
  const scheduleRef = useRef<(() => void) | null>(null);
  zoomRef.current = zoom;
  useEffect(() => {
    const current = mapRef.current;
    const currentPath = pathRef.current;
    if (!current || !currentPath) return;
    const map: HTMLElement = current;
    const path: SVGPathElement = currentPath;
    let frame = 0;
    let cards: HTMLElement[] = [];
    let branches: {
      parent: HTMLElement;
      child: HTMLElement;
      collapse: HTMLElement | null;
    }[] = [];
    const rects = new Map<HTMLElement, Rect>();
    let animated: HTMLElement[] = [];
    const observer = new ResizeObserver(schedule);

    function watch() {
      cards = Array.from(map.querySelectorAll<HTMLElement>("[data-drop-key]"));
      const rows = new Map(cards.map((card) => [card.parentElement, card]));
      branches = Array.from(
        map.querySelectorAll<HTMLElement>(".children > .branch"),
      ).flatMap((branch) => {
        const row = branch.parentElement?.parentElement,
          parent = row && rows.get(row),
          child = rows.get(branch.firstElementChild as HTMLElement),
          fishboneRoot = row?.parentElement?.matches(
            ".layout-fishbone,.layout-reverse-fishbone",
          );
        return parent && child && row && !fishboneRoot
          ? [{
              parent,
              child,
              collapse: row.querySelector<HTMLElement>(":scope > .collapse"),
            }]
          : [];
      });
      observer.disconnect();
      observer.observe(map);
      cards.forEach((card) => observer.observe(card));
    }
    function update() {
      const origin = map.getBoundingClientRect();
      const scale = zoomRef.current;
      animated.forEach((card) => rects.delete(card));
      animated = (map.getAnimations?.({ subtree: true }) || []).flatMap(
        (animation) => {
          const target = (animation.effect as KeyframeEffect | null)?.target;
          return animation.id === "node-move" &&
            animation.playState === "running" &&
            target instanceof HTMLElement
            ? [target]
            : [];
        },
      );
      animated.forEach((card) => rects.delete(card));
      function rect(element: HTMLElement): Rect {
        let result = rects.get(element);
        if (!result) {
          const bounds = element.getBoundingClientRect();
          result = {
            x: (bounds.left - origin.left) / scale,
            y: (bounds.top - origin.top) / scale,
            width: bounds.width / scale,
            height: bounds.height / scale,
          };
          rects.set(element, result);
        }
        return result;
      }
      const y = (card: HTMLElement, bounds: Rect) =>
        bounds.y +
        bounds.height / 2 +
        (parseFloat(
          card.parentElement?.style.getPropertyValue("--connector-offset") || "",
        ) || 0);
      const paths = branches.map(({ parent, child, collapse }) => {
        const a = rect(parent), b = rect(child);
        const vertical = layout === "org";
        const left = b.x + b.width / 2 < a.x + a.width / 2;
        const start = vertical
          ? { x: a.x + a.width / 2, y: a.y + a.height }
          : { x: left ? a.x : a.x + a.width, y: y(parent, a) };
        const end = vertical
          ? { x: b.x + b.width / 2, y: b.y }
          : { x: left ? b.x + b.width : b.x, y: y(child, b) };
        return connectorPath(
          start, end, vertical, collapse ? rect(collapse) : undefined,
        );
      });
      path.setAttribute("d", paths.join(""));
      if (animated.length) frame = requestAnimationFrame(update);
    }
    function schedule() {
      rects.clear();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }
    scheduleRef.current = schedule;
    const mutations = new MutationObserver((records) => {
      if (
        records.some((record) =>
          [...record.addedNodes, ...record.removedNodes].some(
            (node) => node.nodeType === Node.ELEMENT_NODE,
          ),
        )
      ) watch();
      schedule();
    });
    watch();
    update();
    mutations.observe(map, { childList: true, subtree: true });
    map.addEventListener("floatingmove", schedule);
    return () => {
      mutations.disconnect();
      observer.disconnect();
      map.removeEventListener("floatingmove", schedule);
      cancelAnimationFrame(frame);
      scheduleRef.current = null;
    };
  }, [mapRef, layout]);
  useEffect(() => scheduleRef.current?.(), [zoom, floatingTopics]);
  return (
    <svg className="branch-layer" aria-hidden="true">
      <path ref={pathRef} />
    </svg>
  );
}

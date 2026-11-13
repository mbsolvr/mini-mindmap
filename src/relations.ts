import { findNode, makeKey } from "./model.ts";
import type { MindNode, Point, Rect, RelationControls } from "./types.ts";

export function addRelation(
  tree: MindNode,
  from: string,
  to: string,
  additionalTrees: MindNode[] = [],
): MindNode {
  const exists = (key: string) =>
    !!findNode(tree, key) ||
    additionalTrees.some((root) => !!findNode(root, key));
  if (!from || !to || from === to || !exists(from) || !exists(to)) return tree;
  const relations = Array.isArray(tree.relations) ? tree.relations : [];
  if (
    relations.some(
      (item) =>
        item &&
        ((item.from === from && item.to === to) ||
          (item.from === to && item.to === from)),
    )
  )
    return tree;
  return {
    ...tree,
    relations: [...relations, { relKey: makeKey(), from, to, label: "" }],
  };
}

export function relationCurve(a: Rect, b: Rect, controls?: RelationControls) {
  const ax = a.x + a.width / 2,
    ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2,
    by = b.y + b.height / 2;
  let x1, y1, x2, y2, c1: Point, c2: Point;
  if (Math.abs(bx - ax) >= Math.abs(by - ay)) {
    const sign = bx >= ax ? 1 : -1;
    x1 = sign > 0 ? a.x + a.width : a.x;
    y1 = ay;
    x2 = sign > 0 ? b.x : b.x + b.width;
    y2 = by;
    const bend = Math.max(38, Math.abs(x2 - x1) * 0.45) * sign;
    c1 = { x: x1 + bend, y: y1 };
    c2 = { x: x2 - bend, y: y2 };
  } else {
    const sign = by >= ay ? 1 : -1;
    x1 = ax;
    y1 = sign > 0 ? a.y + a.height : a.y;
    x2 = bx;
    y2 = sign > 0 ? b.y : b.y + b.height;
    const bend = Math.max(38, Math.abs(y2 - y1) * 0.45) * sign;
    c1 = { x: x1, y: y1 + bend };
    c2 = { x: x2, y: y2 - bend };
  }
  if (controls) {
    c1 = { x: ax + controls.start.x, y: ay + controls.start.y };
    c2 = { x: bx + controls.end.x, y: by + controls.end.y };
    // Attach to the edge facing the handle so a curve can leave any side of a topic.
    const edge = (
      rect: Rect,
      cx: number,
      cy: number,
      handle: Point,
      fallback: Point,
    ) => {
      let dx = handle.x - cx,
        dy = handle.y - cy;
      if (!dx && !dy) {
        dx = fallback.x - cx;
        dy = fallback.y - cy;
      }
      const scale = Math.max(
        Math.abs(dx) / (rect.width / 2 || 1),
        Math.abs(dy) / (rect.height / 2 || 1),
      );
      return {
        x: cx + (scale ? dx / scale : 0),
        y: cy + (scale ? dy / scale : 0),
      };
    };
    ({ x: x1, y: y1 } = edge(a, ax, ay, c1, { x: bx, y: by }));
    ({ x: x2, y: y2 } = edge(b, bx, by, c2, { x: ax, y: ay }));
  }
  return {
    d: `M${x1},${y1} C${c1.x},${c1.y} ${c2.x},${c2.y} ${x2},${y2}`,
    x: (x1 + 3 * c1.x + 3 * c2.x + x2) / 8,
    y: (y1 + 3 * c1.y + 3 * c2.y + y2) / 8 - 5,
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    c1,
    c2,
    controls: controls || {
      start: { x: c1.x - ax, y: c1.y - ay },
      end: { x: c2.x - bx, y: c2.y - by },
    },
  };
}

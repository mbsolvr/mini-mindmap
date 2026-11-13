import type { Point, Rect } from "./types.ts";

export function connectorPath(
  start: Point,
  end: Point,
  vertical: boolean,
  collapse?: Rect,
): string {
  const from = vertical ? start.y : start.x;
  const to = vertical ? end.y : end.x;
  const direction = Math.sign(to - from);
  const edge =
    collapse &&
    (vertical
      ? direction > 0 ? collapse.y + collapse.height : collapse.y
      : direction > 0 ? collapse.x + collapse.width : collapse.x);
  const lead =
    edge != null && (edge - from) * direction > 0 && (to - edge) * direction >= 0
      ? edge
      : from;
  const control = lead + (to - lead) / 3;
  return `M${start.x} ${start.y}${lead !== from ? `${vertical ? "V" : "H"}${lead}` : ""}Q${vertical ? end.x : control} ${vertical ? control : end.y} ${end.x} ${end.y}`;
}

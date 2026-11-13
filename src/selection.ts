interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function selectionBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Bounds {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  };
}
export function intersects(a: Bounds, b: Bounds): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

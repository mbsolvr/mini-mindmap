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

// Query vertical overlaps without scanning every unrelated card for each summary.
export function verticalIndex<T extends { top: number; bottom: number }>(items: T[]) {
  const sorted = items.slice().sort((a, b) => a.top - b.top);
  type Branch = { item: T; bottom: number; left: Branch | null; right: Branch | null };
  function build(start: number, end: number): Branch | null {
    if (start >= end) return null;
    const mid = (start + end) >>> 1, left = build(start, mid), right = build(mid + 1, end);
    return { item: sorted[mid], left, right, bottom: Math.max(sorted[mid].bottom, left?.bottom ?? -Infinity, right?.bottom ?? -Infinity) };
  }
  const root = build(0, sorted.length);
  return (top: number, bottom: number): T[] => {
    const matches: T[] = [];
    function visit(branch: Branch | null) {
      if (!branch || branch.bottom <= top) return;
      visit(branch.left);
      if (branch.item.top >= bottom) return;
      if (branch.item.bottom > top) matches.push(branch.item);
      visit(branch.right);
    }
    visit(root);
    return matches;
  };
}

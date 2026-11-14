import type { MapContent, MindNode, RelationControls } from "./types.ts";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TABS = 100;
export const MAX_FILE_TABS = 9999;
export const MAX_RELATIONS = 5000;

export function validateTabCount(count: number, previous = 0): void {
  if (count > MAX_TABS && count > previous)
    throw new Error("A workspace can contain at most 100 tabs");
}

export function validateFileTabCount(count: number): void {
  if (count > MAX_FILE_TABS)
    throw new Error("A workspace file can contain at most 9999 tabs");
}

export function validateRelationCount(count: number): void {
  if (count > MAX_RELATIONS)
    throw new Error("A map can contain at most 5000 connections");
}

export function validRelationControls(
  value: unknown,
): value is RelationControls {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const controls = value as Record<string, unknown>;
  return [controls.start, controls.end].every((point) => {
    if (!point || typeof point !== "object" || Array.isArray(point))
      return false;
    const { x, y } = point as Record<string, unknown>;
    return [x, y].every(
      (n) =>
        typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 100000,
    );
  });
}

export function validateMapLimits(map: MapContent): void {
  validateRelationCount(map.tree.relations?.length || 0);
  if ((map.tree.summaries?.length || 0) > 5000)
    throw new Error("Invalid summary data");
  let count = map.floatingNotes?.length || 0;
  function visit(node: MindNode, depth: number) {
    if (++count > 5000 || depth > 100)
      throw new Error("A map can contain at most 5000 objects and 100 levels");
    node.children.forEach((child) => visit(child, depth + 1));
  }
  visit(map.tree, 0);
  map.floatingTopics?.forEach((topic) => visit(topic.tree, 0));
}

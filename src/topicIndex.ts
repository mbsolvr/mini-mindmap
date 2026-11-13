import type { MapContent, MindNode } from "./types.ts";

type Entry = { node: MindNode; parent: string | null; depth: number; height: number };
const trees = new WeakMap<MindNode, Map<string, Entry>>();
export function treeIndex(root: MindNode) {
  let index = trees.get(root);
  if (index) return index;
  index = new Map();
  function visit(node: MindNode, parent: string | null, depth: number): number {
    const entry = { node, parent, depth, height: 0 };
    index!.set(node.key, entry);
    for (const child of node.children)
      entry.height = Math.max(entry.height, 1 + visit(child, node.key, depth + 1));
    return entry.height;
  }
  visit(root, null, 0);
  trees.set(root, index);
  return index;
}
const maps = new WeakMap<MindNode, { floating: MapContent["floatingTopics"]; owners: Map<string, MindNode> }>();
export function treeOwners(map: MapContent) {
  const cached = maps.get(map.tree);
  if (cached && cached.floating === map.floatingTopics) return cached.owners;
  const owners = new Map<string, MindNode>();
  for (const root of [map.tree, ...(map.floatingTopics || []).map((topic) => topic.tree)])
    for (const key of treeIndex(root).keys()) owners.set(key, root);
  maps.set(map.tree, { floating: map.floatingTopics, owners });
  return owners;
}

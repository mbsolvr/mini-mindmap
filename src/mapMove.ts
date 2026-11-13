import {
  containsNode,
  findNode,
  findParent,
  moveNodes,
  setRootBranchSides,
  treeForKey,
  updateNode,
} from "./model.ts";
import type { MapContent, MindNode } from "./types.ts";
import { hasSummaryConflict, settleSummaries } from "./summaries.ts";

type Position = { x: number; y: number };
export type MapDrop =
  | {
      kind: "attach";
      key: string;
      position: "inside" | "before" | "after";
      side: "left" | "right" | null;
      layout: string;
    }
  | { kind: "float"; positions: Map<string, Position> };

export function selectedMapTopics(
  map: MapContent,
  keys: Iterable<string>,
): MindNode[] {
  const selected = new Set(keys),
    result: MindNode[] = [];
  function walk(node: MindNode, ancestor: boolean, primary: boolean) {
    const include = !primary && selected.has(node.key) && !ancestor;
    if (include) result.push(node);
    node.children.forEach((child) => walk(child, ancestor || include, false));
  }
  walk(map.tree, false, true);
  map.floatingTopics?.forEach((topic) => walk(topic.tree, false, false));
  return result;
}

export function moveMapTopics(
  map: MapContent,
  keys: string[],
  drop: MapDrop,
  onEmptySummary?: () => void,
  onSummaryConflict?: () => void,
): MapContent {
  if (
    !keys.length ||
    keys.includes(map.tree.key) ||
    keys.some((key) => map.tree.summaries?.some((summary) => summary.key === key)) ||
    keys.some((key) => !treeForKey(map, key))
  )
    return map;
  // Move a selected subtree once even when both its parent and descendants are selected.
  const sources = selectedMapTopics(map, keys);
  if (!sources.length) return map;
  const sourceKeys = new Set(sources.map((node) => node.key));
  function finish(next: MapContent): MapContent {
    const summaries = next.tree.summaries;
    if (!summaries?.length) return next;
    const kept = [];
    for (const summary of summaries) {
      const owner = treeForKey(next, summary.key);
      const node = owner && findNode(owner, summary.key);
      if (!node) continue;
      const topics = summary.topics.filter((key) => !containsNode(node, key));
      if (!topics.length) {
        onEmptySummary?.();
        return map;
      }
      kept.push(topics.length === summary.topics.length ? summary : { ...summary, topics });
    }
    const settled = settleSummaries(
      kept.length === summaries.length && kept.every((summary, index) => summary === summaries[index])
        ? next
        : { ...next, tree: { ...next.tree, summaries: kept } },
    );
    if (!settled || hasSummaryConflict(settled)) {
      onSummaryConflict?.();
      return map;
    }
    return settled;
  }
  if (drop.kind === "attach") {
    const targetTree = treeForKey(map, drop.key),
      target = targetTree && findNode(targetTree, drop.key);
    if (
      !targetTree ||
      !target ||
      sources.some((source) => containsNode(source, drop.key))
    )
      return map;
    if (targetTree.key === drop.key && drop.position !== "inside") return map;
    const sourceTree = treeForKey(map, sources[0].key);
    if (
      sourceTree === targetTree &&
      sources.every((source) => treeForKey(map, source.key) === sourceTree) &&
      !sourceKeys.has(sourceTree.key)
    ) {
      let tree = moveNodes(
        sourceTree,
        sources.map((source) => source.key),
        drop.key,
        drop.position,
      );
      const side =
        drop.layout === "mindmap" &&
        drop.position === "inside" &&
        drop.key === tree.key
          ? drop.side
          : drop.layout === "mindmap" &&
              drop.position !== "inside" &&
              findParent(targetTree, drop.key) === targetTree.key
            ? target.side === "left"
              ? "left"
              : "right"
            : null;
      if (side)
        tree = setRootBranchSides(
          tree,
          sources.map((source) => source.key),
          side,
        );
      if (tree === sourceTree || tooDeep(tree, 0)) return map;
      return finish(
        sourceTree === map.tree
          ? { ...map, tree }
          : {
              ...map,
              floatingTopics: map.floatingTopics?.map((topic) =>
                topic.tree === sourceTree ? { ...topic, tree } : topic,
              ),
            },
      );
    }
  } else if (
    sources.some((source) => {
      const p = drop.positions.get(source.key);
      return (
        !p ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.abs(p.x) > 100000 ||
        Math.abs(p.y) > 100000
      );
    })
  )
    return map;

  // Remove sources from all trees before attaching them elsewhere or making them independent.
  function remove(node: MindNode): MindNode {
    const children = node.children
      .filter((child) => !sourceKeys.has(child.key))
      .map(remove);
    return children.length === node.children.length &&
      children.every((child, i) => child === node.children[i])
      ? node
      : { ...node, children };
  }
  let tree = remove(map.tree);
  let floatingTopics = (map.floatingTopics || [])
    .filter((topic) => !sourceKeys.has(topic.tree.key))
    .map((topic) => ({ ...topic, tree: remove(topic.tree) }));
  if (drop.kind === "float") {
    floatingTopics = [
      ...floatingTopics,
      ...sources.map((source) => ({
        ...drop.positions.get(source.key)!,
        tree: source,
      })),
    ];
  } else {
    const targetTree = treeForKey(map, drop.key)!;
    const target = findNode(targetTree, drop.key)!;
    const parentKey =
      drop.position === "inside" ? drop.key : findParent(targetTree, drop.key);
    if (!parentKey) return map;
    const side =
      drop.layout === "mindmap" && parentKey === targetTree.key
        ? drop.position === "inside"
          ? drop.side
          : target.side === "left"
            ? "left"
            : "right"
        : null;
    const additions = side
      ? sources.map((source) => ({ ...source, side }))
      : sources;
    const insert = (node: MindNode) => {
      const children = node.children.slice();
      const index =
        drop.position === "inside"
          ? children.length
          : children.findIndex((child) => child.key === drop.key) +
            (drop.position === "after" ? 1 : 0);
      if (index < 0) return node;
      children.splice(index, 0, ...additions);
      return { ...node, collapsed: false, children };
    };
    if (targetTree === map.tree) tree = updateNode(tree, parentKey, insert);
    else
      floatingTopics = floatingTopics.map((topic) =>
        topic.tree.key === targetTree.key
          ? { ...topic, tree: updateNode(topic.tree, parentKey, insert) }
          : topic,
      );
  }
  function tooDeep(node: MindNode, depth: number): boolean {
    return (
      depth > 100 || node.children.some((child) => tooDeep(child, depth + 1))
    );
  }
  if (
    tooDeep(tree, 0) ||
    floatingTopics.some((topic) => tooDeep(topic.tree, 0))
  )
    return map;
  const next = { ...map, tree, floatingTopics };
  return JSON.stringify(next) === JSON.stringify(map) ? map : finish(next);
}

import type { FloatingTopic, MapContent, MindNode } from "./types.ts";
import {
  containsNode,
  findNode,
  findParent,
  treeForKey,
  updateNode,
} from "./model.ts";
import { hasSummaryOverlap, summaryIndex } from "./summaryConflicts.ts";

export function prepareSummaryTopics(map: MapContent, topics: string[]): string[] | null {
  topics = topics.filter((key) => key !== map.tree.key);
  const index = summaryIndex(map);
  const normalized = index.normalize(topics);
  if (normalized.length < 2 || index.oppositeSides(normalized) ||
      hasSummaryOverlap(map, topics) || hasSummaryOverlap(map, normalized))
    return null;
  return normalized;
}

export function hasSummaryConflict(map: MapContent): boolean {
  if (!map.tree.summaries?.length) return false;
  const index = summaryIndex(map);
  return hasSummaryOverlap(map) || map.tree.summaries.some((summary) => index.oppositeSides(summary.topics));
}

export function settleSummaries(map: MapContent): MapContent | null {
  const summaries = map.tree.summaries;
  if (!summaries?.length) return map;
  const index = summaryIndex(map);
  const normalized = summaries.map((summary) => {
    const topics = index.normalize(summary.topics, false);
    return topics.length === summary.topics.length && topics.every((key, n) => key === summary.topics[n])
      ? summary : { ...summary, topics };
  });
  if (normalized.some((summary) => !summary.topics.length)) return null;
  const next = normalized.every((summary, n) => summary === summaries[n])
    ? map : { ...map, tree: { ...map.tree, summaries: normalized } };
  return alignSummaryLevels(next);
}

export function createSummary(
  map: MapContent,
  topics: string[],
  key: string,
  text: string,
): MapContent {
  const normalized = prepareSummaryTopics(map, topics);
  if (!normalized) return map;
  topics = normalized;
  let anchor:
    | { node: MindNode; parent: string | null; depth: number; floating: number }
    | undefined;
  function visit(
    node: MindNode,
    parent: string | null,
    depth: number,
    floating: number,
  ) {
    if (topics.includes(node.key) && (!anchor || depth < anchor.depth))
      anchor = { node, parent, depth, floating };
    node.children.forEach((child) =>
      visit(child, node.key, depth + 1, floating),
    );
  }
  visit(map.tree, null, 0, -1);
  map.floatingTopics?.forEach((topic, index) =>
    visit(topic.tree, null, 0, index),
  );
  if (!anchor) return map;
  const chosen = anchor as {
    node: MindNode;
    parent: string | null;
    depth: number;
    floating: number;
  };
  const node: MindNode = {
    key,
    text,
    children: [],
    ...(chosen.node.side ? { side: chosen.node.side } : {}),
  };
  let tree = map.tree;
  let floatingTopics = map.floatingTopics;
  if (chosen.parent && chosen.floating < 0)
    tree = updateNode(tree, chosen.parent, (parent) => ({
      ...parent,
      children: [...parent.children, node],
    }));
  else if (chosen.parent)
    floatingTopics = floatingTopics!.map((topic, i) =>
      i === chosen.floating
        ? {
            ...topic,
            tree: updateNode(topic.tree, chosen.parent!, (parent) => ({
              ...parent,
              children: [...parent.children, node],
            })),
          }
        : topic,
    );
  else if (chosen.floating >= 0) {
    const origin = floatingTopics![chosen.floating];
    floatingTopics = [
      ...floatingTopics!,
      { x: Math.min(100000, origin.x + 120), y: origin.y, tree: node },
    ];
  } else return map;
  tree = { ...tree, summaries: [...(tree.summaries || []), { key, topics }] };
  return { ...map, tree, ...(floatingTopics ? { floatingTopics } : {}) };
}

export function nodeDepth(map: MapContent, key: string): number {
  function find(node: MindNode, depth: number): number {
    if (node.key === key) return depth;
    for (const child of node.children) {
      const found = find(child, depth + 1);
      if (found >= 0) return found;
    }
    return -1;
  }
  const root = find(map.tree, 0);
  if (root >= 0) return root;
  for (const topic of map.floatingTopics || []) {
    const found = find(topic.tree, 0);
    if (found >= 0) return found;
  }
  return 0;
}

export function alignSummaryLevels(map: MapContent): MapContent {
  let result = map;
  for (const summary of map.tree.summaries || []) {
    const target = summary.topics.reduce((best, key) =>
      nodeDepth(result, key) < nodeDepth(result, best) ? key : best,
    );
    if (nodeDepth(result, summary.key) === nodeDepth(result, target)) continue;
    const sourceTree = treeForKey(result, summary.key),
      targetTree = treeForKey(result, target);
    const topic = sourceTree && findNode(sourceTree, summary.key);
    if (!sourceTree || !targetTree || !topic || containsNode(topic, target))
      continue;
    function height(node: MindNode): number {
      return node.children.length ? 1 + Math.max(...node.children.map(height)) : 0;
    }
    if (nodeDepth(result, target) + height(topic) > 100) continue;
    const parent = findParent(targetTree, target);
    if (!parent && targetTree === result.tree) continue;
    function remove(node: MindNode): MindNode {
      const children = node.children
        .filter((child) => child.key !== summary.key)
        .map(remove);
      return children.length === node.children.length &&
        children.every((child, i) => child === node.children[i])
        ? node
        : { ...node, children };
    }
    let tree = remove(result.tree);
    let floatingTopics = (result.floatingTopics || [])
      .filter((item) => item.tree.key !== summary.key)
      .map((item) => ({ ...item, tree: remove(item.tree) }));
    if (parent) {
      const attach = (node: MindNode) =>
        updateNode(node, parent, (item) => ({
          ...item,
          children: [...item.children, topic],
        }));
      if (targetTree === result.tree) tree = attach(tree);
      else
        floatingTopics = floatingTopics.map((item) =>
          item.tree.key === targetTree.key
            ? { ...item, tree: attach(item.tree) }
            : item,
        );
    } else {
      const origin = result.floatingTopics!.find(
        (item) => item.tree.key === targetTree.key,
      )!;
      floatingTopics.push({
        x: Math.min(100000, origin.x + 120),
        y: origin.y,
        tree: topic,
      });
    }
    result = { ...result, tree, floatingTopics };
  }
  return result;
}

export function summaryTopicNames(
  tree: MindNode,
  floatingTopics: FloatingTopic[] = [],
) {
  const names = new Map<string, string>();
  function visit(node: MindNode) {
    names.set(node.key, node.text);
    node.children.forEach(visit);
  }
  visit(tree);
  floatingTopics.forEach((topic) => visit(topic.tree));
  return names;
}

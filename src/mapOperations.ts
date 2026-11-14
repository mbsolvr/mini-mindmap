import type { MapContent, MindNode } from "./types.ts";
import { findNode, treeForKey } from "./model.ts";
import { settleSummaries } from "./summaries.ts";

export function removeMapTopics(
  map: MapContent,
  keys: ReadonlySet<string>,
): MapContent {
  let next = removeOnce(map, keys);
  if (next === map) return map;
  const orphans = (next.tree.summaries || []).filter(
    (summary) => !summary.topics.length,
  );
  if (orphans.length)
    next = removeOnce(next, new Set(orphans.map((summary) => summary.key)));
  return settleSummaries(next) || map;
}

function removeOnce(map: MapContent, keys: ReadonlySet<string>): MapContent {
  const removed = new Set<string>();
  function collect(node: MindNode) {
    removed.add(node.key);
    node.children.forEach(collect);
  }
  function prune(node: MindNode): MindNode | null {
    if (node.key !== map.tree.key && keys.has(node.key)) {
      collect(node);
      return null;
    }
    const children = node.children
      .map(prune)
      .filter((child): child is MindNode => child !== null);
    return children.length === node.children.length &&
      children.every((child, i) => child === node.children[i])
      ? node
      : { ...node, children };
  }
  const tree = prune(map.tree)!;
  let floatingTopics = map.floatingTopics?.flatMap((topic) => {
    const next = prune(topic.tree);
    return next ? [next === topic.tree ? topic : { ...topic, tree: next }] : [];
  });
  if (!removed.size) return map;
  const rescued = (map.tree.summaries || [])
    .filter((summary) => removed.has(summary.key) && !keys.has(summary.key))
    .map((summary) => {
      const owner = treeForKey(map, summary.key);
      return owner && findNode(owner, summary.key);
    })
    .filter((node): node is MindNode => !!node);
  for (const node of rescued) {
    const kept = prune(node);
    if (!kept) continue;
    function restore(item: MindNode) {
      removed.delete(item.key);
      item.children.forEach(restore);
    }
    restore(kept);
    floatingTopics = [...(floatingTopics || []), { x: 0, y: 0, tree: kept }];
  }
  return {
    ...map,
    tree: {
      ...tree,
      ...(tree.relations
        ? {
            relations: tree.relations.filter(
              (link) => !removed.has(link.from) && !removed.has(link.to),
            ),
          }
        : {}),
      ...(tree.summaries
        ? {
            summaries: tree.summaries
              .filter((summary) => !removed.has(summary.key))
              .map((summary) => ({
                ...summary,
                topics: summary.topics.filter((key) => !removed.has(key)),
              })),
          }
        : {}),
    },
    ...(floatingTopics ? { floatingTopics } : {}),
  };
}

export function removeMapTopic(map: MapContent, key: string): MapContent {
  return removeMapTopics(map, new Set([key]));
}

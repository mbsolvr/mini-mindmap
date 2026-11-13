import type { MapContent, MindNode } from "./types.ts";
import { resolveLayout } from "./layouts.ts";

type TopicInfo = {
  node: MindNode;
  parent: TopicInfo | null;
  root: string;
  side: "left" | "right" | null;
  group: string;
  start: number;
  end: number;
  order: number;
};

const indexes = new WeakMap<MindNode, { floating: MapContent["floatingTopics"]; index: ReturnType<typeof buildSummaryIndex> }>();
export function summaryIndex(map: MapContent) {
  const cached = indexes.get(map.tree);
  if (cached && cached.floating === map.floatingTopics) return cached.index;
  const index = buildSummaryIndex(map);
  indexes.set(map.tree, { floating: map.floatingTopics, index });
  return index;
}
function buildSummaryIndex(map: MapContent) {
  const nodes = new Map<string, TopicInfo>();
  const groups = new Map<string, TopicInfo[]>();
  const summaryKeys = new Set(map.tree.summaries?.map((summary) => summary.key));
  const splitSides = resolveLayout(map.tree.layout) === "mindmap";
  function visit(
    node: MindNode,
    parent: TopicInfo | null,
    root: string,
    side: "left" | "right" | null,
    region: string,
  ) {
    const group = JSON.stringify([root, side, region]);
    let entries = groups.get(group);
    if (!entries) groups.set(group, (entries = []));
    const info: TopicInfo = {
      node, parent, root, side, group,
      start: entries.length, end: entries.length, order: nodes.size,
    };
    entries.push(info);
    nodes.set(node.key, info);
    for (const child of node.children) {
      const childSide = !parent && splitSides
        ? child.side === "left" ? "left" : "right"
        : side;
      // A summary title renders outside its parent branch and starts a separate ordering region.
      visit(child, info, root, childSide, summaryKeys.has(child.key) ? child.key : region);
    }
    info.end = entries.length - 1;
  }
  visit(map.tree, null, map.tree.key, null, map.tree.key);
  map.floatingTopics?.forEach(({ tree }) => visit(tree, null, tree.key, null, tree.key));

  function normalize(keys: string[], removeDescendants = true) {
    const selected = new Set(keys.filter((key) => nodes.has(key)));
    function deduplicate() {
      for (const key of selected) {
        let parent = nodes.get(key)!.parent;
        while (parent) {
          if (selected.has(parent.node.key)) {
            selected.delete(key);
            break;
          }
          parent = parent.parent;
        }
      }
    }
    if (removeDescendants) deduplicate();
    const ancestors = new Set<string>();
    const chosen = new Map<string, TopicInfo[]>();
    for (const key of selected) {
      const info = nodes.get(key)!;
      let parent = info.parent;
      while (parent) {
        ancestors.add(parent.node.key);
        parent = parent.parent;
      }
      const items = chosen.get(info.group) || [];
      items.push(info);
      chosen.set(info.group, items);
    }
    for (const [group, items] of chosen) {
      if (items.length < 2) continue;
      const start = Math.min(...items.map((item) => item.start));
      const end = Math.max(...items.map((item) => item.end));
      for (const info of groups.get(group)!) {
        if (info.start < start || info.end > end || ancestors.has(info.node.key)) continue;
        let parent = info.parent;
        while (parent && !selected.has(parent.node.key)) parent = parent.parent;
        if (!parent) selected.add(info.node.key);
      }
    }
    if (removeDescendants) deduplicate();
    const ordered = [...selected].sort((a, b) => nodes.get(a)!.order - nodes.get(b)!.order);
    if (removeDescendants) return ordered;
    // Reparenting must not reorder existing members in the saved summary.
    const original = keys.filter((key) => selected.has(key));
    if (original.every((key, n) => !n || nodes.get(original[n - 1])!.order < nodes.get(key)!.order))
      return ordered;
    const originalKeys = new Set(keys);
    return [...original, ...ordered.filter((key) => !originalKeys.has(key))];
  }
  function oppositeSides(keys: string[]) {
    const sides = new Map<string, "left" | "right">();
    for (const key of keys) {
      const info = nodes.get(key);
      if (!info?.side) continue;
      const prior = sides.get(info.root);
      if (prior && prior !== info.side) return true;
      sides.set(info.root, info.side);
    }
    return false;
  }
  return { normalize, oppositeSides };
}


export function hasSummaryOverlap(map: MapContent, topics?: string[]): boolean {
  const summaries = map.tree.summaries || [];
  if (!summaries.length) return false;
  const summaryKeys = new Set(summaries.map((summary) => summary.key));
  const members = new Map<string, number>();
  const groups = summaries.map((summary) => summary.topics);
  if (topics) groups.push(topics);
  for (const [index, group] of groups.entries()) {
    for (const key of group) {
      const owner = members.get(key);
      if (owner !== undefined && owner !== index) return true;
      members.set(key, index);
    }
  }
  function visit(node: MindNode, owner?: number, insideSummary = false): boolean {
    const member = members.get(node.key);
    if (summaryKeys.has(node.key)) {
      if (insideSummary || member !== undefined) return true;
      return node.children.some((child) => visit(child, undefined, true));
    }
    if (member !== undefined && (insideSummary || (owner !== undefined && owner !== member)))
      return true;
    return node.children.some((child) => visit(child, member ?? owner, insideSummary));
  }
  return visit(map.tree) || !!map.floatingTopics?.some(({ tree }) => visit(tree));
}

import type {
  MindNode,
  MapDocument,
  MapContent,
  Workspace,
  Document,
} from "./types.ts";
import { makeKey } from "./ids.ts";
export { makeKey } from "./ids.ts";

// Keep view identity stable across immutable edits without saving viewport state to the file.
const tabViews = new WeakMap<Workspace["tabs"][number], object>();
export function tabViewKey(tab: Workspace["tabs"][number]): object {
  let key = tabViews.get(tab);
  if (!key) {
    key = {};
    tabViews.set(tab, key);
  }
  return key;
}
export function tabWithTree(
  tab: Workspace["tabs"][number],
  tree: MindNode,
): Workspace["tabs"][number] {
  return tabWithContent(tab, { tree });
}
export function tabWithContent(
  tab: Workspace["tabs"][number],
  patch: Partial<MapContent>,
): Workspace["tabs"][number] {
  const next = { ...tab, ...patch };
  tabViews.set(next, tabViewKey(tab));
  return next;
}

export function newDocument(title = "Central Topic"): MapDocument {
  return {
    format: "mini-mindmap",
    version: 2,
    type: "map",
    tree: { key: makeKey(), text: title, collapsed: false, children: [] },
  };
}

export { parseDocument } from "./document.ts";

export function workspaceFromDocument(data: Document): Workspace {
  if (data.type === "workspace") return data;
  const { tree, floatingTopics, floatingNotes } = data;
  return {
    format: "mini-mindmap",
    version: 2,
    type: "workspace",
    active: 0,
    tabs: [
      {
        tree,
        ...(floatingTopics?.length ? { floatingTopics } : {}),
        ...(floatingNotes?.length ? { floatingNotes } : {}),
      },
    ],
  };
}

export function serializeWorkspace(workspace: Workspace): string {
  if (workspace.tabs.length > 1)
    return snapshot({
      format: "mini-mindmap",
      version: 2,
      type: "workspace",
      active: workspace.active,
      tabs: workspace.tabs,
    });
  return snapshot({
    format: "mini-mindmap",
    version: 2,
    type: "map",
    ...workspace.tabs[0],
  });
}

export function updateNode(
  node: MindNode,
  key: string,
  fn: (node: MindNode) => MindNode,
): MindNode {
  if (node.key === key) return fn(node);
  const children = node.children.map((child) => updateNode(child, key, fn));
  return children.every((child, index) => child === node.children[index])
    ? node
    : { ...node, children };
}
export function setAllCollapsed(
  node: MindNode,
  collapsed: boolean,
  root = true,
): MindNode {
  const children = node.children.map((child) =>
    setAllCollapsed(child, collapsed, false),
  );
  const next = root ? false : collapsed;
  if (
    (!node.children.length || !!node.collapsed === next) &&
    children.every((child, i) => child === node.children[i])
  )
    return node;
  return {
    ...node,
    ...(node.children.length ? { collapsed: next } : {}),
    children,
  };
}
export function containsNode(node: MindNode, key: string): boolean {
  return (
    node.key === key || node.children.some((child) => containsNode(child, key))
  );
}
export function treeForKey(map: MapContent, key: string): MindNode | null {
  if (containsNode(map.tree, key)) return map.tree;
  return (
    map.floatingTopics?.find((topic) => containsNode(topic.tree, key))?.tree ||
    null
  );
}
export function findParent(node: MindNode, key: string): string | null {
  for (const child of node.children) {
    if (child.key === key) return node.key;
    const found = findParent(child, key);
    if (found) return found;
  }
  return null;
}
export function findNode(node: MindNode, key: string): MindNode | null {
  if (node.key === key) return node;
  for (const child of node.children) {
    const found = findNode(child, key);
    if (found) return found;
  }
  return null;
}
export function removeNode(tree: MindNode, key: string): MindNode {
  const parent = findParent(tree, key);
  const removed = findNode(tree, key);
  if (!parent || !removed) return tree;
  const next = updateNode(tree, parent, (node) => ({
    ...node,
    children: node.children.filter((child) => child.key !== key),
  }));
  if (!Array.isArray(next.relations)) return next;
  const keys = new Set<string>();
  function collect(node: MindNode) {
    keys.add(node.key);
    node.children.forEach(collect);
  }
  collect(removed);
  const relations = next.relations.filter(
    (relation) => !keys.has(relation?.from) && !keys.has(relation?.to),
  );
  return relations.length === next.relations.length
    ? next
    : { ...next, relations };
}
export function moveNode(
  tree: MindNode,
  sourceKey: string,
  targetKey: string,
  position: string,
): MindNode {
  if (
    !["inside", "before", "after"].includes(position) ||
    sourceKey === tree.key ||
    sourceKey === targetKey
  )
    return tree;
  const source = findNode(tree, sourceKey);
  const target = findNode(tree, targetKey);
  if (!source || !target || containsNode(source, targetKey)) return tree;
  const oldParentKey = findParent(tree, sourceKey);
  const newParentKey =
    position === "inside" ? targetKey : findParent(tree, targetKey);
  if (!oldParentKey || !newParentKey) return tree;
  const oldParent = findNode(tree, oldParentKey);
  if (!oldParent) return tree;
  if (oldParentKey === newParentKey) {
    const current = oldParent.children.map((child) => child.key);
    const next = current.filter((key) => key !== sourceKey);
    const index =
      position === "inside"
        ? next.length
        : next.indexOf(targetKey) + (position === "after" ? 1 : 0);
    next.splice(index, 0, sourceKey);
    if (
      current.every((key, i) => key === next[i]) &&
      !(position === "inside" && oldParent.collapsed)
    )
      return tree;
  }
  const without = updateNode(tree, oldParentKey, (parent) => ({
    ...parent,
    children: parent.children.filter((child) => child.key !== sourceKey),
  }));
  return updateNode(without, newParentKey, (parent) => {
    const children = parent.children.slice();
    const index =
      position === "inside"
        ? children.length
        : children.findIndex((child) => child.key === targetKey) +
          (position === "after" ? 1 : 0);
    children.splice(index, 0, source);
    return { ...parent, collapsed: false, children };
  });
}
export function topLevelSelection(
  tree: MindNode,
  keys: Iterable<string>,
): MindNode[] {
  const selected = new Set(keys),
    result: MindNode[] = [];
  function visit(node: MindNode, ancestorSelected: boolean) {
    const include =
      node !== tree && selected.has(node.key) && !ancestorSelected;
    if (include) result.push(node);
    node.children.forEach((child) => visit(child, ancestorSelected || include));
  }
  visit(tree, false);
  return result;
}

export function moveNodes(
  tree: MindNode,
  keys: Iterable<string>,
  targetKey: string,
  position: string,
): MindNode {
  const sources = topLevelSelection(tree, keys);
  if (!sources.length || !["inside", "before", "after"].includes(position))
    return tree;
  if (sources.length === 1)
    return moveNode(tree, sources[0].key, targetKey, position);
  const target = findNode(tree, targetKey);
  if (!target || sources.some((source) => containsNode(source, targetKey)))
    return tree;
  const parentKey =
    position === "inside" ? targetKey : findParent(tree, targetKey);
  if (!parentKey) return tree;
  const sourceKeys = new Set(sources.map((node) => node.key));
  function remove(node: MindNode): MindNode {
    const children = node.children
      .filter((child) => !sourceKeys.has(child.key))
      .map(remove);
    return children.length === node.children.length &&
      children.every((child, i) => child === node.children[i])
      ? node
      : { ...node, children };
  }
  const without = remove(tree);
  const result = updateNode(without, parentKey, (parent) => {
    const children = parent.children.slice();
    const index =
      position === "inside"
        ? children.length
        : children.findIndex((child) => child.key === targetKey) +
          (position === "after" ? 1 : 0);
    children.splice(index, 0, ...sources);
    return { ...parent, collapsed: false, children };
  });
  function same(a: MindNode, b: MindNode): boolean {
    return (
      a.key === b.key &&
      !!a.collapsed === !!b.collapsed &&
      a.children.length === b.children.length &&
      a.children.every((child, i) => same(child, b.children[i]))
    );
  }
  return same(tree, result) ? tree : result;
}
export function setRootBranchSides(
  tree: MindNode,
  keys: Iterable<string>,
  side: string,
): MindNode {
  if (side !== "left" && side !== "right") return tree;
  const selected = new Set(keys);
  const children: MindNode[] = tree.children.map((child) =>
    selected.has(child.key) && child.side !== side ? { ...child, side } : child,
  );
  return children.every((child, index) => child === tree.children[index])
    ? tree
    : { ...tree, children };
}
export function snapshot(doc: unknown): string {
  return JSON.stringify(doc, null, 2);
}
export function pastedImage(
  items: DataTransferItemList | undefined,
): File | null {
  for (const item of items || []) {
    if (item.kind === "file" && /^image\/(png|jpeg|webp|gif)$/i.test(item.type))
      return item.getAsFile();
  }
  return null;
}

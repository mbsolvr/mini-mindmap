import { useRef, useState } from "react";
import type { RefObject } from "react";
import {
  newDocument,
  serializeWorkspace,
  tabViewKey,
  tabWithContent,
  tabWithTree,
  findNode,
  treeForKey,
  updateNode,
  workspaceFromDocument,
} from "../model.ts";
import { validateMapLimits } from "../limits.ts";
import { hasSummaryConflict, settleSummaries } from "../summaries.ts";
import type { MapContent, MindNode, Workspace } from "../types.ts";

export function useWorkspace(
  openingRef: RefObject<boolean>,
  onUnsaved: () => void,
  initialTitle = "Central Topic",
  onInvalid: (message: string) => void = () => {},
) {
  const [workspace, setWorkspace] = useState(() =>
    workspaceFromDocument(newDocument(initialTitle)),
  );
  const workspaceRef = useRef(workspace);
  const [initialSaved] = useState(() => serializeWorkspace(workspace));
  const savedRef = useRef(initialSaved);
  const historyRef = useRef<Workspace[]>([]);
  const redoRef = useRef<Workspace[]>([]);
  const dirtyRef = useRef(false);
  const savedTabsRef = useRef<WeakMap<
    object,
    Workspace["tabs"][number]
  > | null>(null);
  if (!savedTabsRef.current) {
    savedTabsRef.current = new WeakMap();
    workspace.tabs.forEach((tab) =>
      savedTabsRef.current!.set(tabViewKey(tab), tab),
    );
  }
  const [savedVersion, setSavedVersion] = useState(0);

  function markTabsSaved(snapshot: Workspace) {
    snapshot.tabs.forEach((tab) =>
      savedTabsRef.current!.set(tabViewKey(tab), tab),
    );
    setSavedVersion((value) => value + 1);
  }
  function isTabDirty(tab: Workspace["tabs"][number]) {
    const saved = savedTabsRef.current!.get(tabViewKey(tab));
    return (
      !saved || (saved !== tab && JSON.stringify(saved) !== JSON.stringify(tab))
    );
  }

  function updateDirty() {
    dirtyRef.current =
      serializeWorkspace(workspaceRef.current) !== savedRef.current;
  }
  // Immutable workspace snapshots share unchanged data while bounding undo history.
  function pushSnapshot(stack: Workspace[], snapshot: Workspace) {
    stack.push(snapshot);
    if (stack.length > 100) stack.splice(0, stack.length - 100);
  }
  function recordHistory(snapshot: Workspace) {
    pushSnapshot(historyRef.current, snapshot);
    redoRef.current = [];
  }
  function commit(next: Workspace, record = true) {
    if (openingRef.current || next === workspaceRef.current) return false;
    try {
      next.tabs.forEach((tab) => {
        if (!workspaceRef.current.tabs.includes(tab)) validateMapLimits(tab);
      });
    } catch (error) {
      onInvalid(error instanceof Error ? error.message : String(error));
      return false;
    }
    if (record) recordHistory(workspaceRef.current);
    workspaceRef.current = next;
    updateDirty();
    setWorkspace(next);
    if (dirtyRef.current) onUnsaved();
    return true;
  }
  function changeTree(key: string, transform: (node: MindNode) => MindNode) {
    const ws = workspaceRef.current,
      tab = ws.tabs[ws.active];
    const previousTree = tab.tree.summaries?.length ? treeForKey(tab, key) : null;
    const previousNode = previousTree && findNode(previousTree, key);
    const tree = updateNode(tab.tree, key, transform);
    let next = tree === tab.tree ? tab : tabWithTree(tab, tree);
    if (tree === tab.tree && tab.floatingTopics) {
      const floatingTopics = tab.floatingTopics.map((topic) => {
        const updated = updateNode(topic.tree, key, transform);
        return updated === topic.tree ? topic : { ...topic, tree: updated };
      });
      if (floatingTopics.some((topic, i) => topic !== tab.floatingTopics![i]))
        next = tabWithContent(tab, { floatingTopics });
    }
    if (next === tab) return;
    if (previousNode) {
      const currentTree = treeForKey(next, key);
      const currentNode = currentTree && findNode(currentTree, key);
      if (currentNode && (currentNode.children !== previousNode.children ||
          currentNode.side !== previousNode.side || currentNode.layout !== previousNode.layout)) {
        const settled = settleSummaries(next);
        if (!settled || hasSummaryConflict(settled)) {
          onInvalid("This change would create conflicting summaries");
          return false;
        }
        if (settled !== next) next = tabWithContent(next, settled);
      }
    }
    const tabs = ws.tabs.slice();
    tabs[ws.active] = next;
    return commit({ ...ws, tabs });
  }
  function changeMap(update: (map: MapContent) => Partial<MapContent>) {
    const ws = workspaceRef.current,
      tab = ws.tabs[ws.active],
      patch = update(tab);
    if (
      Object.entries(patch).every(([key, value]) =>
        Object.is(tab[key as keyof MapContent], value),
      )
    )
      return false;
    const tabs = ws.tabs.slice();
    tabs[ws.active] = tabWithContent(tab, patch);
    return commit({ ...ws, tabs });
  }
  function travel(from: Workspace[], to: Workspace[]): Workspace | null {
    const next = from.pop();
    if (!next) return null;
    pushSnapshot(to, workspaceRef.current);
    workspaceRef.current = next;
    updateDirty();
    setWorkspace(next);
    return next;
  }
  return {
    workspace,
    setWorkspace,
    workspaceRef,
    savedRef,
    historyRef,
    redoRef,
    dirtyRef,
    savedVersion,
    markTabsSaved,
    isTabDirty,
    updateDirty,
    recordHistory,
    commit,
    changeTree,
    changeMap,
    travel,
  };
}

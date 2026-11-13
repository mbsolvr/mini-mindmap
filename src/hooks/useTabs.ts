import { useState } from "react";
import type { RefObject } from "react";
import type { Workspace } from "../types.ts";
import {
  newDocument,
  tabViewKey,
  tabWithTree,
  workspaceFromDocument,
} from "../model.ts";

interface Options {
  workspace: Workspace;
  workspaceRef: RefObject<Workspace>;
  commit: (workspace: Workspace, record?: boolean) => boolean;
  selectOne: (key: string | null) => void;
  setFocusTarget: (key: string) => void;
  cancelRelation: () => void;
  t: (text: string) => string;
}
export function useTabs({
  workspace,
  workspaceRef,
  commit,
  selectOne,
  setFocusTarget,
  cancelRelation,
  t,
}: Options) {
  const [closeKey, setCloseKey] = useState<object | null>(null);
  const closeTarget =
    workspace.tabs.find((tab) => tabViewKey(tab) === closeKey) || null;
  function switchTab(index: number) {
    cancelRelation();
    const ws = workspaceRef.current;
    if (index === ws.active || !ws.tabs[index]) return;
    if (!commit({ ...ws, active: index }, false)) return;
    selectOne(ws.tabs[index].tree.key);
  }
  function addTab() {
    const ws = workspaceRef.current,
      tab = workspaceFromDocument(newDocument(t("Central Topic"))).tabs[0];
    if (!commit({ ...ws, tabs: [...ws.tabs, tab], active: ws.tabs.length }))
      return;
    selectOne(tab.tree.key);
    setFocusTarget(tab.tree.key);
  }
  function reorderTab(from: number, insertion: number) {
    const ws = workspaceRef.current,
      to = insertion > from ? insertion - 1 : insertion;
    if (
      from < 0 ||
      from >= ws.tabs.length ||
      to < 0 ||
      to >= ws.tabs.length ||
      from === to
    )
      return;
    const tabs = ws.tabs.slice(),
      current = tabs[ws.active],
      [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    commit({ ...ws, tabs, active: tabs.indexOf(current) });
  }
  function closeTab(index: number) {
    const ws = workspaceRef.current;
    if (ws.tabs.length === 1 || !ws.tabs[index]) return;
    setCloseKey(tabViewKey(ws.tabs[index]));
  }
  function confirmCloseTab() {
    const ws = workspaceRef.current;
    const index = ws.tabs.findIndex((tab) => tabViewKey(tab) === closeKey);
    setCloseKey(null);
    if (index < 0 || ws.tabs.length === 1) return;
    const tabs = ws.tabs.filter((_, i) => i !== index);
    const active =
      index < ws.active ? ws.active - 1 : Math.min(ws.active, tabs.length - 1);
    if (!commit({ ...ws, tabs, active })) return;
    if (index === ws.active) selectOne(tabs[active].tree.key);
    requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (
        focused instanceof HTMLElement &&
        focused.matches(".tab-open, .tab-close, .new-tab")
      )
        focused.blur();
    });
  }
  function renameTab(index: number, title: string) {
    const ws = workspaceRef.current,
      tab = ws.tabs[index];
    if (!tab || (tab.tree.tabTitle || "") === title) return;
    const { tabTitle: _, ...tree } = tab.tree,
      tabs = ws.tabs.slice();
    tabs[index] = tabWithTree(tab, title ? { ...tree, tabTitle: title } : tree);
    commit({ ...ws, tabs });
  }
  return {
    switchTab,
    addTab,
    reorderTab,
    closeTab,
    confirmCloseTab,
    renameTab,
    closeTarget,
    cancelCloseTab: () => setCloseKey(null),
  };
}

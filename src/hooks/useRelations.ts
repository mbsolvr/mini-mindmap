import { useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { tabViewKey, treeForKey } from "../model.ts";
import { addRelation } from "../relations.ts";
import type {
  MindNode,
  Relation,
  RelationControls,
  Workspace,
} from "../types.ts";
import { validRelationControls } from "../limits.ts";

type Context = { key: string; x: number; y: number };
export type RelationContext = {
  key: string;
  tab: number;
  viewKey: object;
  x: number;
  y: number;
};
export type RelationEdit = {
  key: string;
  tab: number;
  viewKey: object;
  value: string;
};
interface Options {
  workspace: Workspace;
  workspaceRef: RefObject<Workspace>;
  changeTree: (key: string, transform: (node: MindNode) => MindNode) => void;
  selected: string | null;
  multiKeys: Set<string>;
  selectOne: (key: string | null) => void;
  setPane: Dispatch<SetStateAction<string>>;
  setContext: Dispatch<SetStateAction<Context | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
}
export function useRelations({
  workspace,
  workspaceRef,
  changeTree,
  selected,
  multiKeys,
  selectOne,
  setPane,
  setContext,
  setStatus,
}: Options) {
  const [relationSource, setRelationSource] = useState<string | null>(null);
  const [selectedRelation, setSelectedRelation] = useState<number | null>(null);
  const [relationContext, setRelationContext] =
    useState<RelationContext | null>(null);
  const [relationEdit, setRelationEdit] = useState<RelationEdit | null>(null);
  const cancelRelationEdit = useRef(false);
  useEffect(() => {
    setRelationSource(null);
    setSelectedRelation(null);
    setRelationContext(null);
    setRelationEdit(null);
  }, [workspace.active]);
  function startRelation(key = selected) {
    if (multiKeys.size > 1) {
      setStatus("Select a source topic first");
      return;
    }
    if (
      !key ||
      !treeForKey(workspaceRef.current.tabs[workspaceRef.current.active], key)
    ) {
      setStatus("Select a source topic for the connection");
      return;
    }
    setRelationSource(key);
    setSelectedRelation(null);
    setPane("");
    (document.activeElement as HTMLElement)?.blur();
    setStatus("Select a target topic · Esc to cancel");
  }
  function relationPick(key: string) {
    if (!relationSource) return;
    const map = workspaceRef.current.tabs[workspaceRef.current.active],
      tree = map.tree;
    const next = addRelation(
      tree,
      relationSource,
      key,
      (map.floatingTopics || []).map((topic) => topic.tree),
    );
    if (next === tree) {
      setStatus(
        "Cannot connect a topic to itself, create a duplicate, or use a missing topic",
      );
      return;
    }
    changeTree(tree.key, () => next);
    setRelationSource(null);
    selectOne(key);
    setSelectedRelation((next.relations?.length || 1) - 1);
    setStatus("Connection added · Double-click to edit its label");
  }
  function updateRelation(index: number, update: Partial<Relation> | null) {
    const tree = workspaceRef.current.tabs[workspaceRef.current.active].tree;
    if (!Array.isArray(tree.relations) || !tree.relations[index]) return;
    const relations = tree.relations.slice();
    if (update === null) relations.splice(index, 1);
    else relations[index] = { ...relations[index], ...update };
    changeTree(tree.key, (root) => ({ ...root, relations }));
    if (update === null) setSelectedRelation(null);
  }
  function relationIndex(key: string, tab: number, viewKey: object) {
    const ws = workspaceRef.current;
    // IDs may repeat across tabs; a tab index alone cannot identify a pending command.
    return ws.active === tab &&
      ws.tabs[tab] &&
      tabViewKey(ws.tabs[tab]) === viewKey
      ? (ws.tabs[tab]?.tree.relations || []).findIndex(
          (relation) => relation.relKey === key,
        )
      : -1;
  }
  function adjustRelation(
    key: string,
    controls: RelationControls,
    original: MindNode,
  ) {
    const ws = workspaceRef.current,
      tree = ws.tabs[ws.active].tree;
    if (tree !== original || !validRelationControls(controls)) return;
    const index = (tree.relations || []).findIndex(
      (relation) => relation.relKey === key,
    );
    if (index >= 0) updateRelation(index, { controls });
  }
  function editRelation(index: number) {
    const relation =
      workspaceRef.current.tabs[workspaceRef.current.active].tree.relations?.[
        index
      ];
    if (!relation) return;
    cancelRelationEdit.current = false;
    setRelationContext(null);
    setContext(null);
    setSelectedRelation(index);
    setRelationEdit({
      key: relation.relKey,
      tab: workspaceRef.current.active,
      viewKey: tabViewKey(
        workspaceRef.current.tabs[workspaceRef.current.active],
      ),
      value: relation.label || "",
    });
  }
  function saveRelationLabel(value: string) {
    if (
      cancelRelationEdit.current ||
      !relationEdit ||
      workspaceRef.current.active !== relationEdit.tab
    ) {
      setRelationEdit(null);
      return;
    }
    const relations =
      workspaceRef.current.tabs[relationEdit.tab].tree.relations || [];
    const index = relationIndex(
      relationEdit.key,
      relationEdit.tab,
      relationEdit.viewKey,
    );
    if (index !== -1 && relations[index].label !== value)
      updateRelation(index, { label: value.slice(0, 100) });
    setRelationEdit(null);
  }
  return {
    relationSource,
    setRelationSource,
    selectedRelation,
    setSelectedRelation,
    relationContext,
    setRelationContext,
    relationEdit,
    setRelationEdit,
    cancelRelationEdit,
    startRelation,
    relationPick,
    updateRelation,
    adjustRelation,
    relationIndex,
    editRelation,
    saveRelationLabel,
  };
}

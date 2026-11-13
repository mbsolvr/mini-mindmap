import type React from "react";
import type { RefObject } from "react";
import type { Workspace } from "../types.ts";
import type { useWorkspace } from "./useWorkspace.ts";
import { MAX_IMAGE_BYTES } from "../limits.ts";
import {
  findNode,
  findParent,
  makeKey,
  pastedImage,
  setAllCollapsed,
  treeForKey,
} from "../model.ts";
import { isPlainEnter, deletesImage } from "../keyboard.ts";
import { removeMapTopic } from "../mapOperations.ts";

type WorkspaceActions = ReturnType<typeof useWorkspace>;
interface Options {
  workspaceRef: RefObject<Workspace>;
  changeTree: WorkspaceActions["changeTree"];
  changeMap: WorkspaceActions["changeMap"];
  multiKeys: Set<string>;
  canvasRef: RefObject<HTMLElement | null>;
  mapRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  openingRef: RefObject<boolean>;
  composingRef: RefObject<boolean>;
  selectOne: (key: string | null) => void;
  setFocusTarget: (key: string) => void;
  setNoteFocus: (key: string) => void;
  cancelRelation: () => void;
  closeCanvasMenu: () => void;
  setStatus: (value: string) => void;
  setError: (value: string) => void;
  t: (value: string) => string;
}

// All edits go through workspace transactions so history, validation and saving agree.
export function useTopicActions({
  workspaceRef,
  changeTree,
  changeMap,
  multiKeys,
  canvasRef,
  mapRef,
  zoom,
  openingRef,
  composingRef,
  selectOne,
  setFocusTarget,
  setNoteFocus,
  cancelRelation,
  closeCanvasMenu,
  setStatus,
  setError,
  t,
}: Options) {
  function setAllTreesCollapsed(collapsed: boolean) {
    const map = workspaceRef.current.tabs[workspaceRef.current.active],
      tree = setAllCollapsed(map.tree, collapsed);
    const floatingTopics = map.floatingTopics?.map((topic) => {
      const next = setAllCollapsed(topic.tree, collapsed);
      return next === topic.tree ? topic : { ...topic, tree: next };
    });
    if (
      tree === map.tree &&
      (!floatingTopics ||
        floatingTopics.every(
          (topic, index) => topic === map.floatingTopics![index],
        ))
    )
      return;
    changeMap(() => ({ tree, ...(floatingTopics ? { floatingTopics } : {}) }));
  }
  function addFloating(
    kind: "topic" | "note",
    position?: { x: number; y: number },
  ) {
    const canvas = canvasRef.current,
      map = mapRef.current;
    if (!position && (!canvas || !map)) return;
    const viewport = canvas?.getBoundingClientRect(),
      bounds = map?.getBoundingClientRect();
    const doc = workspaceRef.current.tabs[workspaceRef.current.active];
    const offset =
      (((doc.floatingTopics?.length || 0) + (doc.floatingNotes?.length || 0)) %
        6) *
      24;
    const x =
      position?.x ??
      Math.max(
        -100000,
        Math.min(
          100000,
          (viewport!.left + viewport!.width * 0.3 + offset - bounds!.left) /
            zoom,
        ),
      );
    const y =
      position?.y ??
      Math.max(
        -100000,
        Math.min(
          100000,
          (viewport!.top + viewport!.height * 0.3 + offset - bounds!.top) /
            zoom,
        ),
      );
    const key = makeKey();
    if (kind === "topic") {
      if (
        !changeMap((map) => ({
          floatingTopics: [
            ...(map.floatingTopics || []),
            { x, y, tree: { key, text: t("New topic"), children: [] } },
          ],
        }))
      )
        return;
      selectOne(key);
      setFocusTarget(key);
    } else {
      if (
        !changeMap((map) => ({
          floatingNotes: [
            ...(map.floatingNotes || []),
            { key, text: "", x, y },
          ],
        }))
      )
        return;
      selectOne(null);
      setNoteFocus(key);
    }
    cancelRelation();
    closeCanvasMenu();
  }
  function changeText(key: string, text: string) {
    changeTree(key, (node) => (node.text === text ? node : { ...node, text }));
  }
  function changeNoteText(key: string, text: string) {
    changeMap((map) => {
      const notes = map.floatingNotes;
      if (!notes?.some((note) => note.key === key && note.text !== text))
        return {};
      return {
        floatingNotes: notes.map((note) =>
          note.key === key ? { ...note, text } : note,
        ),
      };
    });
  }
  function addChild(key: string | null, sibling = false) {
    if (!key) return;
    if (multiKeys.size > 1) {
      setStatus("Select a single node first");
      return;
    }
    const map = workspaceRef.current.tabs[workspaceRef.current.active];
    if (sibling && map.tree.summaries?.some((summary) => summary.key === key))
      return;
    const tree = treeForKey(map, key);
    if (!tree) return;
    const parent = sibling ? findParent(tree, key) : key;
    if (!parent) return;
    const side = sibling ? findNode(tree, key)?.side : undefined;
    const child = {
      key: makeKey(),
      text: t("New topic"),
      collapsed: false,
      children: [],
      ...(side ? { side } : {}),
    };
    if (
      !changeTree(parent, (node) => {
        const children = node.children.slice();
        if (sibling)
          children.splice(
            children.findIndex((item) => item.key === key) + 1,
            0,
            child,
          );
        else children.push(child);
        return { ...node, collapsed: false, children };
      })
    )
      return;
    selectOne(child.key);
    setFocusTarget(child.key);
  }
  function removeNode(key: string | null, editParent = true) {
    if (!key) return;
    if (multiKeys.size > 1) {
      setStatus(
        "Multiple topics selected. Drag a handle to move them, or click a topic to clear the selection.",
      );
      return;
    }
    const map = workspaceRef.current.tabs[workspaceRef.current.active],
      tree = treeForKey(map, key);
    if (!tree) return;
    cancelRelation();
    const parent = findParent(tree, key);
    if (!changeMap((current) => removeMapTopic(current, key))) return;
    selectOne(parent || map.tree.key);
    if (parent && editParent) setFocusTarget(parent);
  }

  function handleKey(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    key: string,
  ) {
    if (
      openingRef.current ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      composingRef.current
    )
      return;
    const tree = treeForKey(
      workspaceRef.current.tabs[workspaceRef.current.active],
      key,
    );
    if (!tree) return;
    if (
      event.key === "Tab" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      if (event.shiftKey) {
        const parent = findParent(tree, key);
        if (parent) {
          selectOne(parent);
          setFocusTarget(parent);
        }
      } else addChild(key);
    } else if (isPlainEnter(event)) {
      event.preventDefault();
      if (!event.repeat)
        event.currentTarget.closest<HTMLElement>(".node")?.focus({ preventScroll: true });
    } else if (deletesImage(findNode(tree, key), event)) {
      event.preventDefault();
      changeTree(key, (node) => {
        const { image, ...rest } = node;
        return rest;
      });
    }
  }
  function handlePaste(
    event: React.ClipboardEvent<HTMLTextAreaElement>,
    key: string,
  ) {
    if (openingRef.current) {
      event.preventDefault();
      return;
    }
    const file = pastedImage(event.clipboardData?.items);
    if (!file) return;
    event.preventDefault();
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image exceeds 10 MB. Please use a smaller image.");
      return;
    }
    const original = workspaceRef.current;
    const reader = new FileReader();
    reader.onerror = () =>
      setError("Could not read the image from the clipboard");
    reader.onload = () => {
      if (workspaceRef.current !== original) {
        setError("The map changed. Please paste the image again.");
        return;
      }
      if (
        changeTree(key, (node) => ({
          ...node,
          image: { src: String(reader.result), caption: node.text },
        }))
      )
        setError("");
    };
    reader.readAsDataURL(file);
  }
  return {
    setAllTreesCollapsed,
    addFloating,
    changeText,
    changeNoteText,
    addChild,
    removeNode,
    handleKey,
    handlePaste,
  };
}

import type { MindNode } from "./types.ts";
import type React from "react";
import { findNode, findParent } from "./model.ts";

export function isPlainEnter(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.nativeEvent?.isComposing
  );
}

export function adjacentNode(tree: MindNode, key: string, direction: string) {
  const node = findNode(tree, key);
  if (!node) return null;
  if (direction === "ArrowLeft") return findParent(tree, key);
  if (direction === "ArrowRight")
    return node.collapsed ? null : node.children[0]?.key || null;
  if (direction !== "ArrowUp" && direction !== "ArrowDown") return null;
  const visible: string[] = [];
  function visit(current: MindNode) {
    visible.push(current.key);
    if (!current.collapsed) current.children.forEach(visit);
  }
  visit(tree);
  const index = visible.indexOf(key);
  if (index < 0) return null;
  return visible[index + (direction === "ArrowUp" ? -1 : 1)] || null;
}

export function deletesImage(
  node: MindNode | null,
  event: React.KeyboardEvent<HTMLTextAreaElement>,
) {
  if (
    !node?.image ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey
  )
    return false;
  const input = event.currentTarget;
  if (input.selectionStart !== 0 || input.selectionEnd !== 0) return false;
  return event.key === "Backspace" || (event.key === "Delete" && !input.value);
}

interface ShortcutCommands {
  save: (as: boolean) => void;
  undo: () => void;
  redo: () => void;
  openMenu: (name: string) => void;
}

// Return true for local editor undo too: it must not reach canvas shortcuts.
export function handleEditorShortcut(
  event: KeyboardEvent,
  commands: ShortcutCommands,
): boolean {
  const modifier = event.ctrlKey || event.metaKey;
  const target = event.target;
  if (event.altKey && !modifier && !event.shiftKey) {
    const name = {
      f: "File",
      e: "Edit",
      v: "View",
      s: "Structure",
      o: "Settings",
    }[event.key.toLowerCase()];
    if (name) {
      event.preventDefault();
      commands.openMenu(name);
      return true;
    }
  }
  if (modifier && !event.altKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (
      target instanceof HTMLElement &&
      target.matches(
        ".tab-rename, .relation-editor, .node-text textarea, .floating-note textarea, .summary-text",
      )
    ) {
      target.blur();
      queueMicrotask(() => void commands.save(event.shiftKey));
    } else void commands.save(event.shiftKey);
    return true;
  }
  if (
    modifier &&
    !event.altKey &&
    target instanceof Element &&
    target.matches(".tab-rename, .relation-editor") &&
    (event.key.toLowerCase() === "z" ||
      (!event.shiftKey && event.key.toLowerCase() === "y"))
  )
    return true;
  if (modifier && !event.altKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? commands.redo() : commands.undo();
    return true;
  }
  if (
    modifier &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "y"
  ) {
    event.preventDefault();
    commands.redo();
    return true;
  }
  return false;
}

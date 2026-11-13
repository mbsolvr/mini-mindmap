import { verticalIndex } from "../selection.ts";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FloatingTopic, MindNode } from "../types.ts";
import { useT } from "../i18n.ts";
import MindNodeView from "./MindNode.tsx";
import { MenuLabel } from "./AppMenu.tsx";
import { findNode, treeForKey } from "../model.ts";
import { nodeDepth } from "../summaries.ts";

interface Props {
  mapRef: React.RefObject<HTMLElement | null>;
  tree: MindNode;
  floatingTopics?: FloatingTopic[];
  zoom: number;
  node: React.ComponentProps<typeof MindNodeView>;
  focus: string | null;
  setFocus: (key: string | null) => void;
  onRemove: (key: string) => void;
}

export default function SummaryLayer({
  mapRef,
  tree,
  floatingTopics,
  zoom,
  node,
  focus,
  setFocus,
  onRemove,
}: Props) {
  const t = useT();
  const summaries = useMemo(() => new Map(tree.summaries?.map((item) => [item.key, item])), [tree.summaries]);
  const [positions, setPositions] = useState<
    { key: string; x: number; y: number; height: number; left: boolean }[]
  >([]);
  const passes = useRef(0);
  const resetPasses = useRef(0);
  useEffect(() => () => {
    cancelAnimationFrame(resetPasses.current);
    resetPasses.current = 0;
    passes.current = 0;
  }, []);
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map || !tree.summaries?.length) {
      setPositions((current) => (current.length ? [] : current));
      return;
    }
    let frame = 0;
    function update() {
      if (!map) return;
      const origin = map.getBoundingClientRect();
      const root = map
        .querySelector<HTMLElement>(":scope > .node-row > .root-node")
        ?.getBoundingClientRect();
      const cards = new Map(
        Array.from(
          map.querySelectorAll<HTMLElement>("[data-drop-key]"),
          (card) => [card.dataset.dropKey, card],
        ),
      );
      const groups = new Map(
        Array.from(map.querySelectorAll<HTMLElement>(".summary-group"), (group) => [
          group.dataset.summaryKey,
          group,
        ]),
      );
      const groupBounds = new Map(Array.from(groups, ([key, group]) => {
        const content = group.querySelector<HTMLElement>(":scope > .summary-node");
        return [key, {
          rect: group.getBoundingClientRect(),
          content: content?.getBoundingClientRect(),
          left: group.classList.contains("summary-left"),
        }];
      }));
      const ordinaryBounds = Array.from(cards.values())
        .filter((card) => !card.closest(".summary-group"))
        .map((card) => card.getBoundingClientRect());
      const measured = (tree.summaries || []).map((summary, index) => {
        const rows = summary.topics.map((key) =>
          cards.get(key)?.closest<HTMLElement>(".node-row"),
        );
        if (rows.some((row) => !row)) return null;
        const members = rows.flatMap((row) =>
          Array.from(row!.querySelectorAll<HTMLElement>("[data-drop-key]")),
        );
        return {
          summary,
          index,
          bounds: members.map((card) => card.getBoundingClientRect()),
        };
      });
      const present = measured.filter((item) => item !== null);
      const obstacles = ordinaryBounds.map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, index: -1, side: false }));
      for (const item of present) {
        const group = groupBounds.get(item.summary.key);
        if (!group) continue;
        for (const rect of [group.rect, group.content])
          if (rect) obstacles.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, index: item.index, side: group.left });
      }
      const candidates = verticalIndex(obstacles);
      const next = present.flatMap((item) => {
        const { summary, index, bounds } = item;
        let right = Math.max(...bounds.map((r) => r.right));
        let left = Math.min(...bounds.map((r) => r.left));
        const top = Math.min(...bounds.map((r) => r.top));
        const bottom = Math.max(...bounds.map((r) => r.bottom));
        const onLeft = !!root && right <= root.left;
        const content = groupBounds.get(summary.key)?.content;
        if (content) {
          const center = top + Math.max(bottom - top, 26 * zoom) / 2;
          const halfHeight = content.height / 2;
          const upper = Math.min(top, center - halfHeight), lower = Math.max(bottom, center + halfHeight);
          for (const rect of candidates(upper, lower)) {
            if (rect.index >= 0 && (rect.index >= index || rect.side !== onLeft)) continue;
            if (onLeft) left = Math.min(left, rect.left);
            else right = Math.max(right, rect.right);
          }
        }
        return [
          {
            key: summary.key,
            x:
              ((onLeft ? left : right) - origin.left) / zoom +
              (onLeft ? -16 : 16),
            y: (top - origin.top) / zoom,
            height: Math.max(26, (bottom - top) / zoom),
            left: onLeft,
          },
        ];
      });
      setPositions((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
      if (
        Array.from(cards.values()).some((card) =>
          card
            .getAnimations?.()
            .some((a) => a.id === "node-move" && a.playState === "running"),
        )
      )
        frame = requestAnimationFrame(update);
    }
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }
    if (!resetPasses.current)
      resetPasses.current = requestAnimationFrame(() => {
        passes.current = 0;
        resetPasses.current = 0;
      });
    // shortcut: colliding groups settle across frames to avoid React's update limit; use a single-pass layout if this becomes slow.
    if (++passes.current > 12) schedule();
    else update();
    const observer = new ResizeObserver(schedule);
    const mutations = new MutationObserver(schedule);
    observer.observe(map);
    mutations.observe(map, { childList: true, subtree: true });
    map
      .querySelectorAll("[data-drop-key], .node-row")
      .forEach((element) => observer.observe(element));
    map.addEventListener("floatingmove", schedule);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      map.removeEventListener("floatingmove", schedule);
      cancelAnimationFrame(frame);
    };
  }, [mapRef, tree, floatingTopics, zoom, positions]);
  useEffect(() => {
    if (positions.length)
      mapRef.current?.dispatchEvent(new Event("floatingmove"));
  }, [mapRef, positions]);
  useEffect(() => {
    if (!focus) return;
    const input = node.inputs.current.get(focus);
    if (input) {
      input.focus({ preventScroll: true });
      input.select();
      setFocus(null);
    }
  }, [focus, positions, node.inputs, setFocus]);
  return (
    <>
      {positions.map((position) => {
        const summary = summaries.get(position.key);
        if (!summary) return null;
        const map = { tree, floatingTopics };
        const owner = treeForKey(map, summary.key);
        const topic = owner && findNode(owner, summary.key);
        if (!topic) return null;
        return (
          <div
            key={summary.key}
            className={"summary-group" + (position.left ? " summary-left" : "")}
            data-summary-key={summary.key}
            style={{
              left: position.x,
              top: position.y,
              height: position.height,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <div className="summary-bracket" aria-hidden="true" />
            <div className={"summary-node" + (position.left ? " mirror" : "")}>
              <MindNodeView
                {...node}
                node={topic}
                depth={nodeDepth(map, summary.key)}
              />
            </div>
            <button
              type="button"
              className="summary-delete"
              aria-label={t("Delete summary, its child topics, and their connections")}
              title={t("Delete summary, its child topics, and their connections")}
              disabled={node.opening}
              onClick={() => onRemove(summary.key)}
            >
              <MenuLabel label="Delete" />
            </button>
          </div>
        );
      })}
    </>
  );
}

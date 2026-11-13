import React, { useEffect, useState } from "react";
import { relationCurve } from "../relations.ts";
import type {
  FloatingTopic,
  MindNode,
  Rect,
  RelationControls,
} from "../types.ts";
import { useT } from "../i18n.ts";
import type { RelationEdit } from "../hooks/useRelations.ts";
import { useRelationDrag } from "../hooks/useRelationDrag.ts";

interface Props {
  mapRef: React.RefObject<HTMLElement | null>;
  tree: MindNode;
  zoom: number;
  selected: number | null;
  floatingTopics?: FloatingTopic[];
  onSelect: (index: number) => void;
  onEdit: (index: number) => void;
  onContext: (index: number, x: number, y: number) => void;
  edit: RelationEdit | null;
  setEdit: React.Dispatch<React.SetStateAction<RelationEdit | null>>;
  cancelEdit: React.RefObject<boolean>;
  onSave: (value: string) => void;
  onAdjust: (
    key: string,
    controls: RelationControls,
    original: MindNode,
  ) => void;
}
interface RelationPath {
  key: string;
  from: Rect;
  to: Rect;
  label: string;
  index: number;
}

export default function RelationLayer({
  mapRef,
  tree,
  zoom,
  onSelect,
  onEdit,
  onContext,
  selected,
  edit,
  setEdit,
  cancelEdit,
  onSave,
  floatingTopics,
  onAdjust,
}: Props) {
  const t = useT();
  const [paths, setPaths] = useState<RelationPath[]>([]);
  const { preview, start } = useRelationDrag(
    tree,
    zoom,
    selected,
    floatingTopics,
    onAdjust,
  );
  useEffect(() => {
    const current = mapRef.current;
    if (!current) return;
    const map: HTMLElement = current;
    let frame = 0;
    function update() {
      const origin = map.getBoundingClientRect();
      const cards = new Map(
        Array.from(
          map.querySelectorAll("[data-drop-key]") as NodeListOf<HTMLElement>,
          (card) => [card.dataset.dropKey, card],
        ),
      );
      function bounds(card: HTMLElement) {
        const r = card.getBoundingClientRect();
        return {
          x: (r.left - origin.left) / zoom,
          y: (r.top - origin.top) / zoom,
          width: r.width / zoom,
          height: r.height / zoom,
        };
      }
      setPaths(
        (Array.isArray(tree.relations) ? tree.relations : []).flatMap(
          (relation, index) => {
            const from = cards.get(relation?.from),
              to = cards.get(relation?.to);
            if (!from || !to || from === to) return [];
            return [
              {
                key: relation.relKey,
                from: bounds(from),
                to: bounds(to),
                label: typeof relation.label === "string" ? relation.label : "",
                index,
              },
            ];
          },
        ),
      );
      if (
        Array.from(cards.values()).some((card) =>
          card
            .getAnimations?.()
            .some(
              (animation) =>
                animation.id === "node-move" &&
                animation.playState === "running",
            ),
        )
      )
        frame = requestAnimationFrame(update);
    }
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }
    update();
    const observer = new ResizeObserver(schedule);
    map.addEventListener("floatingmove", schedule);
    observer.observe(map);
    map
      .querySelectorAll("[data-drop-key]")
      .forEach((card) => observer.observe(card));
    return () => {
      map.removeEventListener("floatingmove", schedule);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [mapRef, tree, zoom, floatingTopics]);
  if (!paths.length) return null;
  return (
    <svg className="relation-layer" aria-label={t("Connection")}>
      <defs>
        <marker
          id="relation-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0L10 5L0 10z" fill="var(--map-relation, #7aaea6)" />
        </marker>
      </defs>
      {paths.map((path) => {
        const relation = tree.relations?.[path.index];
        if (!relation || relation.relKey !== path.key) return null;
        const curve = relationCurve(
          path.from,
          path.to,
          preview?.key === relation.relKey
            ? preview.controls
            : relation.controls,
        );
        const editing =
          !!edit && tree.relations?.[path.index]?.relKey === edit.key;
        const width = Math.min(
          300,
          Math.max(72, (edit?.value.length || 0) * 12 + 20),
        );
        return (
          <g
            key={relation.relKey}
            className={selected === path.index ? "relation-selected" : ""}
          >
            <path
              className="relation-line"
              d={curve.d}
              markerEnd="url(#relation-arrow)"
            />
            <path
              className="relation-hit"
              d={curve.d}
              tabIndex={0}
              aria-label={path.label || t("Connection")}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(path.index);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onEdit(path.index);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContext(path.index, e.clientX, e.clientY);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onEdit(path.index);
                }
              }}
            />
            {path.label && !editing && (
              <text
                className="relation-label"
                x={curve.x}
                y={curve.y}
                textAnchor="middle"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(path.index);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onEdit(path.index);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onContext(path.index, e.clientX, e.clientY);
                }}
              >
                {path.label}
              </text>
            )}
            {selected === path.index && !editing && (
              <g className="relation-controls">
                {(["start", "end"] as const).map((end) => {
                  const anchor = curve[end],
                    handle = end === "start" ? curve.c1 : curve.c2;
                  return (
                    <g key={end}>
                      <line
                        x1={anchor.x}
                        y1={anchor.y}
                        x2={handle.x}
                        y2={handle.y}
                      />
                      <circle
                        cx={handle.x}
                        cy={handle.y}
                        r={5 / zoom}
                        tabIndex={0}
                        role="button"
                        aria-label={t(
                          end === "start"
                            ? "Start control point"
                            : "End control point",
                        )}
                        onPointerDown={(e) =>
                          start(e, relation.relKey, end, curve.controls)
                        }
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onKeyDown={(e) => {
                          const delta = {
                            ArrowLeft: [-1, 0],
                            ArrowRight: [1, 0],
                            ArrowUp: [0, -1],
                            ArrowDown: [0, 1],
                          }[e.key];
                          if (!delta) return;
                          e.preventDefault();
                          e.stopPropagation();
                          const step = e.shiftKey ? 10 : 1,
                            point = curve.controls[end];
                          onAdjust(
                            relation.relKey,
                            {
                              ...curve.controls,
                              [end]: {
                                x: point.x + delta[0] * step,
                                y: point.y + delta[1] * step,
                              },
                            },
                            tree,
                          );
                        }}
                      />
                    </g>
                  );
                })}
              </g>
            )}
            {editing && edit && (
              <foreignObject
                x={curve.x - width / 2}
                y={curve.y - 17}
                width={width}
                height={24}
                className="relation-editor-container"
              >
                <input
                  className="relation-editor"
                  autoFocus
                  maxLength={100}
                  aria-label={t("Connection label")}
                  value={edit.value}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                  onBlur={(e) => onSave(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      cancelEdit.current = true;
                      setEdit(null);
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                />
              </foreignObject>
            )}
          </g>
        );
      })}
    </svg>
  );
}

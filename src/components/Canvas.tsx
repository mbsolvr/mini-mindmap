import React, { useMemo } from "react";
import MindNode from "./MindNode.tsx";
import RelationLayer from "./RelationLayer.tsx";
import FloatingLayer from "./FloatingLayer.tsx";
import SummaryLayer from "./SummaryLayer.tsx";
import BranchLayer from "./BranchLayer.tsx";
import { useT } from "../i18n.ts";

type NodeProps = React.ComponentProps<typeof MindNode>;
type RelationProps = React.ComponentProps<typeof RelationLayer>;
interface Props {
  canvasRef: React.RefObject<HTMLElement | null>;
  mapRef: React.RefObject<HTMLDivElement | null>;
  theme: string;
  layout: string;
  zoom: number;
  pan: { x: number; y: number };
  panning: boolean;
  onPointerDown: React.PointerEventHandler<HTMLElement>;
  onPointerMove: React.PointerEventHandler<HTMLElement>;
  onPointerEnd: React.PointerEventHandler<HTMLElement>;
  onContextMenu: React.MouseEventHandler<HTMLElement>;
  floating: Omit<React.ComponentProps<typeof FloatingLayer>, "node" | "zoom">;
  node: NodeProps;
  relation: Omit<RelationProps, "mapRef" | "tree" | "zoom">;
  summary: Omit<
    React.ComponentProps<typeof SummaryLayer>,
    "mapRef" | "tree" | "floatingTopics" | "zoom" | "node"
  >;
}
export default function Canvas({
  canvasRef,
  mapRef,
  theme,
  layout,
  zoom,
  pan,
  panning,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
  onContextMenu,
  floating,
  node,
  relation,
  summary,
}: Props) {
  const t = useT();
  const summaryKeys = useMemo(
    () => new Set(node.node.summaries?.map((item) => item.key)),
    [node.node.summaries],
  );
  const nodeProps = { ...node, summaryKeys };
  return (
    <section
      ref={canvasRef}
      className={"canvas" + (panning ? " panning" : "")}
      data-template={theme}
      aria-label={t("Mind map")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onContextMenu={onContextMenu}
    >
      <div
        ref={mapRef}
        className={"map layout-" + layout}
        data-zoom={zoom}
        style={{
          transformOrigin: "left center",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        <BranchLayer
          mapRef={mapRef}
          layout={layout}
          zoom={zoom}
          floatingTopics={floating.topics}
        />
        <MindNode {...nodeProps} />
        <FloatingLayer {...floating} node={nodeProps} zoom={zoom} />
        <RelationLayer
          {...relation}
          mapRef={mapRef}
          tree={node.node}
          zoom={zoom}
          floatingTopics={floating.topics}
        />
        <SummaryLayer
          {...summary}
          mapRef={mapRef}
          tree={node.node}
          floatingTopics={floating.topics}
          zoom={zoom}
          node={nodeProps}
        />
      </div>
    </section>
  );
}

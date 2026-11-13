import React from "react";
import type { MindNode as NodeData } from "../types.ts";
import { useT } from "../i18n.ts";
import { textStyleCss } from "../textStyle.ts";

let connectorObserver: ResizeObserver | undefined;
// Reserve the image's layout while React recreates it under a new parent.
const imageSizes = new WeakMap<
  NonNullable<NodeData["image"]>,
  { width: number; height: number }
>();
function observeConnector(card: HTMLDivElement | null) {
  if (!card || typeof ResizeObserver === "undefined") return;
  connectorObserver ??= new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const row = target.parentElement;
      if (!row) continue;
      const style = getComputedStyle(target);
      const bottom = parseFloat(style.borderBottomWidth);
      const underlined = parseFloat(style.borderTopWidth) === 0 && bottom > 0;
      const offset = `${underlined ? (target as HTMLElement).offsetHeight / 2 - bottom / 2 : 0}px`;
      row.style.setProperty("--connector-offset", offset);
      if (row.parentElement?.classList.contains("branch"))
        row.parentElement.style.setProperty("--connector-offset", offset);
    }
  });
  connectorObserver.observe(card);
  return () => connectorObserver?.unobserve(card);
}

export interface NodeHandlers {
  focus: (key: string) => void;
  toggle: (key: string) => void;
  text: (key: string, text: string) => void;
  edit: (key: string) => void;
  key: (event: React.KeyboardEvent<HTMLTextAreaElement>, key: string) => void;
  paste: (
    event: React.ClipboardEvent<HTMLTextAreaElement>,
    key: string,
  ) => void;
  composition: (active: boolean) => void;
  context: (event: React.MouseEvent<HTMLDivElement>, key: string) => void;
  dragStart: (event: React.PointerEvent<HTMLElement>, key: string) => void;
  dragMove: (event: React.PointerEvent<HTMLElement>) => void;
  dragEnd: (event: React.PointerEvent<HTMLElement>) => void;
  dragCancel: () => void;
  relationPick: (key: string) => void;
  collapse: (key: string) => void;
  preview: (src: string, text: string) => void;
  link: (url: string) => void;
  openMenu: (key: string, x: number, y: number) => void;
}
interface Props {
  node: NodeData;
  selected: string | null;
  inputs: React.RefObject<Map<string, HTMLTextAreaElement>>;
  handlers: NodeHandlers;
  opening: boolean;
  dropTarget: { key: string; position: string } | null;
  dragKeys?: string[];
  multiKeys: Set<string>;
  relationSource: string | null;
  layout: string;
  depth?: number;
  summaryKeys?: ReadonlySet<string>;
}

export function MindNode({
  node,
  selected,
  inputs,
  handlers,
  opening,
  dropTarget,
  dragKeys,
  multiKeys,
  relationSource,
  layout,
  depth = 0,
  summaryKeys,
}: Props) {
  const t = useT();
  const image = node.image?.src;
  const imageSize = node.image && imageSizes.get(node.image);
  const safeImage =
    typeof image === "string" &&
    /^data:image\/(png|jpeg|webp|gif);base64,/i.test(image);
  const url = /^https?:\/\/\S+$/i.test(node.text.trim())
    ? node.text.trim()
    : node.link?.url;
  const textStyle = textStyleCss(node.textStyle);
  function branches(children: NodeData[], mirror = false) {
    children = children.filter((child) => !summaryKeys?.has(child.key));
    if (!children.length) return null;
    return (
      <div className={"children" + (mirror ? " mirror" : "")}>
        {children.map((child, index) => (
          <div
            className="branch"
            key={child.key}
            style={{ "--branch-index": index + 1 } as React.CSSProperties}
          >
            <MemoMindNode
              node={child}
              selected={selected}
              inputs={inputs}
              handlers={handlers}
              opening={opening}
              dropTarget={dropTarget}
              dragKeys={dragKeys}
              multiKeys={multiKeys}
              relationSource={relationSource}
              layout={layout}
              depth={depth + 1}
              summaryKeys={summaryKeys}
            />
          </div>
        ))}
      </div>
    );
  }
  const left =
    depth === 0 && layout === "mindmap"
      ? node.children.filter((child) => child.side === "left")
      : [];
  const right =
    depth === 0 && layout === "mindmap"
      ? node.children.filter((child) => child.side !== "left")
      : node.children;
  return (
    <div className={"node-row depth-" + depth} data-node-key={node.key}>
      {!node.collapsed && branches(left, true)}
      <div
        ref={depth > 1 && layout !== "org" ? observeConnector : undefined}
        data-drop-key={node.key}
        className={
          "node" +
          (selected === node.key || multiKeys.has(node.key)
            ? " selected"
            : "") +
          (depth === 0 ? " root-node" : "") +
          (dragKeys?.includes(node.key) ? " dragging" : "") +
          (dropTarget?.key === node.key ? ` drop-${dropTarget.position}` : "") +
          (relationSource === node.key ? " relation-source" : "")
        }
        onPointerDownCapture={(event) => {
          if (relationSource && event.button === 0) {
            event.preventDefault();
            event.stopPropagation();
            handlers.relationPick(node.key);
          }
        }}
        onContextMenu={(event) => handlers.context(event, node.key)}
        tabIndex={0}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target instanceof Element &&
              event.target.closest("textarea:focus, img, button, a"))
          )
            return;
          if (
            (event.ctrlKey || event.metaKey) &&
            (depth !== 0 ||
              event.currentTarget.closest(".floating-topic,.summary-group"))
          ) {
            event.preventDefault();
            event.stopPropagation();
            handlers.toggle(node.key);
            return;
          }
          (document.activeElement as HTMLElement | null)?.blur();
          event.currentTarget.focus({ preventScroll: true });
          if (
            depth === 0 &&
            !event.currentTarget.closest(".floating-topic,.summary-group")
          )
            handlers.focus(node.key);
          else handlers.dragStart(event, node.key);
        }}
        onDoubleClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("img, button, a, textarea:focus")
          )
            return;
          handlers.edit(node.key);
        }}
        onPointerMove={handlers.dragMove}
        onPointerUp={handlers.dragEnd}
        onPointerCancel={handlers.dragCancel}
      >
        {safeImage && (
          <img
            src={image}
            alt={node.text || t("Topic image")}
            width={imageSize?.width}
            height={imageSize?.height}
            style={imageSize}
            draggable={false}
            onLoad={(event) => {
              const style = getComputedStyle(event.currentTarget),
                width = parseFloat(style.width), height = parseFloat(style.height);
              if (node.image && width && height)
                imageSizes.set(node.image, {
                  width,
                  height,
                });
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || relationSource) return;
              event.stopPropagation();
              event.currentTarget.dataset.startX = String(event.clientX);
              event.currentTarget.dataset.startY = String(event.clientY);
              event.currentTarget.dataset.dragged = "false";
              (document.activeElement as HTMLElement | null)?.blur();
              handlers.dragStart(event, node.key);
            }}
            onPointerMove={(event) => {
              const { startX, startY } = event.currentTarget.dataset;
              if (
                startX != null &&
                startY != null &&
                Math.hypot(
                  event.clientX - Number(startX),
                  event.clientY - Number(startY),
                ) >= 5
              )
                event.currentTarget.dataset.dragged = "true";
            }}
            onClick={(event) => {
              if (
                !relationSource &&
                event.currentTarget.dataset.dragged !== "true"
              ) {
                handlers.focus(node.key);
                handlers.preview(image, node.text);
              }
            }}
          />
        )}
        {image && !safeImage && (
          <span className="image-note">{t("Image preview unavailable")}</span>
        )}
        <span className="node-text" style={textStyle}>
          <span className="node-text-measure" aria-hidden="true">
            {node.text || (safeImage ? "" : t("Enter topic text"))}&#8203;
          </span>
          <textarea
            style={{
              textDecorationLine: node.textStyle?.underline
                ? "underline"
                : undefined,
            }}
            ref={(el) => {
              if (el) inputs.current.set(node.key, el);
              else inputs.current.delete(node.key);
            }}
            rows={1}
            wrap="off"
            value={node.text}
            readOnly={opening}
            placeholder={safeImage ? "" : t("Enter topic text")}
            aria-label={t("Topic text")}
            onFocus={() => handlers.focus(node.key)}
            onChange={(e) => handlers.text(node.key, e.target.value)}
            onKeyDown={(e) => handlers.key(e, node.key)}
            onPaste={(e) => handlers.paste(e, node.key)}
            onCompositionStart={() => handlers.composition(true)}
            onCompositionEnd={(e) => {
              handlers.text(node.key, e.currentTarget.value);
              handlers.composition(false);
            }}
          />
        </span>
        {url && /^https?:\/\//i.test(url) && (
          <button
            className="open-link"
            title={t("Open link")}
            onClick={() => handlers.link(url)}
          >
            ↗
          </button>
        )}
      </div>
      {node.children.length > 0 && (
        <button
          className="collapse"
          aria-expanded={!node.collapsed}
          aria-label={t(node.collapsed ? "Expand" : "Collapse")}
          onClick={() => handlers.collapse(node.key)}
        >
          {node.collapsed ? "+" : "−"}
        </button>
      )}
      {!node.collapsed && branches(right)}
    </div>
  );
}

const MemoMindNode = React.memo(MindNode);
export default MemoMindNode;

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { MindNode } from "../types.ts";
import { useT } from "../i18n.ts";

interface Props {
  tabs: { tree: MindNode }[];
  dirtyTabs?: boolean[];
  active: number;
  onSelect: (index: number) => void;
  onClose: (index: number) => void;
  onAdd: () => void;
  onRename: (index: number, title: string) => void;
  onReorder: (from: number, to: number) => void;
}

export default function TabBar({
  tabs,
  dirtyTabs = [],
  active,
  onSelect,
  onClose,
  onAdd,
  onRename,
  onReorder,
}: Props) {
  const t = useT();
  const tabsRef = useRef<HTMLDivElement>(null),
    stripRef = useRef<HTMLDivElement>(null),
    scrollbarRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ width: 0, visible: false });
  const [editing, setEditing] = useState<number | null>(null),
    [title, setTitle] = useState("");
  const [editingWidth, setEditingWidth] = useState<number>();
  const dragged = useRef<{ index: number; tab: Props["tabs"][number] } | null>(
    null,
  );
  const [insertion, setInsertion] = useState<number | null>(null);
  useEffect(() => {
    const currentContainer = tabsRef.current,
      currentStrip = stripRef.current;
    if (!currentContainer || !currentStrip) return;
    const container: HTMLDivElement = currentContainer,
      strip: HTMLDivElement = currentStrip;
    function update() {
      const width = strip.scrollWidth,
        visible = width > container.clientWidth + 1;
      setOverflow((previous) =>
        previous.width === width && previous.visible === visible
          ? previous
          : { width, visible },
      );
    }
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [tabs.length]);
  useLayoutEffect(() => {
    if (scrollbarRef.current && tabsRef.current)
      scrollbarRef.current.scrollLeft = tabsRef.current.scrollLeft;
  }, [overflow.visible, overflow.width]);
  useLayoutEffect(() => {
    const container = tabsRef.current,
      tab = container?.querySelector(".tab.active");
    if (!tab || !container) return;
    const viewport = container.getBoundingClientRect(),
      bounds = tab.getBoundingClientRect();
    if (bounds.left < viewport.left)
      container.scrollLeft += bounds.left - viewport.left;
    else if (bounds.right > viewport.right)
      container.scrollLeft += bounds.right - viewport.right;
  }, [active, tabs.length]);
  return (
    <>
      <div className="tabs-viewport">
        {overflow.visible && (
          <div
            ref={scrollbarRef}
            className="tabs-scrollbar"
            tabIndex={0}
            aria-label={t("Tab scrollbar")}
            onScroll={(event) => {
              if (tabsRef.current)
                tabsRef.current.scrollLeft = event.currentTarget.scrollLeft;
            }}
          >
            <div style={{ width: overflow.width }} />
          </div>
        )}
        <div
          ref={tabsRef}
          className="tabs"
          aria-label={t("Map tabs")}
          onScroll={(event) => {
            if (scrollbarRef.current)
              scrollbarRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }}
        >
          <div
            ref={stripRef}
            className="tab-strip"
            onDoubleClick={(event) => {
              if (event.target === event.currentTarget) onAdd();
            }}
            onDragOver={(event) => {
              if (!dragged.current) return;
              event.preventDefault();
              const container = tabsRef.current;
              if (container) {
                const bounds = container.getBoundingClientRect();
                if (event.clientX < bounds.left + 24)
                  container.scrollLeft -= 12;
                else if (event.clientX > bounds.right - 24)
                  container.scrollLeft += 12;
              }
              if (event.target === event.currentTarget)
                setInsertion(tabs.length);
            }}
            onDrop={(event) => {
              const source = dragged.current;
              if (!source) return;
              event.preventDefault();
              if (insertion !== null && tabs[source.index] === source.tab)
                onReorder(source.index, insertion);
              dragged.current = null;
              setInsertion(null);
            }}
          >
            {tabs.map((tab, index) => (
              <div
                key={index}
                className={
                  "tab" +
                  (index === active ? " active" : "") +
                  (dirtyTabs[index] ? " has-unsaved" : "") +
                  (insertion === index ? " tab-drop-before" : "") +
                  (index === tabs.length - 1 && insertion === tabs.length
                    ? " tab-drop-after"
                    : "")
                }
                style={editing === index ? { width: editingWidth } : undefined}
                onDragOver={(event) => {
                  if (!dragged.current) return;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setInsertion(
                    index +
                      (event.clientX >= bounds.left + bounds.width / 2 ? 1 : 0),
                  );
                }}
              >
                {editing === index ? (
                  <input
                    className="tab-rename"
                    aria-label={t("Rename tab")}
                    autoFocus
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    onBlur={() => {
                      onRename(index, title.trim());
                      setEditing(null);
                    }}
                    onKeyDown={(event) => {
                      if (
                        (event.ctrlKey || event.metaKey) &&
                        !event.altKey &&
                        ["s", "+", "=", "-"].includes(event.key.toLowerCase())
                      )
                        return;
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") {
                        setEditing(null);
                      }
                      event.stopPropagation();
                    }}
                  />
                ) : (
                  <button
                    className="tab-open"
                    draggable={tabs.length > 1}
                    onDragStart={(event) => {
                      dragged.current = { index, tab };
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", "");
                    }}
                    onDragEnd={() => {
                      dragged.current = null;
                      setInsertion(null);
                    }}
                    aria-label={
                      (tab.tree.tabTitle || tab.tree.text || t("Untitled")) +
                      (dirtyTabs[index] ? ` · ${t("Unsaved changes")}` : "")
                    }
                    onClick={() => onSelect(index)}
                    onDoubleClick={(event) => {
                      setEditingWidth(
                        event.currentTarget.parentElement?.getBoundingClientRect()
                          .width,
                      );
                      setTitle(tab.tree.tabTitle || tab.tree.text);
                      setEditing(index);
                    }}
                  >
                    <span>
                      {tab.tree.tabTitle || tab.tree.text || t("Untitled")}
                    </span>
                  </button>
                )}
                {dirtyTabs[index] && (
                  <span
                    className="tab-dirty"
                    aria-hidden="true"
                    title={t("Unsaved changes")}
                  >
                    *
                  </span>
                )}
                {tabs.length > 1 && (
                  <button
                    className="tab-close"
                    aria-label={t("Close tab")}
                    onClick={() => onClose(index)}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <button className="new-tab" aria-label={t("New tab")} onClick={onAdd}>
        ＋
      </button>
    </>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useContextMenus } from "./hooks/useContextMenus.ts";
import { useTopicFocus } from "./hooks/useTopicFocus.ts";
import { useTopicActions } from "./hooks/useTopicActions.ts";
import Canvas from "./components/Canvas.tsx";
import { MenuLabel } from "./components/AppMenu.tsx";
import WorkspaceMenu from "./components/WorkspaceMenu.tsx";
import TabBar from "./components/TabBar.tsx";
import StatusBar from "./components/StatusBar.tsx";
import TopicContextMenus from "./components/TopicContextMenus.tsx";
import RelationGuide from "./components/RelationGuide.tsx";
import RelationEditor from "./components/RelationEditor.tsx";
import CloseTabDialog from "./components/CloseTabDialog.tsx";
import ConfirmDialog from "./components/ConfirmDialog.tsx";
import SettingsDialog from "./components/SettingsDialog.tsx";
import PrintDocument from "./components/PrintDocument.tsx";
import StructurePanel from "./components/StructurePanel.tsx";
import type { NodeHandlers } from "./components/MindNode.tsx";
import { resolveLayout } from "./layouts.ts";
import { resolveTemplate } from "./templates.ts";
import { adjacentNode, handleEditorShortcut } from "./keyboard.ts";
import {
  findNode,
  findParent,
  makeKey,
  tabViewKey,
  treeForKey,
} from "./model.ts";
import type {
  Workspace,
  FloatingTopic,
  MindNode as NodeData,
} from "./types.ts";
import { useCanvas } from "./hooks/useCanvas.ts";
import { useWorkspace } from "./hooks/useWorkspace.ts";
import { useDocumentFile } from "./hooks/useDocumentFile.ts";
import { useRelations } from "./hooks/useRelations.ts";
import { useNodeDrag } from "./hooks/useNodeDrag.ts";
import { invoke } from "./tauri.ts";
import { LanguageProvider } from "./i18n.ts";
import { usePreferences } from "./hooks/usePreferences.ts";
import { useConfirmation } from "./hooks/useConfirmation.ts";
import { useExports } from "./hooks/useExports.ts";
import { removeMapTopics } from "./mapOperations.ts";
import { useTabs } from "./hooks/useTabs.ts";
import { createSummary, prepareSummaryTopics } from "./summaries.ts";

const noFloatingTopics: FloatingTopic[] = [];

export default function App() {
  const {
    languagePreference,
    setLanguagePreference,
    language,
    display,
    setDisplay,
    settingsOpen,
    setSettingsOpen,
    t,
  } = usePreferences();
  const openingRef = useRef(false);
  const pathRef = useRef("");
  const [status, setStatus] = useState(
    "Choose a save location after making changes",
  );
  const [error, setError] = useState("");
  const {
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
    travel: travelWorkspace,
  } = useWorkspace(
    openingRef,
    () => {
      if (!pathRef.current) setStatus("Unsaved changes · Save the file first");
    },
    t("Central Topic"),
    (message) => setError(message),
  );
  const [selected, setSelected] = useState<string | null>(
    workspace.tabs[0].tree.key,
  );
  const [multiKeys, setMultiKeys] = useState(() => new Set<string>());
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const inputs = useRef(new Map<string, HTMLTextAreaElement>());
  const panelRef = useRef<HTMLElement>(null);
  const layoutBefore = useRef<Map<
    string | undefined,
    { left: number; top: number }
  > | null>(null);
  const animationsRef = useRef<Animation[]>([]);
  const viewKey = tabViewKey(workspace.tabs[workspace.active]);
  const {
    mapRef,
    canvasRef,
    zoom,
    setZoom,
    pan,
    setPan,
    adjustZoom,
    fitCanvas,
    centerNode,
    panRef,
    panning,
    setPanning,
    marquee,
    setMarquee,
    panStart,
    panMove,
    panEnd,
  } = useCanvas({
    viewKey,
    inputs,
    finishMotion,
    isDragging: () => !!dragRef.current,
    getRootKey: () =>
      workspaceRef.current.tabs[workspaceRef.current.active].tree.key,
    onSelectMany: (keys) => {
      setMultiKeys(new Set(keys));
      setSelected(keys[0] || null);
      setSelectedRelation(null);
      setMenu("");
    },
    onBlank: () => {
      selectOne(null);
      setMenu("");
    },
  });
  const [menu, setMenu] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    context,
    setContext,
    noteContext,
    setNoteContext,
    canvasContext,
    setCanvasContext,
    openNodeMenu,
    openNoteMenu,
    contextMenu,
    canvasContextMenu,
  } = useContextMenus({
    mapRef,
    zoom,
    selectOne,
    isMultiSelected: (key) => multiKeys.has(key),
    closeRelationMenu: () => setRelationContext(null),
  });
  const [noteFocus, setNoteFocus] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ src: string; text: string } | null>(
    null,
  );
  const { confirmation, confirm, chooseConfirmation } = useConfirmation();
  const [pane, setPane] = useState("");
  const {
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
  } = useRelations({
    workspace,
    workspaceRef,
    changeTree,
    selected,
    multiKeys,
    selectOne,
    setPane,
    setContext,
    setStatus,
  });
  const {
    autoSave,
    path,
    busy,
    busyRef,
    pausedRef,
    composingRef,
    setComposing,
    working,
    setEpoch,
    toggleAutoSave,
    save,
    openCopy,
  } = useDocumentFile({
    workspace,
    setWorkspace,
    workspaceRef,
    savedRef,
    historyRef,
    redoRef,
    dirtyRef,
    updateDirty,
    openingRef,
    pathRef,
    setStatus,
    setError,
    confirm,
    markTabsSaved,
    recordHistory,
    onOpened: (key) => {
      setRelationSource(null);
      setSelectedRelation(null);
      selectOne(key);
    },
  });
  const dirtyTabs = useMemo(
    () => workspace.tabs.map(isTabDirty),
    [workspace.tabs, savedVersion],
  );
  const doc = workspace.tabs[workspace.active];
  const summaryTopics = useMemo(
    () => multiKeys.size >= 2 ? prepareSummaryTopics(doc, Array.from(multiKeys)) : null,
    [doc, multiKeys],
  );
  const layout = resolveLayout(doc.tree.layout);
  const theme = resolveTemplate(doc.tree.template);
  const {
    dragRef,
    ghostRef,
    dropTarget,
    canDetach,
    dragGhost,
    dragStart,
    dragMove,
    dragEnd,
    dragCancel,
  } = useNodeDrag({
    workspace,
    workspaceRef,
    changeMap: (next) => changeMap(() => next),
    multiKeys,
    setMultiKeys,
    setSelected,
    setSelectedRelation,
    busyRef,
    composingRef,
    mapRef,
    layout,
    zoom,
    finishMotion,
    layoutBefore,
    animationsRef,
    setStatus,
    setError,
  });

  const {
    setAllTreesCollapsed,
    addFloating,
    changeText,
    changeNoteText,
    addChild,
    removeNode,
    handleKey,
    handlePaste,
  } = useTopicActions({
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
    cancelRelation: () => {
      setRelationSource(null);
      setSelectedRelation(null);
    },
    closeCanvasMenu: () => setCanvasContext(null),
    setStatus,
    setError,
    t,
  });

  function selectOne(key: string | null) {
    setMultiKeys(new Set());
    setSelected(key);
    setSelectedRelation(null);
  }
  const [summaryFocus, setSummaryFocus] = useState<string | null>(null);
  function addSummary() {
    const ws = workspaceRef.current,
      map = ws.tabs[ws.active];
    const topics = Array.from(multiKeys).filter(
      (key) => key !== map.tree.key && treeForKey(map, key),
    );
    if (topics.length < 2) {
      setStatus("Select at least two topics to add a summary");
      return;
    }
    const key = makeKey();
    if (
      changeMap((current) => createSummary(current, topics, key, t("Summary")))
    ) {
      setSummaryFocus(key);
      setContext(null);
      selectOne(key);
    }
  }
  function removeSummary(key: string) {
    if (changeMap((map) => removeMapTopics(map, new Set([key]))))
      selectOne(null);
  }
  function travel(from: Workspace[], to: Workspace[]) {
    if (busyRef.current || composingRef.current || !from.length) return;
    finishMotion();
    setRelationSource(null);
    setSelectedRelation(null);
    const editingNote =
      document.activeElement instanceof Element &&
      document.activeElement.matches(".floating-note textarea");
    const next = travelWorkspace(from, to);
    if (!next) return;
    selectOne(
      editingNote
        ? null
        : selected && treeForKey(next.tabs[next.active], selected)
          ? selected
          : next.tabs[next.active].tree.key,
    );
  }
  const {
    switchTab,
    addTab,
    reorderTab,
    closeTab,
    confirmCloseTab,
    renameTab,
    closeTarget,
    cancelCloseTab,
  } = useTabs({
    workspace,
    workspaceRef,
    commit,
    selectOne,
    setFocusTarget,
    cancelRelation: () => {
      setRelationSource(null);
      setSelectedRelation(null);
    },
    t,
  });
  function finishMotion() {
    animationsRef.current.forEach((animation) => animation.finish());
    animationsRef.current = [];
  }
  const { printDocument, exportImage, exportMarkdown, exportPdf } = useExports({
    workspaceRef,
    mapRef,
    canvasRef,
    zoom,
    busyRef,
    composingRef,
    finishMotion,
    working,
    setEpoch,
    setError,
    setStatus,
    t,
  });
  function selectOutline(key: string, center = false) {
    selectOne(key);
    if (center) requestAnimationFrame(() => centerNode(key));
  }
  function applyStyle(patch: Partial<NonNullable<NodeData["textStyle"]>>) {
    if (context)
      changeTree(context.key, (node) => ({
        ...node,
        textStyle: { ...node.textStyle, ...patch },
      }));
    setContext(null);
  }
  const handlers = {
    focus: selectOne,
    toggle: (key: string) => {
      const root =
        workspaceRef.current.tabs[workspaceRef.current.active].tree.key;
      const next = new Set(multiKeys);
      if (!next.size && selected && selected !== root) next.add(selected);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setMultiKeys(next);
      setSelected(next.values().next().value || null);
      setSelectedRelation(null);
    },
    text: changeText,
    edit: setFocusTarget,
    key: handleKey,
    paste: handlePaste,
    composition: (value: boolean) => {
      composingRef.current = value;
      setComposing(value);
    },
    context: contextMenu,
    dragStart,
    dragMove,
    dragEnd,
    dragCancel,
    relationPick,
    collapse: (key: string) =>
      changeTree(key, (node) => ({ ...node, collapsed: !node.collapsed })),
    preview: (src: string, text: string) => setPreview({ src, text }),
    link: (url: string) => {
      void confirm({
        title: "Open link?",
        message: "Open this link in the browser?",
        action: "Open link",
        detail: url,
      }).then((accepted) => {
        if (accepted)
          void invoke("open_link", { url }).catch((cause: unknown) =>
            setError(String(cause)),
          );
      });
    },
    openMenu: openNodeMenu,
  };
  const handlerRef = useRef<NodeHandlers>(handlers);
  handlerRef.current = handlers;
  const stableHandlers = useMemo<NodeHandlers>(
    () => ({
      focus: (...args) => handlerRef.current.focus(...args),
      toggle: (...args) => handlerRef.current.toggle(...args),
      text: (...args) => handlerRef.current.text(...args),
      edit: (...args) => handlerRef.current.edit(...args),
      key: (...args) => handlerRef.current.key(...args),
      paste: (...args) => handlerRef.current.paste(...args),
      composition: (...args) => handlerRef.current.composition(...args),
      context: (...args) => handlerRef.current.context(...args),
      dragStart: (...args) => handlerRef.current.dragStart(...args),
      dragMove: (...args) => handlerRef.current.dragMove(...args),
      dragEnd: (...args) => handlerRef.current.dragEnd(...args),
      dragCancel: (...args) => handlerRef.current.dragCancel(...args),
      relationPick: (...args) => handlerRef.current.relationPick(...args),
      collapse: (...args) => handlerRef.current.collapse(...args),
      preview: (...args) => handlerRef.current.preview(...args),
      link: (...args) => handlerRef.current.link(...args),
      openMenu: (...args) => handlerRef.current.openMenu(...args),
    }),
    [],
  );

  useEffect(() => {
    dragCancel();
    panRef.current = null;
    setMarquee(null);
    setPanning(false);
  }, [doc]);

  useTopicFocus({
    selected,
    viewKey,
    multiKeys,
    focusTarget,
    setFocusTarget,
    inputs,
    canvasRef,
    setPan,
    workspace,
  });
  const actions = useRef<{
    save: typeof save;
    undo: () => void;
    redo: () => void;
    key: typeof handleGlobalKey;
  }>(null);
  actions.current = {
    save,
    undo: () => travel(historyRef.current, redoRef.current),
    redo: () => travel(redoRef.current, historyRef.current),
    key: handleGlobalKey,
  };
  function handleGlobalKey(event: KeyboardEvent) {
    if (closeTarget || confirmation || settingsOpen) return;
    if (event.isComposing || event.keyCode === 229 || composingRef.current)
      return;
    const modifier = event.ctrlKey || event.metaKey;
    const target = event.target;
    if (event.key === "Escape") {
      if (relationSource) {
        setRelationSource(null);
        setStatus("Connection creation cancelled");
        event.preventDefault();
      } else if (dragRef.current) {
        dragCancel();
        event.preventDefault();
      } else if (panRef.current?.selecting) {
        panRef.current = null;
        setMarquee(null);
        setPanning(false);
        event.preventDefault();
      } else if (preview) {
        setPreview(null);
        event.preventDefault();
      } else if (
        relationContext ||
        context ||
        noteContext ||
        canvasContext ||
        menu ||
        menuOpen
      ) {
        setRelationContext(null);
        setContext(null);
        setNoteContext(null);
        setCanvasContext(null);
        setMenu("");
        setMenuOpen(false);
        event.preventDefault();
      } else if (pane) {
        setPane("");
        event.preventDefault();
      } else if (
        target instanceof Element &&
        target.matches(".node-text textarea")
      ) {
        event.preventDefault();
        (target as HTMLElement).blur();
      } else if (multiKeys.size) {
        selectOne(selected);
        event.preventDefault();
      }
      return;
    }
    if (
      handleEditorShortcut(event, {
        save: (as) => {
          void actions.current?.save(as);
        },
        undo: () => actions.current?.undo(),
        redo: () => actions.current?.redo(),
        openMenu: (name) => {
          setMenuOpen(true);
          setMenu(name);
        },
      })
    )
      return;
    if (
      modifier ||
      event.altKey ||
      busyRef.current ||
      !(target instanceof Element) ||
      target.closest("input,textarea,select,button,[contenteditable]")
    )
      return;
    if (event.key.toLowerCase() === "f" && !event.shiftKey) {
      event.preventDefault();
      fitCanvas();
      return;
    }
    if (
      !event.shiftKey &&
      selectedRelation !== null &&
      (event.key === "Delete" || event.key === "Backspace")
    ) {
      event.preventDefault();
      if (!event.repeat) updateRelation(selectedRelation, null);
      return;
    }
    if (
      !selected ||
      preview ||
      context ||
      noteContext ||
      canvasContext ||
      menuOpen ||
      pane ||
      dragRef.current ||
      relationSource
    )
      return;
    const tree = treeForKey(
      workspaceRef.current.tabs[workspaceRef.current.active],
      selected,
    );
    if (!tree) return;
    const node = findNode(tree, selected);
    if (!node) return;
    if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) {
        const parent = findParent(tree, selected);
        if (parent) {
          selectOne(parent);
          setFocusTarget(parent);
        }
      } else addChild(selected);
    } else if (!event.shiftKey && event.key === "F2") {
      event.preventDefault();
      setFocusTarget(selected);
    } else if (!event.shiftKey && event.key === "Enter") {
      event.preventDefault();
      if (!event.repeat) {
        if (selected === tree.key) setFocusTarget(selected);
        else addChild(selected, true);
      }
    } else if (
      !event.shiftKey &&
      (event.key === "Delete" || event.key === "Backspace")
    ) {
      event.preventDefault();
      if (!event.repeat) {
        if (multiKeys.size > 1) {
          if (changeMap((map) => removeMapTopics(map, multiKeys)))
            selectOne(null);
        } else removeNode(selected, false);
      }
    } else if (!event.shiftKey && event.key.startsWith("Arrow")) {
      event.preventDefault();
      if (event.key === "ArrowRight" && node.collapsed && node.children.length)
        changeTree(selected, (n) => ({ ...n, collapsed: false }));
      else {
        const next = adjacentNode(tree, selected, event.key, new Set(
          Array.from(inputs.current).filter(([, input]) => input.getClientRects().length > 0).map(([key]) => key),
        ));
        if (next) selectOne(next);
      }
    }
  }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      actions.current?.key(event);
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!pane) return;
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Element &&
        !panelRef.current?.contains(event.target) &&
        !event.target.closest(".structure-control")
      )
        setPane("");
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [pane]);
  const visibleStatus =
    dirtyRef.current && !busy && !pausedRef.current
      ? !path
        ? "Unsaved changes · Save the file first"
        : autoSave
          ? "Waiting to auto-save"
          : "Unsaved changes · Auto-save is off"
      : status;
  return (
    <LanguageProvider value={language}>
      <main
        data-theme={theme}
        style={
          {
            "--default-font-size": `${display.systemFontSize}px`,
            "--content-font-size": `${display.contentFontSize}px`,
            "--font-adjust": `${display.systemFontSize - 14}px`,
            "--tab-height": `${display.tabHeight}px`,
            "--status-height": `${display.statusHeight}px`,
          } as React.CSSProperties
        }
        onClick={() => {
          if (context) setContext(null);
          if (noteContext) setNoteContext(null);
          if (relationContext) setRelationContext(null);
          if (canvasContext) setCanvasContext(null);
        }}
      >
        <header className="top-bar">
          <WorkspaceMenu
            open={menuOpen}
            setOpen={setMenuOpen}
            menu={menu}
            setMenu={setMenu}
            busy={busy}
            layout={layout}
            onOpen={openCopy}
            onSave={save}
            exportMarkdown={exportMarkdown}
            exportImage={exportImage}
            exportPdf={exportPdf}
            onUndo={() => travel(historyRef.current, redoRef.current)}
            onRedo={() => travel(redoRef.current, historyRef.current)}
            onAddChild={(sibling) => addChild(selected, sibling)}
            canAddSibling={!doc.tree.summaries?.some((summary) => summary.key === selected)}
            onAddFloating={addFloating}
            onAddSummary={addSummary}
            canAddSummary={!!summaryTopics}
            onZoom={adjustZoom}
            onFit={fitCanvas}
            onResetZoom={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            onCollapseAll={setAllTreesCollapsed}
            onLayout={(value) =>
              changeTree(doc.tree.key, (node) =>
                node.layout === value ? node : { ...node, layout: value },
              )
            }
            onOutline={() => setPane("outline")}
            onSettings={() => setSettingsOpen(true)}
          />
          <TabBar
            tabs={workspace.tabs}
            dirtyTabs={dirtyTabs}
            active={workspace.active}
            onSelect={switchTab}
            onClose={closeTab}
            onAdd={addTab}
            onReorder={reorderTab}
            onRename={renameTab}
          />
        </header>
        {error && (
          <div className="error" role="alert">
            {t(error)}{" "}
            <button aria-label={t("Close")} onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        <Canvas
          canvasRef={canvasRef}
          mapRef={mapRef}
          theme={theme}
          layout={layout}
          zoom={zoom}
          pan={pan}
          panning={panning}
          onPointerDown={panStart}
          onPointerMove={panMove}
          onPointerEnd={panEnd}
          onContextMenu={canvasContextMenu}
          floating={{
            topics: doc.floatingTopics || noFloatingTopics,
            notes: doc.floatingNotes || [],
            noteFocus,
            fontSize: display.contentFontSize,
            onNoteFocus: () => {
              setNoteFocus(null);
              selectOne(null);
            },
            onNoteText: changeNoteText,
            onNoteMenu: openNoteMenu,
            onMove: (kind, key, x, y) =>
              changeMap((map) =>
                kind === "topic"
                  ? {
                      floatingTopics: (map.floatingTopics || []).map((topic) =>
                        topic.tree.key === key ? { ...topic, x, y } : topic,
                      ),
                    }
                  : {
                      floatingNotes: (map.floatingNotes || []).map((note) =>
                        note.key === key ? { ...note, x, y } : note,
                      ),
                    },
              ),
          }}
          node={{
            node: doc.tree,
            selected,
            inputs,
            handlers: stableHandlers,
            opening: busy,
            dropTarget,
            dragKeys: dragGhost?.keys,
            multiKeys,
            relationSource,
            layout,
          }}
          relation={{
            selected: selectedRelation,
            edit: relationEdit,
            setEdit: setRelationEdit,
            cancelEdit: cancelRelationEdit,
            onSave: saveRelationLabel,
            onAdjust: adjustRelation,
            onSelect: (index) => {
              setSelectedRelation(index);
              setMultiKeys(new Set());
            },
            onEdit: editRelation,
            onContext: (index, x, y) => {
              const key = doc.tree.relations?.[index]?.relKey;
              if (!key) return;
              setContext(null);
              setSelectedRelation(index);
              setRelationContext({
                key,
                tab: workspaceRef.current.active,
                viewKey,
                x: Math.max(0, Math.min(x, window.innerWidth - 160)),
                y: Math.max(0, Math.min(y, window.innerHeight - 85)),
              });
            },
          }}
          summary={{
            focus: summaryFocus,
            setFocus: setSummaryFocus,
            onRemove: removeSummary,
          }}
        />

        <StatusBar
          status={visibleStatus}
          path={path}
          dirty={dirtyRef.current}
          paused={pausedRef.current}
          autoSave={autoSave}
          busy={busy}
          zoom={zoom}
          onToggleAutoSave={toggleAutoSave}
          onFit={fitCanvas}
          onZoom={adjustZoom}
        />
        {pane && (
          <StructurePanel
            panelRef={panelRef}
            tree={doc.tree}
            floatingTopics={doc.floatingTopics}
            floatingNotes={doc.floatingNotes}
            selected={selected}
            onClose={() => setPane("")}
            onSelect={selectOutline}
            onToggle={(key) =>
              changeTree(key, (node) => ({
                ...node,
                collapsed: !node.collapsed,
              }))
            }
            onText={changeText}
            onNoteText={changeNoteText}
            onNoteSelect={(key, center) => {
              selectOne(null);
              if (center) requestAnimationFrame(() => centerNode(key));
            }}
            onComposition={(value) => {
              composingRef.current = value;
              setComposing(value);
            }}
          />
        )}
        <RelationGuide mapRef={mapRef} source={relationSource} />
        <RelationEditor
          context={relationContext}
          setContext={setRelationContext}
          findIndex={relationIndex}
          onEdit={editRelation}
          onDelete={(index) => updateRelation(index, null)}
        />
        {marquee && (
          <div
            className="selection-box"
            style={{
              left: marquee.left,
              top: marquee.top,
              width: marquee.right - marquee.left,
              height: marquee.bottom - marquee.top,
            }}
            aria-hidden="true"
          />
        )}
        {dragGhost && (
          <div
            ref={ghostRef}
            className="drag-ghost"
            style={{ left: dragGhost.x + 16, top: dragGhost.y + 16 }}
            aria-hidden="true"
          >
            <strong>
              {dragGhost.keys.length > 1
                ? `${dragGhost.keys.length} ${t("topics")}`
                : dragGhost.text || t("Image topic")}
            </strong>
            <span>
              {dropTarget
                ? `${t(dropTarget.position === "inside" ? (dropTarget.side === "left" ? "As a left-side child topic" : dropTarget.side === "right" ? "As a right-side child topic" : "As a child topic") : dropTarget.position === "before" ? "Insert above" : "Insert below")} · ${findNode(treeForKey(doc, dropTarget.key) || doc.tree, dropTarget.key)?.text || t("Image topic")}`
                : t(
                    canDetach
                      ? "Release to place as independent topics"
                      : "Drag onto a target topic",
                  )}
            </span>
          </div>
        )}
        <TopicContextMenus
          map={doc}
          topic={context}
          note={noteContext}
          onTopicStyle={applyStyle}
          onTopicRelation={(key) => {
            setContext(null);
            startRelation(key);
          }}
          multipleTopics={!!context && multiKeys.has(context.key) && multiKeys.size >= 2}
          onTopicSummary={addSummary}
          canAddSummary={!!context && multiKeys.has(context.key) && !!summaryTopics}
          onTopicRemove={(key) => {
            if (multiKeys.has(key) && multiKeys.size > 1) {
              if (changeMap((map) => removeMapTopics(map, multiKeys)))
                selectOne(null);
            } else removeNode(key);
            setContext(null);
          }}
          onNoteStyle={(key, patch) => {
            changeMap((map) => ({
              floatingNotes: (map.floatingNotes || []).map((item) =>
                item.key === key
                  ? { ...item, textStyle: { ...item.textStyle, ...patch } }
                  : item,
              ),
            }));
            setNoteContext(null);
          }}
          onNoteRemove={(key) => {
            changeMap((map) => ({
              floatingNotes: (map.floatingNotes || []).filter(
                (item) => item.key !== key,
              ),
            }));
            setNoteContext(null);
          }}
        />
        {canvasContext && (
          <div
            className="context canvas-context"
            style={{ left: canvasContext.x, top: canvasContext.y }}
          >
            <div className="context-actions">
              <button
                type="button"
                onClick={() =>
                  addFloating("topic", {
                    x: canvasContext.mapX,
                    y: canvasContext.mapY,
                  })
                }
              >
                <MenuLabel label="Add independent topic" />
              </button>
              <button
                type="button"
                onClick={() =>
                  addFloating("note", {
                    x: canvasContext.mapX,
                    y: canvasContext.mapY,
                  })
                }
              >
                <MenuLabel label="Add floating note" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setCanvasContext(null);
                  void exportImage("png", true);
                }}
              >
                <MenuLabel label="Copy PNG to clipboard" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setCanvasContext(null);
                  setPane("outline");
                }}
              >
                <MenuLabel label="View outline" />
              </button>
            </div>
          </div>
        )}
        {preview && (
          <div className="overlay" onClick={() => setPreview(null)}>
            <div className="preview">
              <img src={preview.src} alt={preview.text || t("Topic image")} />
              {preview.text && <p>{preview.text}</p>}
            </div>
          </div>
        )}
        {closeTarget && (
          <CloseTabDialog
            title={closeTarget.tree.tabTitle || closeTarget.tree.text}
            onCancel={cancelCloseTab}
            onConfirm={confirmCloseTab}
          />
        )}
        {confirmation && (
          <ConfirmDialog prompt={confirmation} onChoose={chooseConfirmation} />
        )}
        {settingsOpen && (
          <SettingsDialog
            language={languagePreference}
            theme={theme}
            display={display}
            onLanguage={setLanguagePreference}
            onTheme={(value) =>
              changeTree(doc.tree.key, (node) =>
                node.template === value ? node : { ...node, template: value },
              )
            }
            onDisplay={setDisplay}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </main>
      {printDocument && <PrintDocument {...printDocument} />}
    </LanguageProvider>
  );
}

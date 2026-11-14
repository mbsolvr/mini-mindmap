# Application structure

`App.tsx` composes the workspace and coordinates selection, menus, and interactions that cross feature boundaries. Workspace data has one owner: `useWorkspace`. UI components call commands rather than keeping their own copies of document data.

- `useWorkspace` validates edits, records undo snapshots, and tracks saved state.
- `useDocumentFile` owns file operations, automatic saving, and recovery. Rust performs filesystem writes.
- `xmind.ts` converts XMind sheets to/from the existing map model; `xmindXml.ts` normalizes legacy XML. `zip.ts` validates archive directories for both native and XMind files. See [file formats](file-formats.md) for storage and exchange boundaries.
- `useTopicActions` owns topic and note edits, hierarchy changes, and image paste. Every edit uses the existing workspace transactions; focus changes only after a successful edit.
- `useTopicFocus` owns editor focus and keeping the selected topic visible. It preserves each tab's viewport when switching tabs.
- `keyboard.ts` contains keyboard decisions and common shortcuts. `App` handles modal guards, Escape priority, and selection-specific actions. Saving from an editor commits its blur handler before writing the file.
- `useContextMenus` owns topic, note, and canvas context-menu state and screen positioning.
- `WorkspaceMenu` and `TopicContextMenus` render menus and report user actions. They do not mutate documents.
- `useCanvas`, `useNodeDrag`, and `useRelations` own their respective interaction state.
- `useRelationDrag` keeps curve previews outside the document and commits once on release. Changing the document or zoom cancels a gesture. Connection controls are map-space offsets from each endpoint's topic center, so moving a topic preserves its handle offset. File parsing validates both controls; export and canvas fitting include curved connections in their bounds.

## Styles

`style.css` is the stylesheet entry point. Its imports are ordered:

1. `base.css`: document defaults and basic controls.
2. `canvas.css`: nodes, connectors, layouts, movement, and preview.
3. `workspace.css`: navigation, tabs, status, outline, and menus.
4. `themes.css`: workspace and canvas palettes and themed controls.
5. `dialogs.css`: settings and confirmation dialogs.
6. `print.css`: the printable document and print media rules.

The theme rules override structural defaults. Keep this order when adding styles. Add geometry and interaction rules to the owning module and palette changes to `themes.css`.

## Verification

Run `npm run test:all` and `npm run build` after changes to editing or workspace coordination. The browser tests cover focus, image paste, drag and group operations, undo, file workflows, menus, themes, and export. They use a simulated Tauri bridge; native clipboard and platform dialogs still require desktop validation. See [performance measurements](performance.md) for browser performance tests.

See [testing](testing.md) for the stability scenarios and their limits. English strings remain the source messages; `locales/zh.ts`, `locales/ja.ts`, and `locales/ko.ts` contain translations. Catalog tests require the same keys in every translation, and language preferences are validated before use.

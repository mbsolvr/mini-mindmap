# Testing

Run `npm run test:all` and `npm run build` before changing editing behavior, storage, or document structure. The suite uses deterministic samples and temporary files; it does not open your documents.

## Coverage

| Layer | Checks |
| --- | --- |
| Model and archives | Object and depth limits, images, corrupted archives, cross-tree moves, connection controls, immutable snapshots, and save/open round trips. |
| Curves | Four fixed random seeds produce 2048 rectangle/control combinations. Endpoints stay on topic edges, coordinates stay finite, and translating or reversing a curve preserves its geometry. Sixty cross-tree move/archive cycles retain edited controls. |
| Pointer gestures | Both handles at 20%, 100%, 110%, and 200% zoom; release coordinates, small jitter, unrelated pointers, interruption, tab/document changes, cancellation before effect cleanup, and 200 repeated gestures with listener/capture cleanup checks. |
| History | Eighty mixed topic, note, position, and curve edits undo and redo exactly. Tests check saved-state checkpoints, new history branches, unchanged snapshots, and eviction after the 100-snapshot limit. |
| File failures | Cancelled dialogs, failed writes and retries, overlapping commands, IME guards, files changed during opening, and invalid connection data preserve file identity and the current workspace. These failures use a simulated desktop bridge. |
| Recovery | Controlled timers and pending promises test startup guards, restore/discard decisions, ordered writes and clears, write failures, retry, debounce, and unmount cleanup. |
| Languages | Catalog completeness, composed errors, exports, unknown-text fallback, system locales, persisted preferences, blocked storage, and manual language overrides. |
| Browser | Real React, DOM layout, keyboard and pointer events, editing, group moves, inline labels, cancellation, menus, exports, recovery, simulated file launches, and Japanese/Korean settings across all themes and page reloads. Uncaught errors and rejected promises fail the test. |
| Rust | Real temporary files test atomic replacement, external changes, interrupted writes, invalid data, directory synchronization failure, single-instance locking, and export validation. |

The hook test helper controls state and effect boundaries without a DOM. It complements the browser suite; it is not a replacement for React integration tests.

## Commands

- `npm test`: model, archive, command, hook, and rendering tests.
- `npm run test:ui`: browser regression with an isolated Chromium profile and a simulated Tauri bridge. Requires Chromium and a matching ChromeDriver on `PATH`; `CHROME_BIN` can select the browser. Poppler tools enable additional PDF checks when available.
- `npm run test:stress`: 200 edit/move/save/open cycles on a 2001-topic map. Set `MINIMAP_STRESS_CYCLES` to a value from 1 to 10000 for a longer run.
- `cargo test --offline --manifest-path src-tauri/Cargo.toml`: Rust storage and desktop-boundary tests, using cached dependencies.
- `npm run build`: strict TypeScript checking and production frontend build.
- `npm run test:perf-ui`: browser performance measurements; see [performance](performance.md).

The release workflow runs frontend tests and Rust tests on each release platform. Browser and stress checks are available locally through `test:all`.

## Limits

Browser tests simulate native dialogs, clipboard operations, and window closing. They do not prove native WebView behavior, power-loss durability on every filesystem, or actual disk-full handling. Native Windows/macOS interaction and translation wording still need platform and native-speaker review. No coverage percentage is claimed without instrumentation.

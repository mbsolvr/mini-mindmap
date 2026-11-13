# Performance measurements

The UI benchmark measures a production frontend in headless Chromium using an isolated browser profile and a simulated Tauri bridge. It has been verified on Linux; Windows and macOS runs still need validation. It is repeatable without changing a user's maps or settings. It does not measure the native Tauri WebView, native dialogs, input methods, GPU behavior on a real desktop, or Rust file I/O.

## Run

Install the project dependencies, Python 3, Chromium and a matching ChromeDriver. Then run:

```sh
npm run test:perf-ui -- --output benchmark-local-ui.json
```

The command runs the metric self-tests, builds the production frontend, and measures maps containing 100, 500, and 1,000 topics. JSON is written to the requested file; progress goes to stderr. Use `--nodes 100,500` to choose topic counts from 2 to 5,000, or omit `--output` to print the report to stdout.

To compare a change, save a baseline before modifying the code, then run the same command again:

```sh
npm run test:perf-ui -- --baseline benchmark-local-ui.json --output benchmark-local-ui-after.json
```

The `comparison` section gives the ratio of current to baseline p95 for each metric: `1.0` means unchanged and `1.2` means 20% higher. The benchmark rejects baselines with different topic counts, browser versions, operating systems, or viewport sizes. Use the same machine and power settings, close other heavy programs, and run each version several times; the tool cannot verify that hardware or system load is identical. Local benchmark files are ignored by Git and contain no usernames or machine names.

## Scenarios and metrics

Each sample is a deterministic four-way tree with short text. The test verifies that all topics are rendered and that each interaction changes the canvas or node data. It measures:

- `idle_frames`: animation-frame intervals while the canvas is idle, as a reference for the browser's timing.
- `pan_frames`: frame intervals while holding Space and dragging the canvas.
- `zoom_frames`: frame intervals during repeated Ctrl+wheel events.
- `drag_frames`: frame intervals while a topic is dragged onto empty canvas and for 400 ms after release.
- `input_to_frame`: time from an input event to the second following animation-frame callback, for 20 inserted characters.

Frame metrics include the median, p95, maximum, sample count, average FPS (frame intervals divided by their total duration), and percentage above 25 ms. A 60 Hz display has approximately 16.7 ms per frame; the 25 ms count is a simple indicator of longer gaps, not a precise count of dropped display frames. Input timing is a rendering proxy, not a measurement of physical keyboard latency or completed display presentation. The benchmark does not simulate Chinese IME composition.

There are no automatic pass thresholds yet. Establish baselines on representative hardware and actual Tauri windows before setting a 60 Hz target. These samples do not include large images, deep trees, many relations, or multiple tabs; add scenarios when measuring those workloads.

For data-operation and archive timings, use `node tests/benchmark.mjs`; those measurements are separate from UI rendering.

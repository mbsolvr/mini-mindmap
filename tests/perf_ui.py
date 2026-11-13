#!/usr/bin/env python3
"""Measure UI interactions in a production build with headless Chromium."""
import argparse
import json
import math
import os
import platform
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from ui_smoke import BRIDGE, ROOT, free_port, request, wait_for


def sample_map(count):
    nodes = [{"key": f"n{i}", "text": f"Topic {i}", "children": []} for i in range(count)]
    for i in range(1, count):
        nodes[(i - 1) // 4]["children"].append(nodes[i])
    return {"format": "mini-mindmap", "version": 2, "type": "map", "tree": nodes[0]}


def distribution(samples):
    if not samples:
        raise ValueError("No timing samples were collected")
    values = sorted(samples)
    def percentile(p):
        return round(values[min(len(values) - 1, int((len(values) - 1) * p + .5))], 2)
    return {"samples": len(values), "median_ms": round(statistics.median(values), 2),
            "p95_ms": percentile(.95), "max_ms": round(values[-1], 2)}


def compare(results, baseline):
    previous = {case["nodes"]: case for case in baseline.get("scenarios", [])}
    comparisons = []
    for case in results:
        old = previous.get(case["nodes"])
        if not old:
            continue
        entry = {"nodes": case["nodes"]}
        for name in ("idle_frames", "pan_frames", "zoom_frames", "drag_frames", "input_to_frame"):
            value = old[name]["p95_ms"]
            entry[name + "_p95_ratio"] = round(case[name]["p95_ms"] / value, 2) if value > 0 else None
        comparisons.append(entry)
    return comparisons


def validate_baseline(baseline, report, counts):
    fields = ("schema", "engine", "viewport", "os", "browser_version")
    if not isinstance(baseline, dict) or any(baseline.get(field) != report[field] for field in fields):
        raise ValueError("Baseline schema, engine, browser, OS, and viewport must match")
    scenarios = baseline.get("scenarios")
    if not isinstance(scenarios, list) or any(not isinstance(case, dict) for case in scenarios):
        raise ValueError("Invalid baseline scenarios")
    if any(not isinstance(case.get("nodes"), int) or isinstance(case.get("nodes"), bool) for case in scenarios):
        raise ValueError("Invalid baseline topic counts")
    if len(scenarios) != len(counts) or {case["nodes"] for case in scenarios} != set(counts):
        raise ValueError("Baseline topic counts must match")
    for case in scenarios:
        for name in ("idle_frames", "pan_frames", "zoom_frames", "drag_frames", "input_to_frame"):
            metric = case.get(name)
            value = metric.get("p95_ms") if isinstance(metric, dict) else None
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value < 0:
                raise ValueError(f"Invalid baseline metric: {name}")


def run(counts):
    chrome = os.environ.get("CHROME_BIN") or shutil.which("chromium") or shutil.which("google-chrome")
    driver = shutil.which("chromedriver")
    node = shutil.which("node")
    vite = ROOT / "node_modules/vite/bin/vite.js"
    if not chrome or not driver or not node or not vite.exists() or not (ROOT / "dist/index.html").exists():
        raise RuntimeError("Build the app and install Chromium and a matching ChromeDriver first")
    with tempfile.TemporaryDirectory(prefix="mini-mindmap-perf-") as tmp:
        app_port, driver_port = free_port(), free_port()
        while driver_port == app_port:
            driver_port = free_port()
        processes, session = [], None
        with open(Path(tmp) / "services.log", "w+") as log:
            try:
                processes.append(subprocess.Popen([node, str(vite), "preview", "--host", "127.0.0.1", "--port", str(app_port), "--strictPort"], cwd=ROOT, stdout=log, stderr=log))
                processes.append(subprocess.Popen([driver, f"--port={driver_port}", "--allowed-ips=127.0.0.1"], stdout=log, stderr=log))
                base = f"http://127.0.0.1:{driver_port}"
                wait_for(lambda: request(base + "/status"), "ChromeDriver")
                wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{app_port}", timeout=1).status == 200, "preview server")
                options = {"binary": chrome, "args": ["--headless=new", "--disable-dev-shm-usage", "--window-size=1280,900", f"--user-data-dir={tmp}/profile"]}
                if hasattr(os, "geteuid") and os.geteuid() == 0:
                    options["args"].append("--no-sandbox")
                created = request(base + "/session", {"capabilities": {"alwaysMatch": {"browserName": "chrome", "goog:chromeOptions": options}}})
                session = created["sessionId"]
                api = f"{base}/session/{session}"
                request(api + "/timeouts", {"script": 60000})
                request(api + "/goog/cdp/execute", {"cmd": "Page.addScriptToEvaluateOnNewDocument", "params": {"source": BRIDGE}})
                def script(code, *args):
                    return request(api + "/execute/sync", {"script": code, "args": list(args)})
                def async_script(code, *args):
                    return request(api + "/execute/async", {"script": code, "args": list(args)})
                def click(selector):
                    element = request(api + "/element", {"using": "css selector", "value": selector})
                    request(api + "/element/" + element["element-6066-11e4-a52e-4f735466cecf"] + "/click", {})
                def start_frames():
                    script("window.__frames=[]; window.__tracking=true; let last; function tick(t){if(!window.__tracking)return; if(last!==undefined)window.__frames.push(t-last); last=t; requestAnimationFrame(tick)} requestAnimationFrame(tick)")
                def stop_frames():
                    return script("window.__tracking=false; return window.__frames")
                cases = []
                request(api + "/url", {"url": f"http://127.0.0.1:{app_port}/"})
                for count in counts:
                    print(f"Measuring {count} topics...", file=sys.stderr, flush=True)
                    script("sessionStorage.setItem('recovery', arguments[0])", json.dumps(sample_map(count), ensure_ascii=False))
                    request(api + "/refresh", {})
                    wait_for(lambda: script("return document.querySelector('#confirm-title')?.textContent") == "Recover unsaved work?", "recovery prompt", 30)
                    click(".close-tab-actions .confirm-action")
                    wait_for(lambda: script("return document.querySelectorAll('.node').length") == count, "rendered topics", 60)
                    async_script("const done=arguments[arguments.length-1]; requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)))")
                    time.sleep(.8)
                    start_frames()
                    time.sleep(1.2)
                    idle = stop_frames()
                    point = script("""const canvas=document.querySelector('.canvas'), r=canvas.getBoundingClientRect();
                      for(let y=Math.ceil(r.top)+10;y<r.bottom-60;y+=30) for(let x=10;x<r.right-260;x+=30)
                        if(document.elementFromPoint(x,y)===canvas) return [x,y]; return null""")
                    if not point:
                        raise RuntimeError("Could not find an empty canvas area for panning")
                    before = script("return document.querySelector('.map').style.transform")
                    start_frames()
                    request(api + "/actions", {"actions": [{"type": "key", "id": "keyboard", "actions": [{"type": "keyDown", "value": " "}, {"type": "pause", "duration": 0}, {"type": "pause", "duration": 1200}, {"type": "keyUp", "value": " "}]}, {"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [
                        {"type": "pointerMove", "duration": 0, "x": point[0], "y": point[1]}, {"type": "pointerDown", "button": 0},
                        {"type": "pointerMove", "duration": 1200, "x": point[0]+215, "y": point[1]+40}, {"type": "pointerUp", "button": 0}]}]})
                    pan = stop_frames()
                    if script("return document.querySelector('.map').style.transform") == before:
                        raise RuntimeError("Canvas did not move during the pan measurement")
                    before_zoom = script("return document.querySelector('.map').style.zoom")
                    start_frames()
                    for _ in range(20):
                        request(api + "/goog/cdp/execute", {"cmd": "Input.dispatchMouseEvent", "params": {"type": "mouseWheel", "x": point[0], "y": point[1], "deltaX": 0, "deltaY": -15, "modifiers": 2}})
                        time.sleep(.04)
                    zoom = stop_frames()
                    if script("return document.querySelector('.map').style.zoom") == before_zoom:
                        raise RuntimeError("Canvas did not zoom during the wheel measurement")
                    drag = script("""const c=document.querySelector('.canvas').getBoundingClientRect();
                      for (const card of document.querySelectorAll('.node:not(.root-node)')) {
                        const r=card.getBoundingClientRect();
                        if (r.width < 3 || r.height < 3) continue;
                        const x=Math.round(r.left+r.width/2), y=Math.round(r.top+r.height/2), hit=document.elementFromPoint(x,y);
                        if(x>c.left+3 && x<c.right-3 && y>c.top+3 && y<c.bottom-3 && hit?.closest('[data-drop-key]')===card)
                          return {key:card.dataset.dropKey,x,y};
                      } return null""")
                    blank = script("""const canvas=document.querySelector('.canvas'), r=canvas.getBoundingClientRect();
                      for(let y=Math.ceil(r.top)+10;y<r.bottom-10;y+=30) for(let x=10;x<r.right-10;x+=30)
                        if(document.elementFromPoint(x,y)===canvas) return [x,y]; return null""")
                    if not drag or not blank:
                        raise RuntimeError("Could not find a visible topic and empty canvas")
                    start_frames()
                    request(api + "/actions", {"actions": [{"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [
                        {"type": "pointerMove", "duration": 0, "x": drag["x"], "y": drag["y"]}, {"type": "pointerDown", "button": 0},
                        {"type": "pointerMove", "duration": 1200, "x": blank[0], "y": blank[1]}, {"type": "pointerUp", "button": 0}]}]})
                    time.sleep(.4)
                    drag_frames = stop_frames()
                    wait_for(lambda: script("return !!document.querySelector('.floating-topic [data-drop-key=\"' + arguments[0] + '\"]')", drag["key"]), "dragged topic", 30)
                    script("const el=document.querySelector('.root-node textarea'); el.focus(); el.setSelectionRange(el.value.length,el.value.length); window.__inputTimes=[]; el.addEventListener('input',()=>{const start=performance.now(); requestAnimationFrame(()=>requestAnimationFrame(()=>window.__inputTimes.push(performance.now()-start)))})")
                    for _ in range(20):
                        request(api + "/goog/cdp/execute", {"cmd": "Input.insertText", "params": {"text": "x"}})
                        time.sleep(.04)
                    wait_for(lambda: script("return window.__inputTimes.length") == 20, "input timing samples", 30)
                    if script("return document.querySelector('.root-node textarea').value") != "Topic 0" + "x" * 20:
                        raise RuntimeError("Input did not update the topic")
                    inputs = script("return window.__inputTimes")
                    def frame_summary(values):
                        if len(values) < 20:
                            raise RuntimeError("Too few animation frames were collected")
                        summary = distribution(values)
                        summary["average_fps"] = round(1000 * len(values) / sum(values), 1)
                        summary["over_25ms_percent"] = round(100 * sum(v > 25 for v in values) / len(values), 1)
                        return summary
                    cases.append({"nodes": count, "idle_frames": frame_summary(idle), "pan_frames": frame_summary(pan), "zoom_frames": frame_summary(zoom), "drag_frames": frame_summary(drag_frames), "input_to_frame": distribution(inputs)})
                return {"schema": 1, "engine": "headless Chromium, production frontend, simulated Tauri bridge", "browser_version": created.get("capabilities", {}).get("browserVersion"), "os": platform.system(), "viewport": script("return [innerWidth,innerHeight]"), "scenarios": cases}
            finally:
                if session:
                    try:
                        req = urllib.request.Request(base + "/session/" + session, method="DELETE")
                        urllib.request.urlopen(req, timeout=3).close()
                    except OSError:
                        pass
                for proc in processes:
                    proc.terminate()
                for proc in processes:
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nodes", default="100,500,1000", help="comma-separated topic counts, each between 2 and 5000")
    parser.add_argument("--output", type=Path, help="write JSON results to this file")
    parser.add_argument("--baseline", type=Path, help="compare against a previous JSON result")
    args = parser.parse_args()
    try:
        counts = [int(value) for value in args.nodes.split(",")]
        if not counts or any(n < 2 or n > 5000 for n in counts) or len(set(counts)) != len(counts):
            raise ValueError("Topic counts must be unique and between 2 and 5000")
        report = run(counts)
        if args.baseline:
            baseline = json.loads(args.baseline.read_text())
            validate_baseline(baseline, report, counts)
            report["comparison"] = compare(report["scenarios"], baseline)
        output = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            args.output.write_text(output)
        else:
            print(output, end="")
    except (ValueError, RuntimeError, OSError, AssertionError, subprocess.SubprocessError) as error:
        print(f"Performance test failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

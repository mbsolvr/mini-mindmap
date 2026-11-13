#!/usr/bin/env python3
"""Exercise the built-in UI in an isolated Chromium profile with a fake Tauri bridge."""
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ELEMENT = "element-6066-11e4-a52e-4f735466cecf"
BRIDGE = """(() => {
  const state = window.__miniTest = { saved: null, exports: [], clipboard: null, errors: JSON.parse(sessionStorage.getItem('test-errors') || '[]'), launches: JSON.parse(sessionStorage.getItem('test-launches') || '[]') };
  sessionStorage.removeItem('test-launches');
  const recordError = message => { state.errors.push(String(message)); sessionStorage.setItem('test-errors', JSON.stringify(state.errors)); };
  window.addEventListener('error', event => recordError(event.message));
  window.addEventListener('unhandledrejection', event => recordError(event.reason));
  window.print = () => { state.printed = true; };
  window.__TAURI__ = {
    core: { invoke: async (command, args = {}) => {
      if (command === 'save_as' || command === 'save_current') {
        state.saved = args.contents;
        return {path: '/tmp/mini-mindmap-test.minimap', warning: null};
      }
      if (command === 'open_copy') return state.saved && { name: 'test.minimap', contents: state.saved };
      if (command === 'open_launched') return state.launches.shift() || null;
      if (command === 'accept_open') return '/tmp/mini-mindmap-test.minimap';
      if (command === 'export_file') { state.exports.push(args); return true; }
      if (command === 'copy_png') { state.clipboard = args.data; return; }
      if (command === 'open_link' || command === 'clear_target') return null;
      if (command === 'read_recovery') return sessionStorage.getItem('recovery');
      if (command === 'write_recovery') { if (state.failRecovery) throw new Error('simulated recovery write failure'); sessionStorage.setItem('recovery', args.contents); return null; }
      if (command === 'clear_recovery') { sessionStorage.removeItem('recovery'); return null; }
      throw new Error('Unexpected test command: ' + command);
    } },
    event: { listen: async (_event, handler) => { state.launchListener = handler; return () => { state.launchListener = null; }; } },
    window: { getCurrentWindow: () => ({ setTitle: async title => { state.title = title; }, destroy: async () => { state.destroyed = true; }, onCloseRequested: async handler => { state.close = handler; return () => {}; } }) }
  };
})();"""


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def request(url, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, body, {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"WebDriver error: {error.read().decode()}") from error
    value = result.get("value")
    if isinstance(value, dict) and "error" in value:
        raise RuntimeError(value.get("message", value["error"]))
    return value


def wait_for(fn, description, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            value = fn()
            if value:
                return value
        except (OSError, urllib.error.URLError, RuntimeError):
            pass
        time.sleep(.05)
    raise AssertionError(f"Timed out waiting for {description}")


def contrast_ratio(foreground, background):
    def luminance(color):
        channels = [int(value) / 255 for value in color[4:-1].split(',')]
        linear = [value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4 for value in channels]
        return sum(value * weight for value, weight in zip(linear, (.2126, .7152, .0722)))
    dark, light = sorted((luminance(foreground), luminance(background)))
    return (light + .05) / (dark + .05)


def run():
    driver = os.environ.get("CHROMEDRIVER_BIN") or shutil.which("chromedriver")
    chrome = os.environ.get("CHROME_BIN") or shutil.which("chromium") or shutil.which("google-chrome")
    vite = ROOT / "node_modules/.bin/vite"
    if not driver or not chrome or not vite.exists():
        raise RuntimeError("Install Chromium, matching ChromeDriver, and project npm dependencies first")
    with tempfile.TemporaryDirectory(prefix="mini-mindmap-ui-") as tmp:
        app_port, driver_port = free_port(), free_port()
        while driver_port == app_port:
            driver_port = free_port()
        log = open(Path(tmp) / "services.log", "w+")
        processes = []
        session = None
        try:
            processes.append(subprocess.Popen([str(vite), "--host", "127.0.0.1", "--port", str(app_port), "--strictPort"], cwd=ROOT, stdout=log, stderr=log))
            processes.append(subprocess.Popen([driver, f"--port={driver_port}", "--allowed-ips=127.0.0.1"], stdout=log, stderr=log))
            base = f"http://127.0.0.1:{driver_port}"
            wait_for(lambda: request(base + "/status"), "ChromeDriver")
            wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{app_port}", timeout=1).status == 200, "test server")
            options = {"binary": chrome, "args": ["--headless=new", "--disable-dev-shm-usage", "--window-size=1280,900", f"--user-data-dir={tmp}/profile"]}
            if os.geteuid() == 0:
                options["args"].append("--no-sandbox")
            created = request(base + "/session", {"capabilities": {"alwaysMatch": {"browserName": "chrome", "goog:chromeOptions": options}}})
            session = created["sessionId"]
            api = f"{base}/session/{session}"
            request(api + "/goog/cdp/execute", {"cmd": "Page.addScriptToEvaluateOnNewDocument", "params": {"source": BRIDGE}})
            request(api + "/url", {"url": f"http://127.0.0.1:{app_port}/"})

            def script(code, *args):
                return request(api + "/execute/sync", {"script": code, "args": list(args)})

            def element(selector):
                return request(api + "/element", {"using": "css selector", "value": selector})[ELEMENT]

            def click(selector):
                target = wait_for(lambda: element(selector), selector)
                point = script("""const el=document.querySelector(arguments[0]);
                  if(el?.matches('textarea') && getComputedStyle(el).pointerEvents==='none') {
                    const r=el.getBoundingClientRect(); return [Math.round(r.x+r.width/2), Math.round(r.y+r.height/2)];
                  } return null""", selector)
                if point:
                    request(api + "/actions", {"actions": [{"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [
                        {"type": "pointerMove", "duration": 0, "x": point[0], "y": point[1]},
                        {"type": "pointerDown", "button": 0}, {"type": "pointerUp", "button": 0},
                        {"type": "pause", "duration": 50}, {"type": "pointerDown", "button": 0}, {"type": "pointerUp", "button": 0}]}]})
                    wait_for(lambda: script("return document.activeElement===document.querySelector(arguments[0])", selector), 'double-click editor')
                else:
                    request(api + f"/element/{target}/click", {})

            def keys(selector, text):
                target = wait_for(lambda: element(selector), selector)
                request(api + f"/element/{target}/value", {"text": text})

            def press_key(value):
                request(api + '/actions', {"actions": [{"type": "key", "id": "keyboard", "actions": [
                    {"type": "keyDown", "value": value}, {"type": "keyUp", "value": value}]}]})

            def values():
                return script("return Array.from(document.querySelectorAll('.node-text textarea'), el => el.value)")

            wait_for(lambda: values(), "map canvas")
            assert script("return document.querySelector('main').dataset.theme") == 'default'
            assert script("return getComputedStyle(document.querySelector('.canvas')).backgroundColor") == 'rgb(255, 255, 255)'
            assert request(api + '/execute/async', {"script": "const done=arguments[arguments.length-1]; import('/src/export.ts').then(({makeSvg})=>{const m=document.querySelector('.map'), svg=new DOMParser().parseFromString(makeSvg(m,document.querySelector('.canvas'),Number(m.dataset.zoom)).svg,'image/svg+xml'); done(svg.querySelectorAll('g')[1].querySelector('rect').getAttribute('stroke-width'));});", "args": []}) == '6'
            wait_for(lambda: script("return !!window.__miniTest.close"), 'close guard')
            script("document.querySelector('.tab-open').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
            wait_for(lambda: script("return !!document.querySelector('.tab-rename')"), 'tab rename before close')
            keys('.tab-rename', '\ue009a\ue000Uncommitted title')
            assert not script("return !!document.querySelector('.tab-dirty')")
            script("window.__miniTest.close({preventDefault(){}})")
            wait_for(lambda: script("return !!document.querySelector('#confirm-title')"), 'close warns about pending tab rename')
            click('.close-tab-actions .confirm-action')
            wait_for(lambda: script("return window.__miniTest.destroyed"), 'close completes')
            assert script("const d=JSON.parse(sessionStorage.getItem('recovery')); return d.tree.tabTitle") == 'Uncommitted title'
            script("sessionStorage.removeItem('recovery')")
            request(api + '/refresh', {})
            wait_for(lambda: values(), 'fresh map canvas')
            script("document.querySelector('.canvas').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:innerWidth-2, clientY:innerHeight-2}))")
            assert script("const r=document.querySelector('.canvas-context').getBoundingClientRect(); return r.right<=innerWidth && r.bottom<=innerHeight")
            assert script("return [...document.querySelectorAll('.canvas-context button')].every(button => button.querySelector('svg.menu-icon[aria-hidden=true]') && button.scrollWidth <= button.clientWidth)")
            click('.canvas-context button:nth-child(3)')
            wait_for(lambda: script("return !!window.__miniTest.clipboard"), 'copy PNG to clipboard')
            assert base64.b64decode(script("return window.__miniTest.clipboard")).startswith(b'\x89PNG\r\n\x1a\n')
            script("document.querySelector('.canvas').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:200, clientY:180}))")
            click('.canvas-context button:nth-child(4)')
            wait_for(lambda: script("return !!document.querySelector('.structure-panel')"), 'outline from canvas menu')
            click('.structure-panel button[aria-label="Close"]')
            request(api + '/goog/cdp/execute', {"cmd": "Emulation.setEmulatedMedia", "params": {"features": [{"name": "prefers-reduced-motion", "value": "reduce"}]}})
            click('[aria-label="Menu"]')
            assert script("return getComputedStyle(document.querySelector('.app-menu-list')).animationName") == 'none'
            click('[aria-label="Menu"]')
            request(api + '/goog/cdp/execute', {"cmd": "Emulation.setEmulatedMedia", "params": {"features": []}})
            click('[aria-label="Menu"]')
            assert script("return getComputedStyle(document.querySelector('.app-menu-list')).animationName") == 'none'
            click('[aria-label="Menu"]')
            editor = ".root-node textarea"
            click('.root-node')
            assert script("return document.activeElement?.matches('.root-node') && !document.activeElement.matches('textarea')")
            assert not script("return !!document.querySelector('.drag-handle,.floating-move')")
            click(editor)
            assert script("""const e=new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true});
              document.querySelector('.root-node textarea').dispatchEvent(e); return !e.defaultPrevented && !document.querySelector('.canvas').classList.contains('pan-ready');""")
            assert script("return document.activeElement===document.querySelector(arguments[0])", editor)
            click(editor)
            assert script("const e=document.querySelector(arguments[0]); return e.selectionStart===e.selectionEnd", editor), 'click should position the editing caret'
            assert script("""const e=document.querySelector(arguments[0]); e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
              const key=new KeyboardEvent('keydown',{key:'Tab',isComposing:true,bubbles:true,cancelable:true}); e.dispatchEvent(key);
              e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})); return !key.defaultPrevented;""", editor), 'IME composition should not trigger node shortcuts'
            assert len(values()) == 1
            keys(editor, "\ue009a\ue000Root 中文")
            keys(editor, '\ue007')
            assert script("return document.activeElement === document.querySelector('.root-node.selected')")
            assert values() == ['Root 中文']
            press_key('\ue007')
            wait_for(lambda: script("return document.activeElement === document.querySelector(arguments[0])", editor), 'root can be edited again')
            script("const data = new DataTransfer(); data.items.add(new File([new Uint8Array(10*1024*1024+1)], 'large.png', {type:'image/png'})); document.querySelector(arguments[0]).dispatchEvent(new ClipboardEvent('paste', {bubbles:true, cancelable:true, clipboardData:data}));", editor)
            wait_for(lambda: script("return document.querySelector('[role=alert]')?.textContent.includes('10 MB')"), 'oversized pasted image rejected')
            assert not script("return !!document.querySelector('.root-node img')")
            click('[role=alert] button')
            wait_for(lambda: script("return !!document.querySelector('.tab.active .tab-dirty')"), 'unsaved tab indicator')
            keys(editor, "\ue004")
            wait_for(lambda: len(values()) == 2, "new child")
            assert script("return getComputedStyle(document.querySelector('.children')).animationName") == 'branch-reveal'
            request(api + '/goog/cdp/execute', {"cmd": "Emulation.setEmulatedMedia", "params": {"features": [{"name": "prefers-reduced-motion", "value": "reduce"}]}})
            assert script("return getComputedStyle(document.querySelector('.children')).animationName") == 'none'
            request(api + '/goog/cdp/execute', {"cmd": "Emulation.setEmulatedMedia", "params": {"features": []}})
            keys(".node.selected textarea", "Alpha")
            assert script("""const e=document.activeElement; e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
              const key=new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}); e.dispatchEvent(key);
              e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})); return !key.defaultPrevented && document.activeElement===e;"""), 'IME Enter should leave the editor active'
            assert script("""const e=document.activeElement, key=new KeyboardEvent('keydown',{key:'Enter',keyCode:229,bubbles:true,cancelable:true});
              e.dispatchEvent(key); return !key.defaultPrevented && document.activeElement===e;"""), 'IME keyCode 229 should not finish editing'
            keys(".node.selected textarea", "\ue007")
            assert values() == ['Root 中文', 'Alpha']
            assert script("return document.activeElement === document.querySelector('.node.selected')")
            assert script("""const key=new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true,cancelable:true});
              document.activeElement.dispatchEvent(key); return key.defaultPrevented;""")
            assert values() == ['Root 中文', 'Alpha'], 'holding Enter must not create siblings'
            press_key('\ue007')
            wait_for(lambda: len(values()) == 3, "new sibling")
            keys(".node.selected textarea", "Beta")
            assert values() == ["Root 中文", "Alpha", "Beta"], values()
            wait_for(lambda: script("return (document.querySelector('.branch-layer path')?.getAttribute('d')?.match(/Q/g)||[]).length") == 2, 'Branch curves')
            assert script("return getComputedStyle(document.querySelector('.branch'), '::before').display") == 'none'
            assert abs(float(script("return parseFloat(getComputedStyle(document.querySelector('.branch-layer path')).strokeWidth)")) - 4 / 3) < .01
            assert request(api + '/execute/async', {"script": """const done=arguments[arguments.length-1]; import('/src/export.ts').then(({makeSvg})=>{
              const m=document.querySelector('.map'), raw=makeSvg(m,document.querySelector('.canvas'),Number(m.dataset.zoom)).svg;
              const holder=document.createElement('div'); holder.style.cssText='position:fixed;left:-10000px'; holder.innerHTML=raw; document.body.appendChild(holder);
              const a=m.querySelector('.branch-layer path'), b=holder.querySelector('svg > g > path'), length=b.getTotalLength();
              const a0=a.getPointAtLength(0), b0=b.getPointAtLength(0);
              const matched=[0,.25,.5,1].every(t=>{const x=a.getPointAtLength(length*t), y=b.getPointAtLength(length*t); return Math.abs((y.x-x.x)-(b0.x-a0.x))<1 && Math.abs((y.y-x.y)-(b0.y-a0.y))<1});
              holder.remove(); done(matched && b.getAttribute('stroke-width')==='1pt'); });""", "args": []})
            keys(".node.selected textarea", "\ue009z\ue000")
            wait_for(lambda: "Beta" not in values(), "undo")
            keys(".node.selected textarea", "\ue009\ue008z\ue000")
            wait_for(lambda: "Beta" in values(), "redo")

            def parent_of(name):
                return script("""const row = [...document.querySelectorAll('.node-row')].find(row => row.querySelector(':scope > .node textarea')?.value === arguments[0]);
                  return row?.parentElement?.parentElement?.parentElement?.querySelector(':scope > .node textarea')?.value || null;""", name)

            def drag_points(points):
                x1, y1, x2, y2 = points
                request(api + '/actions', {"actions": [{"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [
                    {"type": "pointerMove", "duration": 0, "x": x1, "y": y1}, {"type": "pointerDown", "button": 0},
                    {"type": "pointerMove", "duration": 200, "x": x2, "y": y2}, {"type": "pointerUp", "button": 0}]}]})

            def track_node_motion():
                script("""window.__nodeMotionCalls=0;
                  if (!window.__originalAnimate) {
                    window.__originalAnimate=Element.prototype.animate;
                    Element.prototype.animate=function(frames, options) {
                      if (options?.duration===220) window.__nodeMotionCalls++;
                      return window.__originalAnimate.call(this, frames, options);
                    };
                  }""")

            script("document.activeElement?.blur()")
            track_node_motion()
            coords = script("""const card = name => [...document.querySelectorAll('.node')].find(el => el.querySelector('textarea')?.value === name);
              const a = card('Alpha').getBoundingClientRect(), b = card('Beta').getBoundingClientRect();
              return [Math.round(a.x + a.width/2), Math.round(a.y + a.height/2), Math.round(b.x + b.width/2), Math.round(b.y + b.height*0.2)];""")
            x1, y1, x2, y2 = coords
            request(api + "/actions", {"actions": [{"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [
                {"type": "pointerMove", "duration": 0, "x": x1, "y": y1}, {"type": "pointerDown", "button": 0},
                {"type": "pointerMove", "duration": 400, "x": x2, "y": y2}, {"type": "pointerUp", "button": 0}]}]})
            wait_for(lambda: parent_of("Alpha") == "Beta", "dragging a topic into another topic")
            assert script("return window.__nodeMotionCalls") > 0, 'ordinary text moves should still animate'
            wait_for(lambda: script("""const p=document.querySelector('.branch-layer path'), a=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha');
              const m=document.querySelector('.map'), z=Number(m.dataset.zoom), r=a.getBoundingClientRect(), origin=m.getBoundingClientRect(), end=p.getPointAtLength(p.getTotalLength());
              return Math.abs(end.x-(r.left-origin.left)/z)<2 && Math.abs(end.y-(r.bottom-origin.top)/z+parseFloat(getComputedStyle(a).borderBottomWidth)/2)<2;"""), 'curve follows the moved topic')
            wait_for(lambda: not script("return document.querySelector('.map').getAnimations({subtree:true}).some(a=>a.id==='node-move' && a.playState==='running')"), 'topic movement settles')
            previous_end = script("const p=document.querySelector('.branch-layer path'); return p.getPointAtLength(p.getTotalLength()).x")
            script("""const card=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha');
              window.__branchMotion=card.animate([{transform:'translate(0,0)'},{transform:'translate(24px,12px)'}],{duration:400});
              window.__branchMotion.id='node-move'; document.querySelector('.map').dispatchEvent(new Event('floatingmove'));""")
            wait_for(lambda: script("""const p=document.querySelector('.branch-layer path'), a=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha');
              const m=document.querySelector('.map'), z=Number(m.dataset.zoom), r=a.getBoundingClientRect(), origin=m.getBoundingClientRect(), end=p.getPointAtLength(p.getTotalLength());
              return Math.abs(end.x-arguments[0])>4 && Math.abs(end.x-(r.left-origin.left)/z)<2 && Math.abs(end.y-(r.bottom-origin.top)/z+parseFloat(getComputedStyle(a).borderBottomWidth)/2)<2;""", previous_end), 'curve follows an animating topic')
            script("window.__branchMotion.cancel(); document.querySelector('.map').dispatchEvent(new Event('floatingmove'))")
            styles = script("""const card = name => [...document.querySelectorAll('.node')].find(el => el.querySelector('textarea')?.value === name);
              return ['Root 中文', 'Beta', 'Alpha'].map(name => { const s=getComputedStyle(card(name)); return [s.borderTopWidth, s.borderBottomWidth, s.backgroundColor, s.fontSize]; });""")
            assert styles[0][:3] == ['6px', '6px', 'rgb(220, 230, 242)'], styles
            assert styles[1][:3] == ['2px', '2px', 'rgb(220, 230, 242)'], styles
            assert styles[2][:3] == ['0px', '4px', 'rgba(0, 0, 0, 0)'], styles
            assert [item[3] for item in styles] == ['24px', '17px', '13px'], styles
            keys(".node.selected textarea", "\ue009z\ue000")
            wait_for(lambda: parent_of("Alpha") == "Root 中文", "undoing a drag")

            script("document.activeElement?.blur()")
            coords = script("""const card = name => [...document.querySelectorAll('.node')].find(el => el.querySelector('textarea')?.value === name);
              const a = card('Alpha').getBoundingClientRect(), b = card('Beta').getBoundingClientRect();
              return [Math.round(a.x+a.width/2), Math.round(a.y+a.height/2), Math.round(b.x+b.width/2), Math.floor(b.bottom-1)];""")
            x1, y1, x2, y2 = coords
            request(api + "/actions", {"actions": [{"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [
                {"type": "pointerMove", "duration": 0, "x": x1, "y": y1}, {"type": "pointerDown", "button": 0},
                {"type": "pointerMove", "duration": 400, "x": x2, "y": y2}, {"type": "pointerUp", "button": 0}]}]})
            wait_for(lambda: values() == ['Root 中文', 'Beta', 'Alpha'], 'reorder sibling from target edge')
            keys('.node.selected textarea', '\ue009z\ue000')
            wait_for(lambda: values() == ['Root 中文', 'Alpha', 'Beta'], 'undo sibling reorder')

            script("document.activeElement?.blur()")
            box = script("""const cards=[...document.querySelectorAll('.node')].filter(el => ['Alpha','Beta'].includes(el.querySelector('textarea')?.value)).map(el=>el.getBoundingClientRect());
              return [Math.floor(Math.min(...cards.map(r=>r.left))-4), Math.floor(Math.min(...cards.map(r=>r.top))-4), Math.ceil(Math.max(...cards.map(r=>r.right))+4), Math.ceil(Math.max(...cards.map(r=>r.bottom))+4)];""")
            request(api + '/actions', {"actions": [
                {"type":"pointer", "id":"mouse", "parameters":{"pointerType":"mouse"}, "actions":[{"type":"pointerMove","duration":0,"x":box[0],"y":box[1]},{"type":"pointerDown","button":0},{"type":"pointerMove","duration":300,"x":box[2],"y":box[3]},{"type":"pointerUp","button":0}]}]})
            wait_for(lambda: script("return document.querySelectorAll('.node.selected').length") == 2, 'marquee selected two topics')
            script("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}))")
            wait_for(lambda: values() == ['Root 中文'], 'delete selected topics')
            script("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: values() == ['Root 中文', 'Alpha', 'Beta'], 'undo batch deletion')
            script("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: values() == ['Root 中文'], 'redo batch deletion')
            script("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: values() == ['Root 中文', 'Alpha', 'Beta'], 'restore topics for group drag')
            box = script("""const cards=[...document.querySelectorAll('.node')].filter(el => ['Alpha','Beta'].includes(el.querySelector('textarea')?.value)).map(el=>el.getBoundingClientRect());
              return [Math.floor(Math.min(...cards.map(r=>r.left))-4), Math.floor(Math.min(...cards.map(r=>r.top))-4), Math.ceil(Math.max(...cards.map(r=>r.right))+4), Math.ceil(Math.max(...cards.map(r=>r.bottom))+4)];""")
            request(api + '/actions', {"actions": [
                {"type":"pointer", "id":"mouse", "parameters":{"pointerType":"mouse"}, "actions":[{"type":"pointerMove","duration":0,"x":box[0],"y":box[1]},{"type":"pointerDown","button":0},{"type":"pointerMove","duration":300,"x":box[2],"y":box[3]},{"type":"pointerUp","button":0}]}]})
            wait_for(lambda: script("return document.querySelectorAll('.node.selected').length") == 2, 'reselect topics after deletion undo')
            point = script("const r=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha').getBoundingClientRect(); return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]")
            request(api + '/actions', {"actions":[{"type":"pointer","id":"mouse","parameters":{"pointerType":"mouse"},"actions":[
                {"type":"pointerMove","duration":0,"x":point[0],"y":point[1]},{"type":"pointerDown","button":0},
                {"type":"pointerMove","duration":350,"x":50,"y":script('return window.innerHeight-80')},{"type":"pointerUp","button":0}]}]})
            wait_for(lambda: script("return document.querySelectorAll('.floating-topic').length") == 2, 'dragged both selected topics')
            assert script("const s=getComputedStyle(document.querySelector('.floating-topic .root-node')); return [s.backgroundColor,s.color,s.borderTopWidth,s.fontSize]") == ['rgb(54, 116, 186)', 'rgb(255, 255, 255)', '0px', '17px']
            script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))")
            wait_for(lambda: not script("return !!document.querySelector('.floating-topic')") and len(values()) == 3, 'undo group drag')

            # Select non-root topics individually and create a persistent summary through the context menu.
            script("document.querySelector('.root-node').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1}))")
            for name in ['Alpha', 'Beta']:
                script("const card=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value===arguments[0]); card.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,ctrlKey:true}))", name)
                wait_for(lambda: script("return document.querySelectorAll('.node.selected').length") >= (1 if name == 'Alpha' else 2), 'control-click selection')
            script("const card=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha'); card.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))")
            wait_for(lambda: script("return [...document.querySelectorAll('.context-actions button')].some(el=>el.textContent.includes('Add summary'))"), 'summary context action')
            assert script("return [...document.querySelectorAll('.context button')].map(el=>el.textContent.trim())") == ['Add summary', 'Delete']
            assert not script("return !!document.querySelector('.context .context-section, .context select')")
            script("[...document.querySelectorAll('.context-actions button')].find(el=>el.textContent.includes('Add summary')).click()")
            wait_for(lambda: script("return !!document.querySelector('.summary-node textarea')"), 'summary bracket')
            assert script("const s=getComputedStyle(document.querySelector('.summary-node > .node-row > .node')), b=getComputedStyle(document.querySelector('.summary-bracket')); return [s.backgroundColor,s.color,b.borderRightColor,b.borderRightWidth]") == ['rgb(99, 123, 50)', 'rgb(255, 255, 255)', 'rgb(133, 156, 86)', '6px']
            keys('.summary-node textarea', '\ue009a\ue000Project summary')
            wait_for(lambda: script("return document.querySelector('.summary-node textarea').value") == 'Project summary', 'summary editing')
            assert script("return document.querySelector('.summary-node > .node-row').classList.contains('depth-1')")
            before = values()
            keys('.summary-node textarea', '\ue007')
            assert values() == before, 'Enter in the summary editor must not add a sibling'
            assert script("return document.activeElement === document.querySelector('.summary-node > .node-row > .node.selected')")
            assert script("""const card=document.querySelector('.summary-node > .node-row > .node'); card.focus();
              const event=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}); card.dispatchEvent(event); return event.defaultPrevented;""")
            assert values() == before, 'Enter on the summary card must not add a sibling'
            click('[aria-label="Menu"]')
            click('.app-menu-list .menu:nth-child(3) > button')
            assert script("return [...document.querySelectorAll('.dropdown button')].find(el=>el.textContent.includes('Add Sibling Topic')).disabled")
            click('[aria-label="Menu"]')
            point = script("const r=document.querySelector('.summary-node > .node-row > .node').getBoundingClientRect(); return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2),50,window.innerHeight-80]")
            drag_points(point)
            assert values() == before and script("return !!document.querySelector('.summary-bracket') && !document.querySelector('.floating-topic')"), 'dragging a summary title must preserve its summary'
            click('.root-node')
            click('.summary-node > .node-row > .node')
            assert script("return document.querySelector('.summary-node > .node-row > .node').classList.contains('selected')"), 'summary titles remain selectable'
            script("document.querySelector('.root-node').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1}))")
            for name in ['Alpha', 'Project summary']:
                script("const card=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value===arguments[0]); card.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,ctrlKey:true}))", name)
                wait_for(lambda: script("return [...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value===arguments[0]).classList.contains('selected')", name), 'select summary drag group')
            point = script("const r=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha').getBoundingClientRect(); return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2),50,window.innerHeight-80]")
            drag_points(point)
            assert values() == before and script("return !!document.querySelector('.summary-bracket') && !document.querySelector('.floating-topic')"), 'a group containing a summary title must not be dragged'
            click('.root-node')
            click('.summary-node > .node-row > .node')
            keys('.summary-node textarea', '\ue004')
            wait_for(lambda: script("return document.querySelectorAll('.summary-node .node').length") == 2, 'summary child topic')
            keys('.summary-node .node.selected textarea', 'Summary child')
            script("const card=document.querySelector('.summary-node > .node-row > .node'); card.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))")
            click('.context .format-buttons button[aria-label="Bold"]')
            wait_for(lambda: script("return getComputedStyle(document.querySelector('.summary-node > .node-row > .node .node-text')).fontWeight") in ['700', 'bold'], 'summary topic formatting')
            script("""const e=document.querySelector('.summary-node > .node-row > .node textarea'); e.focus();
              const raw=atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR7AAAAAASUVORK5CYII=');
              const data=new DataTransfer(); data.items.add(new File([Uint8Array.from(raw,c=>c.charCodeAt(0))], 'test.png', {type:'image/png'}));
              e.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));""")
            wait_for(lambda: script("return !!document.querySelector('.summary-node > .node-row > .node img')"), 'summary topic image')
            script("const card=document.querySelector('.summary-node > .node-row > .node'); card.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))")
            script("[...document.querySelectorAll('.context-actions button')].find(el=>el.textContent.includes('Create connection')).click()")
            script("document.querySelector('.root-node').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1}))")
            wait_for(lambda: script("return !!document.querySelector('.relation-hit')"), 'summary topic connection')
            wait_for(lambda: script("const d=JSON.parse(sessionStorage.getItem('recovery')||'null'); return !!d?.tree?.summaries?.length && !!d.tree.relations?.length"), 'summary recovery data')
            request(api + '/refresh', {})
            wait_for(lambda: script("return !!document.querySelector('#confirm-title')"), 'summary recovery prompt')
            click('.close-tab-actions .confirm-action')
            wait_for(lambda: script("return !!document.querySelector('.summary-node > .node-row > .node img') && !!document.querySelector('.relation-hit')"), 'restored summary image and connection')
            assert script("const b=document.querySelector('.summary-bracket').getBoundingClientRect(), cards=[...document.querySelectorAll('.node')].filter(el=>['Alpha','Beta'].includes(el.querySelector('textarea')?.value)).map(el=>el.getBoundingClientRect()); return b.top<=Math.min(...cards.map(r=>r.top))+2 && b.bottom>=Math.max(...cards.map(r=>r.bottom))-2 && b.left>=Math.max(...cards.map(r=>r.right))")
            assert script("return document.querySelector('.summary-delete').title") == 'Delete summary, its child topics, and their connections'
            ordinary_outlines = script("return [...document.querySelectorAll('.node')].filter(n=>['Alpha','Beta'].includes(n.querySelector('textarea')?.value)).map(n=>getComputedStyle(n).outlineColor)")
            point = script("const r=document.querySelector('.summary-delete').getBoundingClientRect(); return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]")
            request(api + '/actions', {"actions": [{"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [
                {"type": "pointerMove", "duration": 0, "x": point[0], "y": point[1]}]}]})
            wait_for(lambda: script("return [...document.querySelectorAll('.summary-node .node')].every(n=>getComputedStyle(n).outlineColor==='rgb(211, 76, 67)')"), 'summary deletion preview')
            assert script("return document.querySelectorAll('.summary-node .node').length") == 2
            assert script("return getComputedStyle(document.querySelector('.summary-node .node')).animationName") == 'summary-delete-preview'
            assert script("return getComputedStyle(document.querySelector('.summary-bracket')).filter") != 'none'
            assert script("return [...document.querySelectorAll('.node')].filter(n=>['Alpha','Beta'].includes(n.querySelector('textarea')?.value)).map(n=>getComputedStyle(n).outlineColor)") == ordinary_outlines
            assert request(api + '/execute/async', {"script": "const done=arguments[arguments.length-1]; import('/src/export.ts').then(({makeSvg})=>{const m=document.querySelector('.map'), raw=makeSvg(m,document.querySelector('.canvas'),Number(m.dataset.zoom)).svg, svg=new DOMParser().parseFromString(raw,'image/svg+xml'); done(raw.includes('Project summary') && raw.includes('Summary child') && [...svg.querySelectorAll('path')].some(p=>p.getAttribute('stroke')==='rgb(133, 156, 86)' && p.getAttribute('stroke-width')==='6'));});", "args": []})
            request(api + '/actions', {"actions": [{"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [
                {"type": "pointerMove", "duration": 0, "x": 20, "y": 80}]}]})
            wait_for(lambda: script("return document.querySelector('.summary-node .node').getAnimations().every(a=>a.playState!=='running')"), 'summary preview clears')
            request(api + '/goog/cdp/execute', {"cmd": "Emulation.setEmulatedMedia", "params": {"features": [{"name": "prefers-reduced-motion", "value": "reduce"}]}})
            script("document.querySelector('.summary-delete').focus()")
            press_key('\ue004')
            request(api + '/actions', {"actions": [{"type": "key", "id": "keyboard", "actions": [
                {"type": "keyDown", "value": '\ue008'}, {"type": "keyDown", "value": '\ue004'},
                {"type": "keyUp", "value": '\ue004'}, {"type": "keyUp", "value": '\ue008'}]}]})
            assert script("return document.activeElement===document.querySelector('.summary-delete') && document.activeElement.matches(':focus-visible')")
            assert script("const s=getComputedStyle(document.querySelector('.summary-node .node')); return [s.outlineColor,s.animationName]") == ['rgb(211, 76, 67)', 'none']
            script("document.querySelector('.summary-delete').blur()")
            request(api + '/goog/cdp/execute', {"cmd": "Emulation.setEmulatedMedia", "params": {"features": []}})
            track_node_motion()
            points = script("""const a=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha').getBoundingClientRect();
              return [Math.round(a.x+a.width/2),Math.round(a.y+a.height*0.25),50,window.innerHeight-80];""")
            drag_points(points)
            wait_for(lambda: script("return [...document.querySelectorAll('.floating-topic > .node-row > .node textarea')].some(el=>el.value==='Alpha')"), 'detach a summarized topic')
            assert script("return window.__nodeMotionCalls") == 0, 'moving a summarized topic should not animate'
            script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: parent_of('Alpha') == 'Root 中文', 'undo detaching a summarized topic')
            track_node_motion()
            points = script("""const card=name=>[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value===name);
              const a=card('Alpha').getBoundingClientRect(), b=card('Project summary').getBoundingClientRect();
              return [Math.round(a.x+a.width/2),Math.round(a.y+a.height/2),Math.round(b.x+b.width/2),Math.round(b.y+b.height/2)];""")
            drag_points(points)
            wait_for(lambda: parent_of('Alpha') == 'Project summary', 'move text into summary')
            assert script("return window.__nodeMotionCalls") == 0, 'moving into a summary should not animate'
            script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: parent_of('Alpha') == 'Root 中文', 'undo moving text into summary')
            track_node_motion()
            points = script("""const a=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Summary child').getBoundingClientRect();
              return [Math.round(a.x+a.width/2),Math.round(a.y+a.height/2),50,window.innerHeight-80];""")
            drag_points(points)
            wait_for(lambda: script("return [...document.querySelectorAll('.floating-topic > .node-row > .node textarea')].some(el=>el.value==='Summary child')"), 'move text out of summary')
            assert script("return window.__nodeMotionCalls") == 0, 'moving out of a summary should not animate'
            script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: parent_of('Summary child') == 'Project summary', 'undo moving text out of summary')
            script("""const card=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha');
              window.__summaryStart=card.getBoundingClientRect().right;
              window.__summaryAnimation=card.animate([{transform:'translateX(0px)'},{transform:'translateX(100px)'}],{duration:2000,fill:'forwards'});
              window.__summaryAnimation.id='node-move'; document.querySelector('.map').dispatchEvent(new Event('floatingmove'));""")
            wait_for(lambda: script("const card=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha'); return card.getBoundingClientRect().right-window.__summaryStart>30"), 'summary member animation')
            wait_for(lambda: script("const card=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha'); return document.querySelector('.summary-bracket').getBoundingClientRect().left>=card.getBoundingClientRect().right+10"), 'summary bracket follows animated topic')
            script("window.__summaryAnimation.cancel(); document.querySelector('.map').dispatchEvent(new Event('floatingmove'))")
            script("""const e=[...document.querySelectorAll('.node textarea')].find(el=>el.value==='Alpha'); e.focus();
              const raw=atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR7AAAAAASUVORK5CYII=');
              const data=new DataTransfer(); data.items.add(new File([Uint8Array.from(raw,c=>c.charCodeAt(0))], 'test.png', {type:'image/png'}));
              e.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));""")
            wait_for(lambda: script("return !![...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha')?.querySelector('img')"), 'grouped topic image')
            points = script("""const card=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha');
              const a=card.querySelector('img').getBoundingClientRect(), b=document.querySelector('.summary-node > .node-row > .node').getBoundingClientRect();
              return [Math.round(a.x+a.width/2),Math.round(a.y+a.height/2),Math.round(b.x+b.width/2),Math.round(b.y+b.height/2)];""")
            request(api + '/actions', {"actions":[{"type":"pointer","id":"mouse","parameters":{"pointerType":"mouse"},"actions":[
              {"type":"pointerMove","duration":0,"x":points[0],"y":points[1]},{"type":"pointerDown","button":0},
              {"type":"pointerMove","duration":350,"x":points[2],"y":points[3]},{"type":"pointerUp","button":0}]}]})
            wait_for(lambda: parent_of('Alpha') == 'Project summary', 'move grouped image into summary')
            assert script("return !!document.querySelector('.summary-bracket') && !!document.querySelector('.summary-node img')"), 'summary and image remain visible'
            points = script("""const a=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Beta').getBoundingClientRect();
              const b=document.querySelector('.summary-node > .node-row > .node').getBoundingClientRect();
              return [Math.round(a.x+a.width/2),Math.round(a.y+a.height*0.25),Math.round(b.x+b.width/2),Math.round(b.y+b.height*0.25)];""")
            request(api + '/actions', {"actions":[{"type":"pointer","id":"mouse","parameters":{"pointerType":"mouse"},"actions":[
              {"type":"pointerMove","duration":0,"x":points[0],"y":points[1]},{"type":"pointerDown","button":0},
              {"type":"pointerMove","duration":350,"x":points[2],"y":points[3]},{"type":"pointerUp","button":0}]}]})
            wait_for(lambda: script("return document.querySelector('[role=alert]')?.textContent.includes('Keep at least one topic')"), 'last summary member stays outside')
            assert parent_of('Beta') == 'Root 中文' and script("return !!document.querySelector('.summary-bracket')")
            click('[role=alert] button')
            script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: parent_of('Alpha') == 'Root 中文', 'undo grouped image move')
            script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: not script("return !![...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha')?.querySelector('img')"), 'undo grouped topic image')
            click('.summary-delete')
            wait_for(lambda: not script("return !!document.querySelector('.summary-group')"), 'delete summary')
            wait_for(lambda: not script("return !!document.querySelector('.relation-hit')"), 'delete summary removes its connection')
            script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: script("return document.querySelector('.summary-node textarea')?.value") == 'Project summary', 'undo summary deletion')
            assert script("return [...document.querySelectorAll('.summary-node textarea')].some(el=>el.value.includes('Summary child'))")
            script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: not script("return !!document.querySelector('.summary-group')"), 'redo summary deletion')

            script("""const e=[...document.querySelectorAll('.node textarea')].find(el=>el.value==='Alpha'); e.focus();
              const canvas=document.createElement('canvas'); canvas.width=240; canvas.height=160;
              const raw=atob(canvas.toDataURL('image/png').split(',')[1]);
              const data=new DataTransfer(); data.items.add(new File([Uint8Array.from(raw,c=>c.charCodeAt(0))], 'test.png', {type:'image/png'}));
              e.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));""")
            wait_for(lambda: script("const img=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha')?.querySelector('img'); return img?.complete && img.naturalWidth===240"), 'pasted topic image')
            script("document.activeElement?.blur()")
            image_point = script("const img=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha').querySelector('img'); const r=img.getBoundingClientRect(); return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]")
            request(api + '/actions', {"actions":[{"type":"pointer","id":"mouse","parameters":{"pointerType":"mouse"},"actions":[{"type":"pointerMove","duration":0,"x":image_point[0],"y":image_point[1]},{"type":"pointerDown","button":0},{"type":"pointerUp","button":0}]}]})
            wait_for(lambda: script("return !!document.querySelector('.preview img')"), 'image preview on click')
            click('.overlay')
            before_image = script("const r=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha').querySelector('img').getBoundingClientRect(); return [r.width,r.height]")
            track_node_motion()
            points = script("""const card=name=>[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value===name);
              const a=card('Alpha').querySelector('img').getBoundingClientRect(), b=card('Beta').getBoundingClientRect();
              return [Math.round(a.x+a.width/2),Math.round(a.y+a.height/2),Math.round(b.x+b.width/2),Math.round(b.y+b.height/2)];""")
            request(api + '/actions', {"actions":[{"type":"pointer","id":"mouse","parameters":{"pointerType":"mouse"},"actions":[
                {"type":"pointerMove","duration":0,"x":points[0],"y":points[1]},{"type":"pointerDown","button":0},
                {"type":"pointerMove","duration":350,"x":points[2],"y":points[3]},{"type":"pointerUp","button":0}]}]})
            wait_for(lambda: parent_of('Alpha') == 'Beta', 'drag topic from its image')
            assert not script("return !!document.querySelector('.preview')"), 'dragging an image should not open preview'
            assert script("return window.__nodeMotionCalls") == 0, 'image moves should not animate'
            dimensions = script("const img=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha').querySelector('img'), r=img.getBoundingClientRect(); return [img.getAttribute('width'),img.getAttribute('height'),r.width,r.height]")
            assert abs(float(dimensions[0])-before_image[0]) < 0.1 and abs(float(dimensions[1])-before_image[1]) < 0.1 and abs(dimensions[2]-before_image[0]) < 0.1 and abs(dimensions[3]-before_image[1]) < 0.1, dimensions
            track_node_motion()
            points = script("""const a=[...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Beta').getBoundingClientRect();
              return [Math.round(a.x+a.width/2),Math.round(a.y+a.height/2),50,window.innerHeight-80];""")
            drag_points(points)
            wait_for(lambda: script("return [...document.querySelectorAll('.floating-topic > .node-row > .node textarea')].some(el=>el.value==='Beta')"), 'detach branch containing an image')
            assert script("return window.__nodeMotionCalls") == 0, 'moves of a branch containing an image should not animate'
            script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))")
            wait_for(lambda: parent_of('Beta') == 'Root 中文' and parent_of('Alpha') == 'Beta', 'undo image branch drag')
            script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))")
            wait_for(lambda: parent_of('Alpha') == 'Root 中文', 'undo image topic drag')
            script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))")
            wait_for(lambda: not script("return !![...document.querySelectorAll('.node')].find(el=>el.querySelector('textarea')?.value==='Alpha')?.querySelector('img')"), 'undo image paste')

            click('[aria-label="Zoom In"]')
            assert script("return document.querySelector('.zoom-controls output').textContent") == "110%"
            script("const el = [...document.querySelectorAll('.node textarea')].find(x => x.value === 'Alpha').closest('.node'); el.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:300, clientY:300}))")
            click('.context-actions button:first-child')
            script("const el = [...document.querySelectorAll('.node textarea')].find(x => x.value === 'Beta').closest('.node'); el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0}))")
            wait_for(lambda: script("return !!document.querySelector('.relation-hit')"), 'connection')
            script("document.querySelector('.relation-hit').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))")
            topic_count = script("return document.querySelectorAll('.node').length")
            assert script("""const e=document.querySelector('.relation-editor');
              const key=new KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true});
              e.dispatchEvent(key); return document.activeElement===e && !key.defaultPrevented;"""), 'IME Enter must not finish connection editing'
            keys('.relation-editor', 'Connection')
            keys('.relation-editor', '\ue007')
            wait_for(lambda: script("return document.querySelector('.relation-label')?.textContent") == 'Connection', 'connection label')
            assert script("return document.querySelectorAll('.node').length") == topic_count, 'connection Enter must not add topics'
            for button, count in [('Zoom Out', 6), ('Zoom In', 10), ('Zoom Out', 4)]:
                for _ in range(count):
                    click(f'[aria-label="{button}"]')
                wait_for(lambda: script("""const map=document.querySelector('.map'), z=Number(map.dataset.zoom);
                  return [...map.querySelectorAll('.branch-layer,.relation-layer')].every(svg=>{
                    const m=svg.getScreenCTM(); return m && Math.abs(m.a-z)<.001 && Math.abs(m.d-z)<.001;
                  });"""), 'HTML topics and SVG connections use the same screen scale')
            # Real pointer gestures at 110% zoom: preview, one-step undo/redo, both handles, and Escape.
            script("document.querySelector('.relation-hit').dispatchEvent(new MouseEvent('click',{bubbles:true}))")
            wait_for(lambda: script("return document.querySelectorAll('.relation-controls circle').length") == 2, 'connection handles')
            def curve_path():
                return script("return document.querySelector('.relation-line').getAttribute('d')")
            def drag_handle(index, dx, dy, cancel=False):
                script("document.querySelector('.relation-hit').dispatchEvent(new MouseEvent('click',{bubbles:true}))")
                wait_for(lambda: script("return document.querySelectorAll('.relation-controls circle').length") == 2, 'selected connection handles')
                x, y = script("const r=document.querySelectorAll('.relation-controls circle')[arguments[0]].getBoundingClientRect(); return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]", index)
                assert script("return document.elementFromPoint(arguments[0],arguments[1])?.matches('.relation-controls circle')", x, y), script("return document.elementFromPoint(arguments[0],arguments[1])?.outerHTML", x, y)
                request(api + '/actions', {"actions": [{"type":"pointer","id":"mouse","parameters":{"pointerType":"mouse"},"actions":[
                    {"type":"pointerMove","duration":0,"x":x,"y":y},{"type":"pointerDown","button":0},
                    {"type":"pointerMove","duration":200,"x":x+dx,"y":y+dy}]}]})
                if callable(cancel):
                    cancel()
                elif cancel:
                    script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))")
                request(api + '/actions', {"actions":[{"type":"pointer","id":"mouse","parameters":{"pointerType":"mouse"},"actions":[{"type":"pointerUp","button":0}]}]})
            initial_curve = curve_path()
            drag_handle(0, -60, -90)
            wait_for(lambda: curve_path() != initial_curve, 'reshaped connection')
            first_curve = curve_path()
            script("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: curve_path() == initial_curve, 'one-step undo of control drag')
            script("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: curve_path() == first_curve, 'redo control drag')
            drag_handle(1, 40, -70)
            wait_for(lambda: curve_path() != first_curve, 'target control drag')
            custom_curve = curve_path()
            script("const c=document.querySelector('.relation-controls circle'); c.focus(); c.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: curve_path() != custom_curve, 'keyboard control adjustment')
            script("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: curve_path() == custom_curve, 'undo keyboard control adjustment')
            drag_handle(0, -20, -20, cancel=True)
            wait_for(lambda: curve_path() == custom_curve, 'cancel control drag')
            # A save or wheel gesture must observe the document, never the temporary preview.
            drag_handle(0, -20, -20, cancel=lambda: script("document.querySelector('.canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:0,bubbles:true,cancelable:true}))"))
            wait_for(lambda: curve_path() == custom_curve, 'wheel cancels control drag')
            drag_handle(0, -20, -20, cancel=lambda: script("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))"))
            wait_for(lambda: curve_path() == first_curve, 'undo interrupts control drag')
            script("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: curve_path() == custom_curve, 'interrupted preview created no redo entry')
            # Export bounds must include a curve pulled outside the topic rectangles, but no handles.
            request(api + '/execute/async', {"script": "const done=arguments[arguments.length-1]; import('/src/export.ts').then(({makeSvg})=>{window.__curveExport=makeSvg(document.querySelector('.map'),document.querySelector('.canvas'),Number(document.querySelector('.map').dataset.zoom)); done(true);});", "args": []})
            assert script("return window.__curveExport.svg.includes(arguments[0]) && !window.__curveExport.svg.includes('relation-controls')", custom_curve)
            assert script("const map=document.querySelector('.map'), z=Number(map.dataset.zoom), p=document.querySelector('.relation-line').getBoundingClientRect(), r=map.getBoundingClientRect(); return window.__curveExport.height >= (Math.max(r.bottom,p.bottom)-Math.min(r.top,p.top))/z+63")
            click('[aria-label="Fit Canvas"]')
            wait_for(lambda: script("const p=document.querySelector('.relation-line').getBoundingClientRect(), c=document.querySelector('.canvas').getBoundingClientRect(); return p.left>=c.left && p.right<=c.right && p.top>=c.top && p.bottom<=c.bottom"), 'fit reshaped connection')
            # SVG text bounds measure glyph ink, which need not be centered on the text anchor.
            label_x = script("return Number(document.querySelector('.relation-label').getAttribute('x'))")
            script("document.querySelector('.relation-label').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))")
            wait_for(lambda: script("return !!document.querySelector('.relation-editor')"), 'inline connection editor')
            wait_for(lambda: script("""const input=document.querySelector('.relation-editor'), box=input?.closest('foreignObject');
              if (!box) return false;
              const anchor=new DOMPoint(arguments[0],0).matrixTransform(box.getScreenCTM()), r=input.getBoundingClientRect();
              return Math.abs(Number(box.getAttribute('x'))+Number(box.getAttribute('width'))/2-arguments[0])<.01 &&
                Math.abs(r.left+r.width/2-anchor.x)<2;""", label_x), 'connection editor centered on the SVG label anchor')
            keys('.relation-editor', '\ue009a\ue000Temporary')
            keys('.relation-editor', '\ue009z\ue000')
            assert script("return document.querySelector('.relation-editor').value") != 'Temporary'
            assert values() == ['Root 中文', 'Alpha', 'Beta']
            keys('.relation-editor', '\ue00c')
            wait_for(lambda: script("return document.querySelector('.relation-label')?.textContent") == 'Connection', 'cancel connection edit')
            script("document.querySelector('.relation-label').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))")
            wait_for(lambda: script("return !!document.querySelector('.relation-editor')"), 'connection editor before close')
            keys('.relation-editor', '\ue009a\ue000Close label')
            script("window.__miniTest.close({preventDefault(){}})")
            wait_for(lambda: script("return !!document.querySelector('#confirm-title')"), 'close warns after connection edit')
            click('.close-tab-actions button:first-child')
            wait_for(lambda: script("return document.querySelector('.relation-label')?.textContent") == 'Close label', 'close commits connection label')
            script("document.querySelector('.relation-label').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:300, clientY:300}))")
            wait_for(lambda: script("return document.querySelectorAll('.relation-context button').length") == 2, 'connection context menu')
            assert script("return [...document.querySelectorAll('.relation-context button')].every(button => button.querySelector('svg.menu-icon[aria-hidden=true]'))")
            click('.relation-context button:first-child')
            wait_for(lambda: script("return !!document.querySelector('.relation-editor')"), 'connection context rename')
            keys('.relation-editor', '\ue00c')
            script("document.querySelector('.relation-label').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:300, clientY:300}))")
            click('.relation-context button:last-child')
            wait_for(lambda: not script("return !!document.querySelector('.relation-hit')"), 'connection context delete')
            script("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: script("return !!document.querySelector('.relation-hit')"), 'undo connection delete')
            before_pan = script("return document.querySelector('.map').style.transform")
            pan_y = script("return window.innerHeight - 100")
            request(api + "/actions", {"actions": [{"type":"key", "id":"keyboard", "actions":[{"type":"keyDown","value":" "},{"type":"pause","duration":0},{"type":"pause","duration":150},{"type":"keyUp","value":" "}]}, {"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [
                {"type": "pointerMove", "duration": 0, "x": 30, "y": pan_y}, {"type": "pointerDown", "button": 0},
                {"type": "pointerMove", "duration": 150, "x": 95, "y": pan_y + 25}, {"type": "pointerUp", "button": 0}]}]})
            wait_for(lambda: script("return document.querySelector('.map').style.transform") != before_pan, 'canvas pan')
            before_pan = script("return document.querySelector('.map').style.transform")
            wheel_origin = script("const r=document.querySelector('.map').getBoundingClientRect(); return [r.left,r.top]")
            script("document.querySelector('.canvas').dispatchEvent(new WheelEvent('wheel',{deltaX:35,deltaY:45,bubbles:true,cancelable:true}))")
            wait_for(lambda: script("return document.querySelector('.map').style.transform") != before_pan, 'wheel pans canvas')
            wheel_end = script("const r=document.querySelector('.map').getBoundingClientRect(); return [r.left,r.top]")
            assert abs(wheel_end[0] - wheel_origin[0] + 35) < 1 and abs(wheel_end[1] - wheel_origin[1] + 45) < 1, (wheel_origin, wheel_end)
            assert script("const e=new WheelEvent('wheel',{deltaY:2,ctrlKey:true,bubbles:true,cancelable:true}); document.querySelector('.canvas').dispatchEvent(e); return e.defaultPrevented")
            view_one = script("const map = document.querySelector('.map'); return [map.dataset.zoom, map.style.transform]")
            click('[aria-label="New tab"]')
            wait_for(lambda: script("return document.querySelectorAll('.tab').length") == 2, "second tab")
            assert script("return document.querySelectorAll('.tab-dirty').length") == 2
            assert script("return document.querySelector('.zoom-controls output').textContent") == '100%'
            click('[aria-label="Zoom Out"]')
            view_two = script("const map = document.querySelector('.map'); return [map.dataset.zoom, map.style.transform]")
            assert view_two[0] != view_one[0]
            click('.tab:first-child .tab-open')
            wait_for(lambda: script("const map = document.querySelector('.map'); return [map.dataset.zoom, map.style.transform]") == view_one, 'restored first tab view')
            click('.tab:nth-child(2) .tab-open')
            wait_for(lambda: script("const map = document.querySelector('.map'); return [map.dataset.zoom, map.style.transform]") == view_two, 'restored second tab view')
            original_tabs = script("return [...document.querySelectorAll('.tab .tab-open')].map(el => el.textContent)")
            coords = script("const tabs = document.querySelectorAll('.tab'); const a=tabs[0].getBoundingClientRect(), b=tabs[1].getBoundingClientRect(); return [Math.round(a.x+a.width/2), Math.round(a.y+a.height/2), Math.round(b.right-8), Math.round(b.y+b.height/2)]")
            request(api + '/actions', {"actions": [{"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [
                {"type": "pointerMove", "duration": 0, "x": coords[0], "y": coords[1]}, {"type": "pointerDown", "button": 0},
                {"type": "pointerMove", "duration": 400, "x": coords[2], "y": coords[3]}, {"type": "pointerUp", "button": 0}]}]})
            wait_for(lambda: script("return [...document.querySelectorAll('.tab .tab-open')].map(el => el.textContent)") == original_tabs[::-1], 'reordered tabs')
            assert script("return document.querySelector('.tab.active .tab-open').textContent") == original_tabs[1]
            assert script("const map = document.querySelector('.map'); return [map.dataset.zoom, map.style.transform]") == view_two
            keys(editor, '\ue009z\ue000')
            wait_for(lambda: script("return [...document.querySelectorAll('.tab .tab-open')].map(el => el.textContent)") == original_tabs, 'undo tab reorder')
            keys(editor, '\ue009y\ue000')
            wait_for(lambda: script("return [...document.querySelectorAll('.tab .tab-open')].map(el => el.textContent)") == original_tabs[::-1], 'redo tab reorder')
            keys(editor, '\ue009z\ue000')
            wait_for(lambda: script("return [...document.querySelectorAll('.tab .tab-open')].map(el => el.textContent)") == original_tabs, 'restore tab order')
            click('[aria-label="New tab"]')
            wait_for(lambda: script("return document.querySelectorAll('.tab').length") == 3, 'third tab')
            click('.tab.active .tab-close')
            click('.close-tab-actions .confirm-action')
            wait_for(lambda: script("return document.querySelectorAll('.tab').length") == 2, 'closed third tab')
            assert request(api + '/execute/async', {"script": "const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(() => done(!document.activeElement?.matches('.tab-open, .tab-close, .new-tab'))));", "args": []})
            click(".tab.active .tab-close")
            wait_for(lambda: script("return document.querySelector('dialog')?.open"), "close confirmation")
            click(".close-tab-actions button")
            assert script("return document.querySelectorAll('.tab').length") == 2
            click(".tab.active .tab-close")
            click(".close-tab-actions .confirm-action")
            wait_for(lambda: script("return document.querySelectorAll('.tab').length") == 1, "closed tab")

            click('[aria-label="Menu"]')
            click(".app-menu-list .menu:last-child > button")
            wait_for(lambda: script("return document.querySelector('.settings-dialog')?.open"), 'settings dialog')
            assert script("return document.activeElement === document.querySelector('#settings-title')")
            click('.settings-choice summary[aria-label="Theme"]')
            keys('.settings-choice summary[aria-label="Theme"]', '\ue00c')
            assert script("return document.querySelector('.settings-dialog').open && !document.querySelector('.settings-choice[open]')")
            day_geometry = script("return [...document.querySelectorAll('.node')].map(n=>{const s=getComputedStyle(n); return [s.padding,s.borderTopWidth,s.borderBottomWidth,s.borderRadius,s.fontSize,s.fontWeight,n.offsetWidth,n.offsetHeight]})")
            click('.settings-choice summary[aria-label="Theme"]')
            assert script("return [...document.querySelectorAll('.settings-choice[open] .settings-options button')].map(button=>button.firstChild.textContent.trim())") == ['Default', 'Midnight']
            click('.settings-choice[open] .settings-options button:nth-child(2)')
            wait_for(lambda: script("return document.querySelector('main').dataset.theme") == "midnight", "theme switch")
            assert script("return [...document.querySelectorAll('.node')].map(n=>{const s=getComputedStyle(n); return [s.padding,s.borderTopWidth,s.borderBottomWidth,s.borderRadius,s.fontSize,s.fontWeight,n.offsetWidth,n.offsetHeight]})") == day_geometry
            assert script("return getComputedStyle(document.querySelector('.canvas')).backgroundColor") == 'rgb(13, 16, 28)'
            assert script("const s=getComputedStyle(document.querySelector('.root-node')); return [s.backgroundColor,s.color,s.borderTopColor]") == ['rgb(46, 36, 48)', 'rgb(233, 220, 194)', 'rgb(185, 165, 106)']
            assert script("return getComputedStyle(document.querySelector('.node-row.depth-1 > .node')).color") == 'rgb(228, 247, 246)'
            assert script("return getComputedStyle(document.querySelector('.autosave-switch.on span')).backgroundColor") == 'rgb(11, 12, 22)'
            assert script("return getComputedStyle(document.querySelector('.children')).animationName") == 'branch-reveal'
            assert script("return (document.querySelector('.branch-layer path')?.getAttribute('d')?.match(/Q/g)||[]).length") == 2
            assert script("return getComputedStyle(document.querySelector('.branch'), '::before').display") == 'none'
            assert request(api + '/execute/async', {"script": "const done=arguments[arguments.length-1]; import('/src/export.ts').then(({makeSvg})=>{const m=document.querySelector('.map'), svg=new DOMParser().parseFromString(makeSvg(m,document.querySelector('.canvas'),Number(m.dataset.zoom)).svg,'image/svg+xml'); done([svg.querySelector('svg > rect').getAttribute('fill'), svg.querySelector('svg > g').getAttribute('stroke'), [...svg.querySelectorAll('svg > g > path')].filter(p=>p.getAttribute('d').includes('Q')).length, [...svg.querySelectorAll('rect')].some(r=>r.getAttribute('fill')==='rgb(46, 36, 48)' && r.getAttribute('stroke')==='rgb(185, 165, 106)')]);});", "args": []}) == ['rgb(13, 16, 28)', '#55ccd6', 2, True]
            click('.settings-choice summary[aria-label="Language"]')
            click('.settings-choice[open] .settings-options button:nth-child(3)')
            wait_for(lambda: script("return document.documentElement.lang") == "zh-CN", "Chinese language")
            click('.settings-choice summary[aria-label="主题"]')
            assert script("return [...document.querySelectorAll('.settings-choice[open] .settings-options button')].map(button=>button.firstChild.textContent.trim())") == ['默认', '午夜']
            click('.settings-choice summary[aria-label="语言"]')
            click('.settings-choice[open] .settings-options button:nth-child(2)')
            wait_for(lambda: script("return document.documentElement.lang") == "en", "English language")
            script("Object.defineProperty(navigator, 'language', {configurable:true, value:'zh-CN'}); window.dispatchEvent(new Event('languagechange'))")
            assert script("return document.documentElement.lang") == 'en'
            click('.settings-choice summary[aria-label="Language"]')
            click('.settings-choice[open] .settings-options button:first-child')
            wait_for(lambda: script("return document.documentElement.lang") == 'zh-CN', 'system language')
            script("Object.defineProperty(navigator, 'language', {configurable:true, value:'en-US'}); window.dispatchEvent(new Event('languagechange'))")
            wait_for(lambda: script("return document.documentElement.lang") == 'en', 'changed system language')
            keys('input[data-setting="systemFontSize"]', '\ue011')
            keys('input[data-setting="contentFontSize"]', '\ue011')
            assert script("return [getComputedStyle(document.querySelector('main')).fontSize, getComputedStyle(document.querySelector('.node')).fontSize, getComputedStyle(document.querySelector('.tab-open')).fontSize]") == ['10px', '20px', '9px']
            click('.settings-actions button:first-child')
            keys('input[data-setting="systemFontSize"]', '\ue014\ue014')
            keys('input[data-setting="contentFontSize"]', '\ue014')
            keys('input[data-setting="tabHeight"]', '\ue014\ue014')
            keys('input[data-setting="statusHeight"]', '\ue014\ue014')
            wait_for(lambda: script("return JSON.parse(localStorage.getItem('mini-mindmap-display') || '{}').systemFontSize") == 16, 'saved display settings')
            assert script("return [getComputedStyle(document.querySelector('main')).fontSize, getComputedStyle(document.querySelector('.node')).fontSize, document.querySelector('.tab').getBoundingClientRect().height, document.querySelector('.bottom-bar').getBoundingClientRect().height]") == ['16px', '25px', 24, 22]
            click('.settings-actions button:last-child')

            tab_width = script("return document.querySelector('.tab.active').getBoundingClientRect().width")
            assert int(script("return getComputedStyle(document.querySelector('.tab.active .tab-open')).fontWeight")) >= 600
            script("document.querySelector('.tab.active .tab-open').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))")
            wait_for(lambda: script("return !!document.querySelector('.tab-rename')"), 'in-place tab editing')
            assert script("return document.querySelector('.tab.active').getBoundingClientRect().width") == tab_width
            assert script("return getComputedStyle(document.querySelector('.tab-rename')).backgroundColor") == 'rgba(0, 0, 0, 0)'
            keys('.tab-rename', '\ue009a\ue000Temporary title')
            keys('.tab-rename', '\ue009z\ue000')
            assert script("return document.querySelector('.tab-rename').value") != 'Temporary title'
            assert values() == ['Root 中文', 'Alpha', 'Beta']
            keys('.tab-rename', '\ue009a\ue000Named tab')
            keys('.tab-rename', '\ue009s\ue000')
            wait_for(lambda: script("return !!window.__miniTest.saved && !document.querySelector('.tab-rename')"), 'save commits tab rename')
            with zipfile.ZipFile(BytesIO(base64.b64decode(script("return window.__miniTest.saved")))) as archive:
                manifest = json.loads(archive.read('manifest.json'))
                assert json.loads(archive.read(manifest['maps'][0]))['tree']['tabTitle'] == 'Named tab'
            wait_for(lambda: script("return document.querySelector('.tab.active .tab-open')?.textContent") == 'Named tab', 'renamed tab')
            click(editor)
            keys(editor, "\ue009s\ue000")
            wait_for(lambda: script("return !!window.__miniTest.saved"), "save")
            assert script("return !document.activeElement?.matches('.node-text textarea')")
            wait_for(lambda: script("return !document.querySelector('.tab-dirty')"), 'saved tab indicator cleared')
            saved = base64.b64decode(script("return window.__miniTest.saved"))
            with zipfile.ZipFile(BytesIO(saved)) as archive:
                manifest = json.loads(archive.read("manifest.json"))
                tree = json.loads(archive.read(manifest["maps"][0]))["tree"]
                assert tree["text"] == "Root 中文"
                assert set(tree["relations"][0]["controls"]) == {"start", "end"}
                assert tree["relations"][0]["controls"]["start"]["x"] < 0
                assert tree["tabTitle"] == "Named tab"
                assert [node["text"] for node in tree["children"]] == ["Alpha", "Beta"]

            def saved_root():
                encoded = script("return window.__miniTest.saved")
                with zipfile.ZipFile(BytesIO(base64.b64decode(encoded))) as archive:
                    manifest = json.loads(archive.read("manifest.json"))
                    return json.loads(archive.read(manifest["maps"][0]))["tree"]["text"]

            keys(editor, "\ue009a\ue000Updated 中文")
            wait_for(lambda: script("return !!document.querySelector('.tab.active .tab-dirty')"), 'edited tab indicator')
            wait_for(lambda: saved_root() == "Updated 中文", "automatic save")
            wait_for(lambda: script("return !document.querySelector('.tab-dirty')"), 'autosaved tab indicator cleared')
            keys(editor, "\ue009z\ue000")
            wait_for(lambda: values()[0] != "Updated 中文", "undo after save")
            wait_for(lambda: saved_root() == values()[0], "automatic save after undo")
            for index, selector in [(5, '.floating-topic'), (6, '.floating-note')]:
                click('[aria-label="Menu"]')
                click('.app-menu-list .menu:nth-child(3) > button')
                click(f'.app-menu-list .menu:nth-child(3) .dropdown > button:nth-child({index})')
                wait_for(lambda: script("return !!document.querySelector(arguments[0])", selector), 'insert floating element from Edit menu')
                assert script("const c=document.querySelector('.canvas').getBoundingClientRect(), r=document.querySelector(arguments[0]).getBoundingClientRect(); return r.left >= c.left && r.top >= c.top && r.right <= c.right && r.bottom <= c.bottom", selector)
                keys(f'{selector} textarea', '\ue009z\ue000')
                wait_for(lambda: not script("return !!document.querySelector(arguments[0])", selector), 'undo menu insertion')
            script("document.querySelector('.canvas').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:40, clientY:140}))")
            click('.canvas-context button:first-child')
            keys('.floating-topic textarea', '\ue009a\ue000Free Topic\ue004')
            wait_for(lambda: script("return document.querySelectorAll('.floating-topic textarea').length") == 2, 'independent child topic')
            keys('.floating-topic .node.selected textarea', 'Free Child')
            script("document.querySelector('.floating-topic .node.selected').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:300, clientY:300}))")
            wait_for(lambda: script("return !!document.querySelector('.context .context-size')"), 'child topic context menu')
            script("document.querySelector('main').click(); document.activeElement?.blur()")
            points = script("""const node = [...document.querySelectorAll('.node')].find(el => el.querySelector('textarea')?.value === 'Free Child');
              const r = node.getBoundingClientRect();
              return [Math.round(r.x+r.width/2), Math.round(r.y+r.height/2), 50, window.innerHeight-80];""")
            drag_points(points)
            wait_for(lambda: script("return document.querySelectorAll('.floating-topic').length") == 2, 'detached child topic')
            wait_for(lambda: script("return !document.getAnimations().some(a => a.id === 'node-move' && a.playState === 'running')"), 'topic movement animation')
            points = script("""const topics = [...document.querySelectorAll('.floating-topic')];
              const child = topics.find(el => el.querySelector(':scope > .node-row > .node textarea')?.value === 'Free Child');
              const parent = topics.find(el => el.querySelector(':scope > .node-row > .node textarea')?.value === 'Free Topic');
              const a = child.querySelector(':scope > .node-row > .node').getBoundingClientRect(), b = parent.querySelector(':scope > .node-row > .node').getBoundingClientRect();
              return [Math.round(a.x+a.width/2), Math.round(a.y+a.height/2), Math.round(b.x+b.width/2), Math.round(b.y+b.height/2)];""")
            drag_points(points)
            wait_for(lambda: script("return document.querySelectorAll('.floating-topic').length") == 1 and parent_of('Free Child') == 'Free Topic', 'attached independent topic')
            keys(editor, '\ue009z\ue000')
            wait_for(lambda: script("return document.querySelectorAll('.floating-topic').length") == 2, 'undo topic attachment')
            keys(editor, '\ue009y\ue000')
            wait_for(lambda: script("return document.querySelectorAll('.floating-topic').length") == 1 and parent_of('Free Child') == 'Free Topic', 'redo topic attachment')
            script("document.querySelector('.canvas').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:380, clientY:180}))")
            click('.canvas-context button:nth-child(2)')
            keys('.floating-note textarea', 'Floating note text')
            click(editor)
            assert not script("return !!document.querySelector('.drag-handle,.floating-move')")
            def note_menu():
                script("document.querySelector('.floating-note').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:300, clientY:300}))")
                wait_for(lambda: script("return !!document.querySelector('.context .context-size')"), 'note context menu')
            note_menu()
            click('.context .format-buttons button[title="Bold"]')
            note_menu()
            click('.context .format-buttons button[title="Underline"]')
            note_menu()
            click('.context .colors button[aria-label="Red"]')
            note_menu()
            click('.context-size select option[value="10"]')
            wait_for(lambda: script("return getComputedStyle(document.querySelector('.floating-note textarea')).fontSize") == '10px', 'smaller note font')
            note_menu()
            click('.context-size select option[value="18"]')
            wait_for(lambda: script("const s=getComputedStyle(document.querySelector('.floating-note textarea')); return s.fontSize === '18px' && Number(s.fontWeight) >= 700 && s.textDecorationLine.includes('underline')"), 'note formatting')
            click('[aria-label="Menu"]')
            click('.structure-control > button')
            wait_for(lambda: script("return [...document.querySelectorAll('.app-menu-list .dropdown button')].some(b => b.textContent.trim() === 'Outline')"), 'outline menu item')
            script("[...document.querySelectorAll('.app-menu-list .dropdown button')].find(b => b.textContent.trim() === 'Outline').click()")
            wait_for(lambda: script("return !!document.querySelector('.structure-panel')"), 'outline')
            assert script("""const root=document.querySelector('.outline-list > ul > li > ul');
              return [...root.children].some(li => li.querySelector(':scope > .outline-row textarea')?.value === 'Free Topic') &&
                [...root.children].some(li => li.querySelector(':scope > .outline-row textarea')?.value === 'Floating note text') &&
                [...root.querySelectorAll('li ul textarea')].some(el => el.value === 'Free Child');""")
            keys('.structure-panel textarea[aria-label="Floating note"]', '\ue009a\ue000Updated note')
            wait_for(lambda: script("return document.querySelector('.floating-note textarea').value") == 'Updated note', 'outline note edit')
            script("""const e=document.querySelector('.structure-panel textarea[aria-label="Floating note"]');
              e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
              e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));""")
            keys('.structure-panel textarea[aria-label="Floating note"]', '\ue009z\ue000')
            wait_for(lambda: script("return document.querySelector('.floating-note textarea').value") != 'Updated note', 'undo after note composition')
            keys('.structure-panel textarea[aria-label="Floating note"]', '\ue009y\ue000')
            wait_for(lambda: script("return document.querySelector('.floating-note textarea').value") == 'Updated note', 'redo after note composition')
            click('.structure-panel button[aria-label="Locate note"]')
            wait_for(lambda: script("""const a=document.querySelector('.floating-note').getBoundingClientRect(), b=document.querySelector('.canvas').getBoundingClientRect();
              return Math.abs(a.left+a.width/2-b.left-b.width/2)<2 && Math.abs(a.top+a.height/2-b.top-b.height/2)<2;"""), 'locate floating note')
            keys('.structure-panel textarea[aria-label="Floating note"]', '\ue009a\ue000Floating note text')
            wait_for(lambda: script("return document.querySelector('.floating-note textarea').value") == 'Floating note text', 'outline note restore')
            click('.structure-panel button[aria-label="Close"]')
            assert not script("return !!document.querySelector('.floating-delete')")
            script("document.querySelector('.floating-note textarea').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:300, clientY:300}))")
            wait_for(lambda: script("return document.querySelector('.context .format-buttons button[title=Bold]')?.getAttribute('aria-pressed')") == 'true', 'note right-click menu')
            script("document.querySelector('main').click()")
            script("document.querySelector('.floating-topic > .node-row > .node').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:300, clientY:300}))")
            click('.context-actions button:first-child')
            script("const el = [...document.querySelectorAll('.node textarea')].find(x => x.value === 'Beta').closest('.node'); el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0}))")
            wait_for(lambda: script("return document.querySelectorAll('.relation-hit').length") == 2, 'cross-topic connection')
            script("document.querySelector('.floating-topic > .node-row > .node').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:300, clientY:300}))")
            assert script("return !!document.querySelector('.context-actions button:last-child svg.menu-icon[aria-hidden=true]')")
            click('.context-actions button:last-child')
            wait_for(lambda: script("return !document.querySelector('.floating-topic') && document.querySelectorAll('.relation-hit').length === 1"), 'removed independent topic and its connection')
            keys(editor, '\ue009z\ue000')
            wait_for(lambda: script("return !!document.querySelector('.floating-topic') && document.querySelectorAll('.relation-hit').length === 2"), 'undo independent topic deletion')
            old_relation = script("return document.querySelectorAll('.relation-line')[1].getAttribute('d')")
            for selector in ['.floating-topic', '.floating-note']:
                script("document.activeElement?.blur()")
                before = script("""const el = document.querySelector(arguments[0]), card=el.matches('.floating-topic') ? el.querySelector(':scope > .node-row > .node') : el;
                  const r=card.getBoundingClientRect(); return [el.style.left, el.style.top, Math.round(r.left+r.width/2), Math.round(r.top+r.height/2)];""", selector)
                end_x, end_y = (50, script('return window.innerHeight-80')) if selector == '.floating-topic' else (before[2] + 30, before[3] + 20)
                request(api + '/actions', {"actions": [{"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [
                    {"type": "pointerMove", "duration": 0, "x": before[2], "y": before[3]}, {"type": "pointerDown", "button": 0},
                    {"type": "pointerMove", "duration": 150, "x": end_x, "y": end_y}, {"type": "pointerUp", "button": 0}]}]})
                wait_for(lambda: script("const el = document.querySelector(arguments[0]); return [el.style.left, el.style.top]", selector) != before[:2], 'floating object moved')
                assert not script("return !!document.querySelector('.context')")
                if selector == '.floating-topic':
                    wait_for(lambda: script("return document.querySelectorAll('.relation-line')[1].getAttribute('d')") != old_relation, 'connection follows independent topic')
                else:
                    moved = script("const el = document.querySelector('.floating-note'); return [el.style.left, el.style.top]")
                    keys('.floating-note textarea', '\ue009z\ue000')
                    wait_for(lambda: script("const el = document.querySelector('.floating-note'); return [el.style.left, el.style.top]") == before[:2], 'undo note movement')
                    keys('.floating-note textarea', '\ue009y\ue000')
                    wait_for(lambda: script("const el = document.querySelector('.floating-note'); return [el.style.left, el.style.top]") == moved, 'redo note movement')
            click('[aria-label="Fit Canvas"]')
            wait_for(lambda: script("const c = document.querySelector('.canvas').getBoundingClientRect(); return [...document.querySelectorAll('.floating-object')].every(el => { const r=el.getBoundingClientRect(); return r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom; })"), 'floating objects fit in canvas')
            note_menu()
            click('.context-actions button:last-child')
            wait_for(lambda: script("return !document.querySelector('.floating-note')"), 'deleted floating note')
            keys(editor, '\ue009z\ue000')
            wait_for(lambda: script("return document.querySelector('.floating-note textarea')?.value") == 'Floating note text', 'undo note deletion')
            click(editor)
            keys(editor, '\ue009s\ue000')
            wait_for(lambda: script("return !document.querySelector('.tab-dirty')"), 'floating objects saved')
            saved = base64.b64decode(script("return window.__miniTest.saved"))
            with zipfile.ZipFile(BytesIO(saved)) as archive:
                manifest = json.loads(archive.read('manifest.json'))
                saved_map = json.loads(archive.read(manifest['maps'][0]))
                assert saved_map['floatingTopics'][0]['tree']['text'] == 'Free Topic'
                assert saved_map['floatingTopics'][0]['tree']['children'][0]['text'] == 'Free Child'
                assert saved_map['floatingNotes'][0]['text'] == 'Floating note text'
                assert saved_map['floatingNotes'][0]['textStyle'] == {'color': '#c45850', 'bold': True, 'underline': True, 'size': 18}
            for index, format_name in [(1, 'md'), (2, 'svg')]:
                click('[aria-label="Menu"]')
                click('.app-menu-list .menu:nth-child(2) > button')
                click('.dropdown details summary')
                click(f'.export-submenu button:nth-child({index})')
                wait_for(lambda: script("return window.__miniTest.exports.some(item => item.format === arguments[0])", format_name), f'{format_name} export')
                data = script("return window.__miniTest.exports.find(item => item.format === arguments[0]).data", format_name)
                assert all(text in data for text in ['Free Topic', 'Free Child', 'Floating note text'])
                if format_name == 'md':
                    assert '<u>**Floating note text**</u>' in data
                else:
                    assert 'font-weight="700"' in data and 'text-decoration="underline"' in data
            click('[aria-label="Menu"]')
            click('.app-menu-list .menu:nth-child(2) > button')
            click('.dropdown details summary')
            click('.export-submenu button:nth-child(3)')
            wait_for(lambda: script("return window.__miniTest.exports.some(item => item.format === 'png')"), 'PNG export')
            png = base64.b64decode(script("return window.__miniTest.exports.find(item => item.format === 'png').data"))
            assert png.startswith(b'\x89PNG\r\n\x1a\n')
            click('[aria-label="Menu"]')
            click('.app-menu-list .menu:first-child > button')
            wait_for(lambda: script("return document.querySelectorAll('.tab').length") == 2, 'reopened floating map')
            assert script("return document.querySelector('.floating-topic > .node-row > .node textarea').value") == 'Free Topic'
            assert sorted(script("return [...document.querySelectorAll('.floating-topic textarea')].map(el => el.value)")) == ['Free Child', 'Free Topic']
            assert script("return document.querySelector('.floating-note textarea').value") == 'Floating note text'
            assert script("const s=getComputedStyle(document.querySelector('.floating-note textarea')); return s.fontSize === '18px' && Number(s.fontWeight) >= 700 && s.textDecorationLine.includes('underline')")
            for selector, item in [('.floating-topic', saved_map['floatingTopics'][0]), ('.floating-note', saved_map['floatingNotes'][0])]:
                position = script("const el=document.querySelector(arguments[0]); return [parseFloat(el.style.left), parseFloat(el.style.top)]", selector)
                assert all(abs(actual - expected) < .001 for actual, expected in zip(position, [item['x'], item['y']])), (selector, position, item['x'], item['y'])
            wait_for(lambda: script("return document.querySelectorAll('.relation-hit').length") == 2, 'restored cross-topic connection')
            click('.tab.active .tab-close')
            click('.close-tab-actions .confirm-action')
            wait_for(lambda: script("return document.querySelectorAll('.tab').length") == 1, 'closed reopened map')
            script("[...document.querySelectorAll('.node textarea')].find(el => el.value === 'Beta').focus()")
            for index in range(6):
                keys('.node.selected textarea', '\ue004')
                wait_for(lambda: len(values()) == 6 + index, 'deep topic')
            long_text = '\n'.join('Line %03d ' % i + 'x' * 100 + ' TAIL-%03d' % i for i in range(120)) + '\nFINAL-PAGE-MARKER'
            script("const el = document.querySelector('.node.selected textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, arguments[0]); el.dispatchEvent(new Event('input', {bubbles:true}));", long_text)
            wait_for(lambda: any('FINAL-PAGE-MARKER' in value for value in values()), 'long topic')
            click('[aria-label="Menu"]')
            click('.app-menu-list .menu:nth-child(2) > button')
            click('.dropdown details summary')
            click('.export-submenu button:last-child')
            wait_for(lambda: script("return !!window.__miniTest.printed"), 'PDF print request')
            assert script("return document.querySelectorAll('.print-section').length") == 4
            assert script("return !!document.querySelector('.print-single-column .print-level')")
            pdf = request(api + '/goog/cdp/execute', {"cmd": "Page.printToPDF", "params": {"preferCSSPageSize": True, "printBackground": True}})
            pdf_path = Path(tmp) / 'test.pdf'
            pdf_path.write_bytes(base64.b64decode(pdf['data']))
            if shutil.which('pdftotext'):
                content = subprocess.check_output(['pdftotext', str(pdf_path), '-'], text=True)
                assert all(part in content for part in ['Alpha', 'Beta', 'main branches', 'L7', 'TAIL-000', 'TAIL-119', 'FINAL-PAGE-MARKER', 'Free Topic', 'Free Child', 'Floating note text']), content
            if shutil.which('pdfinfo'):
                info = subprocess.check_output(['pdfinfo', str(pdf_path)], text=True)
                assert int(next(line.split(':', 1)[1].strip() for line in info.splitlines() if line.startswith('Pages:'))) > 1
            # Keep the exit test dirty even if a slow CI runner takes longer than auto-save's debounce.
            if script("return document.querySelector('.autosave-switch').getAttribute('aria-checked')") == 'true':
                click('.autosave-switch')
            keys(editor, "\ue009a\ue000Unsaved exit")
            assert script("let prevented = false; window.__miniTest.close({preventDefault: () => prevented = true}); return prevented")
            wait_for(lambda: script("return document.querySelector('#confirm-title')?.textContent") == 'Quit Mini Mindmap?', 'exit confirmation')
            click('.close-tab-actions button')
            wait_for(lambda: not script("return !!document.querySelector('#confirm-title')"), 'cancelled exit')
            assert not script("return !!window.__miniTest.destroyed")
            script("window.__miniTest.failRecovery = true")
            assert script("let prevented = false; window.__miniTest.close({preventDefault: () => prevented = true}); return prevented")
            click('.close-tab-actions .confirm-action')
            wait_for(lambda: script("return document.querySelector('[role=alert]')?.textContent.includes('simulated recovery write failure')"), 'recovery write failure')
            assert not script("return !!window.__miniTest.destroyed")
            script("window.__miniTest.failRecovery = false")
            click('[role=alert] button')
            assert script("let prevented = false; window.__miniTest.close({preventDefault: () => prevented = true}); return prevented")
            click('.close-tab-actions .confirm-action')
            wait_for(lambda: script("return !!window.__miniTest.destroyed"), 'confirmed exit')
            request(api + '/refresh', {})
            wait_for(lambda: script("return document.querySelector('#confirm-title')?.textContent") == 'Recover unsaved work?', 'recovery prompt')
            keys('.close-tab-actions button:first-child', '\ue00c')
            assert script("return document.querySelector('#confirm-title')?.textContent") == 'Recover unsaved work?'
            assert script("return document.querySelector('.close-tab-dialog').open"), 'recovery dialog closed on Escape'
            click('.close-tab-actions .confirm-action')
            wait_for(lambda: script("return document.querySelector('.root-node textarea')?.value") == 'Unsaved exit', 'restored recovery draft')
            assert script("return !!document.querySelector('.tab.active .tab-dirty')")
            wait_for(lambda: script("return document.querySelector('.node') && getComputedStyle(document.querySelector('.node')).fontSize") == '25px', 'restored display settings')
            assert script("return getComputedStyle(document.querySelector('main')).fontSize") == '16px'
            assert script("return [document.querySelector('.tab').getBoundingClientRect().height, document.querySelector('.bottom-bar').getBoundingClientRect().height]") == [24, 22]
            script("localStorage.setItem('mini-mindmap-display', JSON.stringify({systemFontSize: 17, contentFontSize: 17, tabHeight: 25, statusHeight: 23}))")
            request(api + '/refresh', {})
            wait_for(lambda: script("return document.querySelector('#confirm-title')?.textContent") == 'Recover unsaved work?', 'recovery prompt after restart')
            click('.close-tab-actions button:first-child')
            wait_for(lambda: script("return document.querySelector('.node') && getComputedStyle(document.querySelector('.node')).fontSize") == '27px', 'saved font preference')
            assert script("return getComputedStyle(document.querySelector('main')).fontSize") == '17px'
            script("sessionStorage.setItem('recovery', '{broken')")
            request(api + '/refresh', {})
            wait_for(lambda: script("return document.querySelector('#confirm-title')?.textContent") == 'Recovery draft is invalid', 'invalid recovery prompt')
            click('.close-tab-actions button:first-child')
            wait_for(lambda: script("return document.querySelector('[role=alert]')?.textContent.includes('Could not restore recovery data')"), 'kept corrupt recovery error')
            assert script("return sessionStorage.getItem('recovery')") == '{broken'
            request(api + '/refresh', {})
            wait_for(lambda: script("return document.querySelector('#confirm-title')?.textContent") == 'Recovery draft is invalid', 'invalid recovery prompt after restart')
            click('.close-tab-actions .confirm-action')
            wait_for(lambda: script("return sessionStorage.getItem('recovery') === null"), 'discarded invalid recovery')
            keys('.root-node textarea', "\ue009a\ue000New draft")
            wait_for(lambda: script("return sessionStorage.getItem('recovery')?.includes('New draft')"), 'recovery enabled after discard')
            keys('.root-node textarea', '\ue004')
            wait_for(lambda: script("return document.querySelector('.root-node + .collapse')?.getAttribute('aria-expanded')") == 'true', 'expanded topic control')
            def collapse_metrics():
                return script("""const map=document.querySelector('.map'), b=document.querySelector('.root-node + .collapse'), original=map.className;
                  const result=['mindmap','reverse','org','fishbone','reverse-fishbone'].map(layout=>{map.className='map layout-'+layout;
                    const s=getComputedStyle(b); return [layout,s.width,s.height,s.marginTop,s.marginRight,s.marginBottom,s.marginLeft,getComputedStyle(b,'::before').display];});
                  map.className=original; return result;""")
            expanded = collapse_metrics()
            assert all(item[1:3] == ['7px', '7px'] for item in expanded), expanded
            assert [item[3:7] for item in expanded] == [['0px','0px','0px','3px'], ['0px','3px','0px','0px'], ['3px','0px','0px','0px'], ['0px','3px','0px','0px'], ['0px','0px','0px','3px']], expanded
            click('.root-node + .collapse')
            wait_for(lambda: script("return document.querySelector('.root-node + .collapse')?.getAttribute('aria-expanded')") == 'false', 'collapsed topic control')
            collapsed = collapse_metrics()
            assert all(item[3:7] == ['0px']*4 and item[7] == 'none' for item in collapsed), collapsed
            click('.root-node + .collapse')
            wait_for(lambda: script("return document.querySelector('.root-node + .collapse')?.getAttribute('aria-expanded')") == 'true', 'expanded topic again')
            keys('.node-row.depth-1 textarea', '\ue004')
            wait_for(lambda: script("return !!document.querySelector('.node-row.depth-2 > .node')"), 'underlined topic')
            wait_for(lambda: script("return !!document.querySelector('.node-row.depth-2').style.getPropertyValue('--connector-offset')"), 'connector alignment')
            assert script("return getComputedStyle(document.querySelector('.node-row.depth-2 > .node')).paddingBottom") == '2px'
            alignment = """const row=document.querySelector('.node-row.depth-2'), card=row.querySelector(':scope > .node'), map=document.querySelector('.map');
              const zoom=parseFloat(map.dataset.zoom) || 1, path=map.querySelector('.branch-layer path'), end=path.getPointAtLength(path.getTotalLength());
              return Math.abs(map.getBoundingClientRect().top + end.y*zoom - (card.getBoundingClientRect().bottom-parseFloat(getComputedStyle(card).borderBottomWidth)*zoom/2));"""
            wait_for(lambda: script(alignment) < 1.5, 'curve aligns with the topic underline')
            script("document.querySelector('.node-row.depth-2 > .node').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:300, clientY:300}))")
            click('.context .format-buttons button[title="Underline"]')
            wait_for(lambda: script("return getComputedStyle(document.querySelector('.node-row.depth-2 textarea')).textDecorationLine") == 'underline', 'topic text underline')
            assert script("return getComputedStyle(document.querySelector('.node-row.depth-2 > .node')).borderBottomWidth") == '4px'
            assert script("return getComputedStyle(document.querySelector('.node-row.depth-2 textarea')).textUnderlineOffset") == '1px'
            original_offset = script("return document.querySelector('.node-row.depth-2').style.getPropertyValue('--connector-offset')")
            keys('.node-row.depth-2 textarea', '\ue008\ue007\ue000Second line')
            wait_for(lambda: script("return document.querySelector('.node-row.depth-2').style.getPropertyValue('--connector-offset')") != original_offset, 'multiline connector realignment')
            svg_count = script("return window.__miniTest.exports.filter(item => item.format === 'svg').length")
            click('[aria-label="Menu"]')
            click('.app-menu-list .menu:nth-child(2) > button')
            click('.dropdown details summary')
            click('.export-submenu button:nth-child(2)')
            wait_for(lambda: script("return window.__miniTest.exports.filter(item => item.format === 'svg').length") > svg_count, 'updated SVG export')
            gap_error = script("""const source=document.querySelector('.node-row.depth-2 > .node'), input=source.querySelector('textarea');
              const measure=source.querySelector('.node-text-measure'), range=document.createRange(); range.selectNodeContents(measure);
              const nativeGap=source.getBoundingClientRect().bottom-parseFloat(getComputedStyle(source).borderBottomWidth)/2-range.getBoundingClientRect().top;
              const holder=document.createElement('div'); holder.style.cssText='position:fixed;left:-10000px;top:0';
              holder.innerHTML=window.__miniTest.exports.filter(item=>item.format==='svg').at(-1).data; document.body.appendChild(holder);
              const svg=holder.querySelector('svg'), text=[...svg.querySelectorAll('text')].find(el=>el.querySelector('tspan')?.textContent===input.value.split('\\n')[0]);
              const line=text?.previousElementSibling;
              const result=line?.tagName.toLowerCase()==='line' ? Math.abs((line.getBoundingClientRect().top-text.getBoundingClientRect().top)-nativeGap) : 999;
              holder.remove(); return result;""")
            assert gap_error < 2.5, gap_error
            for language, native_name, title, recovery_title, file_label, font_name in [
                ('ja', '日本語', '設定', '未保存の内容を復元しますか？', 'ファイル', 'Noto Sans CJK JP'),
                ('ko', '한국어', '설정', '저장하지 않은 작업을 복구할까요?', '파일', 'Noto Sans CJK KR'),
            ]:
                contents = values()
                click('.app-menu-btn')
                click('.app-menu-list .menu:last-child > button')
                click('.settings-choice summary')
                script("[...document.querySelectorAll('.settings-choice[open] .settings-options button')].find(button=>button.textContent.trim()===arguments[0]).click()", native_name)
                wait_for(lambda: script("return document.documentElement.lang") == language, f'{language} interface')
                assert script("return document.querySelector('#settings-title').textContent") == title
                assert script("return localStorage.getItem('mini-mindmap-language')") == language
                assert font_name in script("return getComputedStyle(document.documentElement).fontFamily")
                for index, theme in [(1, 'default'), (2, 'midnight')]:
                    click('.settings-row:nth-of-type(3) .settings-choice summary')
                    click(f'.settings-choice[open] .settings-options button:nth-child({index})')
                    wait_for(lambda: script("return document.querySelector('main').dataset.theme") == theme, f'{language} {theme} theme')
                    assert script("return [...document.querySelectorAll('.settings-dialog button,.settings-dialog summary')].every(el=>el.scrollWidth<=el.clientWidth+1)"), f'{language} settings overflow'
                click('.settings-actions button:last-child')
                click('.app-menu-btn')
                assert file_label in script("return document.querySelector('.app-menu-list').textContent")
                click('.app-menu-list .menu:nth-child(3) > button')
                assert script("return [...document.querySelectorAll('.dropdown button')].every(el=>el.scrollWidth<=el.clientWidth+1)"), f'{language} edit menu overflow'
                script("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))")
                assert values() == contents, 'changing UI language translated document content'
                wait_for(lambda: script("const raw=sessionStorage.getItem('recovery'); if(!raw) return false; const doc=JSON.parse(raw), root=doc.tree || doc.tabs[doc.active].tree, texts=[]; const walk=node=>{texts.push(node.text); node.children.forEach(walk);}; walk(root); return root.template==='midnight' && JSON.stringify(texts)===JSON.stringify(arguments[0])", contents), 'complete localized recovery snapshot')
                request(api + '/refresh', {})
                wait_for(lambda: script("return document.querySelector('#confirm-title')?.textContent") == recovery_title, f'{language} recovery dialog after restart')
                click('.close-tab-actions .confirm-action')
                wait_for(lambda: values() == contents, f'{language} document restored')
                assert script("return document.documentElement.lang") == language
                assert script("return localStorage.getItem('mini-mindmap-language')") == language

            # Overlapping summaries and summary descendants cannot be grouped again.
            def topic(key, **extra):
                return {'key': key, 'text': key, 'children': [], **extra}
            fixture = {'format': 'mini-mindmap', 'version': 2, 'type': 'map', 'tree': {
                'key': 'root', 'text': 'Root', 'layout': 'mindmap',
                'children': [topic('a'), topic('b'), topic('c'), topic('d'), topic('e'),
                    topic('outer', children=[topic('outer-a'), topic('outer-b')]),
                    topic('left-a', side='left'), topic('left-b', side='left'),
                    topic('left-c', side='left'), topic('left-outer', side='left')],
                'summaries': [{'key': 'outer', 'topics': ['a', 'b', 'c']},
                    {'key': 'left-outer', 'topics': ['left-a', 'left-b', 'left-c']}],
            }}
            script("localStorage.setItem('mini-mindmap-language','en'); sessionStorage.setItem('recovery',arguments[0])", json.dumps(fixture))
            request(api + '/refresh', {})
            wait_for(lambda: script("return !!document.querySelector('#confirm-title')"), 'summary recovery')
            click('.close-tab-actions .confirm-action')
            wait_for(lambda: script("return document.querySelectorAll('.summary-group').length") == 2, 'separate summaries')
            script("document.querySelector('[data-drop-key=a]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))")
            wait_for(lambda: script("return [...document.querySelectorAll('.context-actions button')].some(el=>el.textContent.includes('Add summary'))"), 'single topic summary action')
            assert script("return [...document.querySelectorAll('.context-actions button')].find(el=>el.textContent.includes('Add summary')).disabled")

            def select_topics(topic_keys):
                script("document.querySelector('.root-node').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1}))")
                for key in topic_keys:
                    script("document.querySelector(`[data-drop-key=\"${arguments[0]}\"]`).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,ctrlKey:true}))", key)
                    wait_for(lambda: script("return document.querySelector(`[data-drop-key=\"${arguments[0]}\"]`).classList.contains('selected')", key), 'select topics for summary rules')

            def create_summary(topic_keys):
                before = set(script("return [...document.querySelectorAll('.summary-group')].map(el=>el.dataset.summaryKey)"))
                select_topics(topic_keys)
                script("document.querySelector(`[data-drop-key=\"${arguments[0]}\"]`).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))", topic_keys[0])
                wait_for(lambda: script("return [...document.querySelectorAll('.context-actions button')].some(el=>el.textContent.includes('Add summary') && !el.disabled)"), 'enabled summary action')
                script("[...document.querySelectorAll('.context-actions button')].find(el=>el.textContent.includes('Add summary')).click()")
                wait_for(lambda: script("return document.querySelectorAll('.summary-group').length") == len(before)+1, 'summary created')
                return next(iter(set(script("return [...document.querySelectorAll('.summary-group')].map(el=>el.dataset.summaryKey)")) - before))

            for choice in [['a', 'b'], ['a', 'c'], ['a', 'd'], ['b', 'd'], ['outer', 'd'], ['outer-a', 'outer-b']]:
                select_topics(choice)
                script("document.querySelector(`[data-drop-key=\"${arguments[0]}\"]`).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))", choice[0])
                wait_for(lambda: script("return !!document.querySelector('.context-actions button')"), 'invalid summary selection menu')
                assert script("return [...document.querySelectorAll('.context button')].map(el=>el.textContent.trim())") == ['Add summary', 'Delete'], choice
                assert script("const b=[...document.querySelectorAll('.context-actions button')].find(el=>el.textContent.includes('Add summary')); return b.disabled && getComputedStyle(b).opacity==='0.45'"), choice
                script("[...document.querySelectorAll('.context-actions button')].find(el=>el.textContent.includes('Add summary')).click()")
                assert script("return document.querySelectorAll('.summary-group').length") == 2, choice
                click('[aria-label="Menu"]')
                click('.app-menu-list .menu:nth-child(3) > button')
                assert script("const b=[...document.querySelectorAll('.dropdown button')].find(el=>el.textContent.includes('Add summary')); return !!b && b.disabled && getComputedStyle(b).opacity==='0.45'"), choice
                click('[aria-label="Menu"]')
            select_topics(['d', 'e'])
            click('[aria-label="Menu"]')
            click('.app-menu-list .menu:nth-child(3) > button')
            assert script("const b=[...document.querySelectorAll('.dropdown button')].find(el=>el.textContent.includes('Add summary')); return !!b && !b.disabled")
            click('[aria-label="Menu"]')
            create_summary(['d', 'e'])

            collision = {'format': 'mini-mindmap', 'version': 2, 'type': 'map', 'tree': {
                'key': 'root', 'text': 'Root', 'layout': 'mindmap',
                'children': [topic('ra'), topic('rb'), topic('rc', children=[topic('right unrelated topic with a long title'), topic('rc2'), topic('rc3')]), topic('re'), topic('rf'),
                    topic('rs', children=[topic(f'rd{i}') for i in range(10)]), topic('rs2', children=[topic(f'red{i}') for i in range(10)]),
                    topic('la', side='left'), topic('lb', side='left'),
                    topic('lc', side='left', children=[topic('left unrelated topic with a long title'), topic('lc2'), topic('lc3')]), topic('le', side='left'), topic('lf', side='left'),
                    topic('ls', side='left', children=[topic(f'ld{i}') for i in range(10)]), topic('ls2', side='left', children=[topic(f'led{i}') for i in range(10)])],
                'summaries': [{'key': 'rs', 'topics': ['ra', 'rb']}, {'key': 'ls', 'topics': ['la', 'lb']},
                    {'key': 'rs2', 'topics': ['re', 'rf']}, {'key': 'ls2', 'topics': ['le', 'lf']}],
            }}
            script("sessionStorage.setItem('recovery',arguments[0])", json.dumps(collision))
            request(api + '/refresh', {})
            wait_for(lambda: script("return !!document.querySelector('#confirm-title')"), 'summary collision recovery')
            click('.close-tab-actions .confirm-action')
            def summary_avoids_branches():
                return script("""const normal=[...document.querySelectorAll('[data-drop-key]')].filter(el=>!el.closest('.summary-group'));
                  const groups=[...document.querySelectorAll('.summary-group')];
                  const separated=(a,b)=>{a=a.getBoundingClientRect(); b=b.getBoundingClientRect();
                    return a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top;};
                  return groups.length===4 && groups.every(group=>[...group.querySelectorAll('.summary-node [data-drop-key]')].every(card=>
                    normal.every(other=>separated(card,other)) && groups.filter(other=>other!==group).every(other=>
                      [...other.querySelectorAll('.summary-node [data-drop-key]')].every(otherCard=>separated(card,otherCard)))));""")
            wait_for(summary_avoids_branches, 'summary subtrees avoid unrelated branches')
            for _ in range(3): click('[aria-label="Zoom Out"]')
            wait_for(summary_avoids_branches, 'summary subtrees avoid branches after zoom')
            for _ in range(3): click('[aria-label="Zoom In"]')
            wait_for(summary_avoids_branches, 'summary subtrees avoid branches after restoring zoom')

            rules = {'format': 'mini-mindmap', 'version': 2, 'type': 'map', 'tree': {
                'key': 'root', 'text': 'Root', 'layout': 'mindmap',
                'children': [topic('a'), topic('b'), topic('c'), topic('d'), topic('e'),
                    topic('parent', children=[topic('child')]), topic('left', side='left')],
            }}
            script("sessionStorage.setItem('recovery',arguments[0])", json.dumps(rules))
            request(api + '/refresh', {})
            wait_for(lambda: script("return !!document.querySelector('#confirm-title')"), 'summary rules recovery')
            click('.close-tab-actions .confirm-action')
            wait_for(lambda: script("return !!document.querySelector('[data-drop-key=a]')"), 'summary rules topics')
            grouped = create_summary(['a', 'c'])
            wait_for(lambda: script("const d=JSON.parse(sessionStorage.getItem('recovery')||'null'); return JSON.stringify(d?.tree?.summaries?.find(s=>s.key===arguments[0])?.topics)===JSON.stringify(['a','b','c'])", grouped), 'intervening summary member is saved')
            click('[data-drop-key=a]')
            script("""const card=document.querySelector('[data-drop-key=a]'); card.focus();
              card.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));""")
            wait_for(lambda: script("return document.querySelector('.node.selected textarea')?.value") == 'New topic', 'new sibling inside summary')
            inserted = script("return document.querySelector('.node.selected').dataset.dropKey")
            wait_for(lambda: script("const d=JSON.parse(sessionStorage.getItem('recovery')||'null'); return d?.tree?.summaries?.find(s=>s.key===arguments[0])?.topics.includes(arguments[1])", grouped, inserted), 'new sibling joins the summary')
            script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: not script("return !!document.querySelector(`[data-drop-key=\"${arguments[0]}\"]`)", inserted), 'undo inserted summary member')

            for choice in [['a', 'left'], ['parent', 'child']]:
                select_topics(choice)
                script("document.querySelector(`[data-drop-key=\"${arguments[0]}\"]`).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))", choice[0])
                wait_for(lambda: script("return !!document.querySelector('.context-actions button')"), 'invalid summary selection menu')
                assert script("return [...document.querySelectorAll('.context button')].map(el=>el.textContent.trim())") == ['Add summary', 'Delete']
                assert script("return [...document.querySelectorAll('.context-actions button')].find(el=>el.textContent.includes('Add summary')).disabled")
            separate = create_summary(['d', 'e'])
            points = script("""const a=document.querySelector('[data-drop-key=d]').getBoundingClientRect(), b=document.querySelector('[data-drop-key=a]').getBoundingClientRect();
              return [Math.round(a.x+a.width/2),Math.round(a.y+a.height/2),Math.round(b.x+b.width/2),Math.round(b.y+b.height/2)];""")
            drag_points(points)
            wait_for(lambda: script("return document.querySelector('[role=alert]')?.textContent.includes('conflicting summaries')"), 'conflicting summary move rejected')
            assert parent_of('d') == 'Root' and script("return !!document.querySelector(`[data-summary-key=\"${arguments[0]}\"]`)", separate)
            click('[role=alert] button')
            select_topics(['a', 'b', 'c'])
            script("document.querySelector('[data-drop-key=a]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))")
            click('.context-actions button:last-child')
            wait_for(lambda: not script("return !!document.querySelector(`[data-summary-key=\"${arguments[0]}\"]`)", grouped), 'empty summary deleted with its members')
            assert script("return !!document.querySelector(`[data-summary-key=\"${arguments[0]}\"]`)", separate)
            script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))")
            wait_for(lambda: script("return !!document.querySelector(`[data-summary-key=\"${arguments[0]}\"]`) && ['a','b','c'].every(k=>document.querySelector(`[data-drop-key=\"${k}\"]`))", grouped), 'undo summary member deletion')

            nested = {'format': 'mini-mindmap', 'version': 2, 'type': 'map', 'tree': {
                'key': 'root', 'text': 'Root', 'children': [topic('parent', children=[
                    topic('a'), topic('b'), topic('summary', children=[topic('summary child')])]), topic('left', side='left')],
                'summaries': [{'key': 'summary', 'topics': ['a', 'b']}],
            }, 'floatingTopics': [{'x': 500, 'y': -180, 'tree': topic('floating', children=[topic('floating child')])}]}
            script("sessionStorage.setItem('recovery',arguments[0])", json.dumps(nested))
            request(api + '/refresh', {})
            wait_for(lambda: script("return !!document.querySelector('#confirm-title')"), 'nested summary recovery')
            click('.close-tab-actions .confirm-action')
            wait_for(lambda: script("return document.querySelector('.summary-node > .depth-2')?.style.getPropertyValue('--connector-offset')") == '0px', 'filled summary connector aligns to its center')
            assert script("const s=getComputedStyle(document.querySelector('.summary-node > .depth-2 > .node')); return [s.backgroundColor,s.color,s.borderBottomWidth]") == ['rgb(99, 123, 50)', 'rgb(255, 255, 255)', '0px']
            wait_for(lambda: script("return (document.querySelector('.branch-layer path')?.getAttribute('d')?.match(/Q/g)||[]).length") == 6, 'curves include both sides, floating topics and summary children')
            assert script("""const map=document.querySelector('.map'), root=map.querySelector(':scope > .node-row > .node').getBoundingClientRect(),
              left=document.querySelector('[data-drop-key=left]').getBoundingClientRect(), origin=map.getBoundingClientRect(), z=Number(map.dataset.zoom),
              values=map.querySelector('.branch-layer path').getAttribute('d').split('M')[1].match(/-?(?:\\d*\\.)?\\d+/g).map(Number);
              return Math.abs(values[0]-(root.left-origin.left)/z)<1 && Math.abs(values.at(-2)-(left.right-origin.left)/z)<1 && Math.abs(values.at(-1)-(left.top+left.height/2-origin.top)/z)<1;""")
            for button, count in [('Zoom Out', 5), ('Zoom In', 10), ('Zoom Out', 5)]:
                for _ in range(count): click(f'[aria-label="{button}"]')
                wait_for(lambda: script("""const map=document.querySelector('.map'), left=document.querySelector('[data-drop-key=left]').getBoundingClientRect(),
                  origin=map.getBoundingClientRect(), z=Number(map.dataset.zoom), values=map.querySelector('.branch-layer path').getAttribute('d').split('M')[1].match(/-?(?:\\d*\\.)?\\d+/g).map(Number);
                  return Math.abs(origin.left+values.at(-2)*z-left.right)<2 && Math.abs(origin.top+values.at(-1)*z-left.top-left.height/2)<2;"""), 'curve stays attached when zooming')
            geometry = script("return [...document.querySelectorAll('.node')].map(n=>{const s=getComputedStyle(n); return [s.padding,s.borderTopWidth,s.borderBottomWidth,s.borderRadius,s.fontSize,s.fontWeight,n.offsetWidth,n.offsetHeight]})")
            click('[aria-label="Menu"]')
            click('.app-menu-list .menu:last-child > button')
            click('.settings-choice summary[aria-label="Theme"]')
            click('.settings-choice[open] .settings-options button:nth-child(2)')
            wait_for(lambda: script("return document.querySelector('main').dataset.theme") == 'midnight', 'night theme for all topic types')
            assert script("return [...document.querySelectorAll('.node')].map(n=>{const s=getComputedStyle(n); return [s.padding,s.borderTopWidth,s.borderBottomWidth,s.borderRadius,s.fontSize,s.fontWeight,n.offsetWidth,n.offsetHeight]})") == geometry
            assert script("return getComputedStyle(document.querySelector('.node-row.depth-2 > .node')).color") == 'rgb(217, 230, 240)'
            assert script("return getComputedStyle(document.querySelector('.floating-topic .root-node')).backgroundColor") == 'rgb(24, 83, 97)'
            assert script("return getComputedStyle(document.querySelector('.summary-node > .node-row > .node')).backgroundColor") == 'rgb(96, 52, 84)'
            colors = script("""const style=s=>getComputedStyle(document.querySelector(s)), canvas=style('.canvas');
              return ['.map > .node-row > .root-node', '.node-row.depth-1 > .node', '.node-row.depth-2 > .node',
                '.floating-topic .root-node', '.summary-node > .node-row > .node', '.settings-dialog'].map(selector=>{
                const s=style(selector); return [selector,s.color,s.backgroundColor==='rgba(0, 0, 0, 0)' ? canvas.backgroundColor : s.backgroundColor];
              });""")
            for label, foreground, background in colors:
                assert contrast_ratio(foreground, background) >= 4.5, (label, foreground, background)
            assert request(api + '/execute/async', {"script": "const done=arguments[arguments.length-1]; import('/src/export.ts').then(({makeSvg})=>{const m=document.querySelector('.map'), svg=new DOMParser().parseFromString(makeSvg(m,document.querySelector('.canvas'),Number(m.dataset.zoom)).svg,'image/svg+xml'); done([svg.querySelector('svg > rect').getAttribute('fill'), [...svg.querySelectorAll('svg > g > path')].filter(p=>p.getAttribute('d').includes('Q')).length]);});", "args": []}) == ['rgb(13, 16, 28)', 6]
            click('.settings-actions button:last-child')
            before_move = script("return document.querySelector('.branch-layer path').getAttribute('d')")
            point = script("const r=document.querySelector('.floating-topic > .node-row > .node').getBoundingClientRect(); return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2),50,window.innerHeight-80]")
            drag_points(point)
            wait_for(lambda: not script("return document.querySelector('.map').getAnimations({subtree:true}).some(a=>a.id==='node-move' && a.playState==='running')"), 'floating topic movement settles')
            wait_for(lambda: script("return document.querySelector('.branch-layer path').getAttribute('d')") != before_move, 'curves follow floating topics')
            wait_for(lambda: script("""const map=document.querySelector('.map'), branches=[...map.querySelectorAll('.children > .branch')],
              branch=map.querySelector('.floating-topic .children > .branch'), index=branches.indexOf(branch), node=branch.querySelector(':scope > .node-row > .node').getBoundingClientRect(),
              origin=map.getBoundingClientRect(), z=Number(map.dataset.zoom), values=map.querySelector('.branch-layer path').getAttribute('d').split('M')[index+1].match(/-?(?:\\d*\\.)?\\d+/g).map(Number);
              return Math.abs(origin.left+values.at(-2)*z-node.left)<2 && Math.abs(origin.top+values.at(-1)*z-node.top-node.height/2)<2;"""), 'floating topic curve stays attached after moving')
            click('.root-node + .collapse')
            wait_for(lambda: script("return (document.querySelector('.branch-layer path')?.getAttribute('d')?.match(/Q/g)||[]).length") == 1, 'collapsed branches hide their curves')
            click('.root-node + .collapse')
            wait_for(lambda: script("return (document.querySelector('.branch-layer path')?.getAttribute('d')?.match(/Q/g)||[]).length") == 6, 'expanded branches restore their curves')
            for index, layout, curves in [(2, 'logic', 6), (3, 'reverse', 6), (4, 'org', 6), (5, 'fishbone', 3), (6, 'reverse-fishbone', 3), (1, 'mindmap', 6)]:
                click('[aria-label="Menu"]')
                click('.structure-control > button')
                click('.structure-control details summary')
                click(f'.structure-control .export-submenu button:nth-child({index})')
                wait_for(lambda: script("return document.querySelector('.map').classList.contains(arguments[0])", 'layout-'+layout), f'{layout} layout')
                wait_for(lambda: script("return (document.querySelector('.branch-layer path')?.getAttribute('d')?.match(/Q/g)||[]).length") == curves, f'{layout} branch curves')
                assert request(api + '/execute/async', {"script": "const done=arguments[arguments.length-1]; import('/src/export.ts').then(({makeSvg})=>{const m=document.querySelector('.map'), svg=new DOMParser().parseFromString(makeSvg(m,document.querySelector('.canvas'),Number(m.dataset.zoom)).svg,'image/svg+xml'); done([...svg.querySelectorAll('svg > g > path')].filter(p=>p.getAttribute('d').includes('Q')).length);});", "args": []}) == curves
                assert request(api + '/execute/async', {"script": """const done=arguments[arguments.length-1]; requestAnimationFrame(()=>requestAnimationFrame(()=>import('/src/export.ts').then(({makeSvg})=>{
                  const m=document.querySelector('.map'), raw=makeSvg(m,document.querySelector('.canvas'),Number(m.dataset.zoom)).svg;
                  const holder=document.createElement('div'); holder.style.cssText='position:fixed;left:-10000px'; holder.innerHTML=raw; document.body.appendChild(holder);
                  const svg=holder.querySelector('svg'), b=[...svg.querySelectorAll('svg > g > path')].find(p=>p.getAttribute('d').includes('Q')),
                    a=document.createElementNS('http://www.w3.org/2000/svg','path'); a.setAttribute('d','M'+m.querySelector('.branch-layer path').getAttribute('d').split('M')[1]); svg.appendChild(a);
                  const length=b.getTotalLength(), a0=a.getPointAtLength(0), b0=b.getPointAtLength(0);
                  const ok=[0,.25,.5,1].every(t=>{const x=a.getPointAtLength(length*t), y=b.getPointAtLength(length*t); return Math.abs((y.x-x.x)-(b0.x-a0.x))<1 && Math.abs((y.y-x.y)-(b0.y-a0.y))<1});
                  holder.remove(); done(ok); })));""", "args": []}), f'{layout} exported curve differs from canvas'
                if 'fishbone' in layout:
                    assert script("return getComputedStyle(document.querySelector('.map > .node-row > .children > .branch'), '::before').display") == 'block'

            launched = {"Ok": {"name": "reference.minimap", "contents": base64.b64encode((ROOT / 'tests/fixtures/reference.minimap').read_bytes()).decode()}}
            script("localStorage.setItem('mini-mindmap-auto-save', 'false'); sessionStorage.removeItem('recovery'); sessionStorage.setItem('test-launches', JSON.stringify([arguments[0]]))", launched)
            request(api + '/refresh', {})
            wait_for(lambda: script("return document.querySelector('.root-node textarea')?.value") == 'Second tab', 'file opened at startup')
            assert script("return document.querySelectorAll('.tab').length") == 2
            assert script("return window.__miniTest.title") == 'Mini Mindmap · mini-mindmap-test'
            assert script("return document.querySelector('main').dataset.theme") == 'midnight'
            click('.tab:first-child .tab-open')
            wait_for(lambda: script("return document.querySelector('.root-node textarea')?.value") == 'Reading notes 阅读笔记', 'reference document opens')
            assert script("return document.querySelector('main').dataset.theme") == 'default'
            click('.tab:nth-child(2) .tab-open')
            wait_for(lambda: script("return document.querySelector('.root-node textarea')?.value") == 'Second tab', 'restored night theme tab')
            assert script("return document.querySelector('main').dataset.theme") == 'midnight'
            script("document.querySelector('.tab.active .tab-open').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
            wait_for(lambda: script("return !!document.querySelector('.tab-rename')"), 'tab rename before file launch')
            keys('.tab-rename', '\ue009a\ue000Pending title')
            assert not script("return !!document.querySelector('.tab.active .tab-dirty')")
            script("window.__miniTest.launches.push(arguments[0]); window.__miniTest.launchListener()", launched)
            wait_for(lambda: script("return document.querySelector('#confirm-title')?.textContent") == 'Open workspace?', 'pending rename is committed before launch')
            click('.close-tab-actions button:first-child')
            assert script("return document.querySelector('.tab.active .tab-open').textContent") == 'Pending title'
            assert script("return !!document.querySelector('.tab.active .tab-dirty')")
            keys('.root-node textarea', '\ue009a\ue000Pending edit')
            wait_for(lambda: script("return !!document.querySelector('.tab.active .tab-dirty')"), 'unsaved edit before file launch')
            script("document.querySelector('.root-node textarea').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})); window.__miniTest.launches.push(arguments[0]); window.__miniTest.launchListener()", launched)
            time.sleep(.2)
            assert script("return window.__miniTest.launches.length") == 1, 'opening must wait for composition'
            script("document.querySelector('.root-node textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))")
            wait_for(lambda: script("return document.querySelector('#confirm-title')?.textContent") == 'Open workspace?', 'confirmation before replacing unsaved work')
            click('.close-tab-actions button:first-child')
            assert script("return document.querySelector('.root-node textarea').value") == 'Pending edit'
            script("sessionStorage.setItem('test-launches', JSON.stringify([arguments[0]]))", launched)
            wait_for(lambda: script("return sessionStorage.getItem('recovery')?.includes('Pending edit')"), 'recovery draft before launch')
            request(api + '/refresh', {})
            wait_for(lambda: script("return document.querySelector('#confirm-title')?.textContent") == 'Recover unsaved work?', 'recovery takes priority over opening')
            assert script("return window.__miniTest.launches.length") == 1
            click('.close-tab-actions .confirm-action')
            wait_for(lambda: script("return document.querySelector('#confirm-title')?.textContent") == 'Open workspace?', 'confirmation after recovering draft')
            click('.close-tab-actions button:first-child')
            assert script("return document.querySelector('.root-node textarea').value") == 'Pending edit'
            script("window.__miniTest.launches.push({Err:'simulated unreadable file'},arguments[0]); window.__miniTest.launchListener()", launched)
            wait_for(lambda: script("return document.querySelector('#confirm-title')?.textContent") == 'Open workspace?', 'queued file after an unreadable file')
            click('.close-tab-actions .confirm-action')
            wait_for(lambda: script("return document.querySelector('.root-node textarea')?.value") == 'Second tab', 'file opened in running app')
            assert script("return document.querySelector('[role=alert]')?.textContent.includes('simulated unreadable file')")
            assert script("return window.__miniTest.errors") == [], 'uncaught browser error or promise rejection'
            print("PASS: editing, Unicode text, dragging, undo/redo, zoom, tabs, themes, language, saving and file launches")
        except Exception:
            traceback.print_exc()
            log.flush()
            log.seek(0)
            output = log.read().strip()
            if output:
                print(f"Service log:\n{output[-3000:]}", file=sys.stderr)
            raise
        finally:
            if session:
                try:
                    req = urllib.request.Request(f"http://127.0.0.1:{driver_port}/session/{session}", method="DELETE")
                    urllib.request.urlopen(req, timeout=3).close()
                except (OSError, urllib.error.URLError):
                    pass
            for proc in processes:
                proc.terminate()
            for proc in processes:
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
            log.close()


if __name__ == "__main__":
    try:
        run()
    except (AssertionError, RuntimeError, OSError) as error:
        frame = traceback.extract_tb(error.__traceback__)[-1]
        detail = str(error) or frame.line or type(error).__name__
        print(f"UI test failed at {frame.filename}:{frame.lineno}: {detail}", file=sys.stderr)
        sys.exit(1)

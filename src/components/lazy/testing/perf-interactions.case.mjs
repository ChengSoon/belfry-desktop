import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { cleanupScope, temporary } from "../../../../scripts/plugin-tests/support.mjs";
import { BrowserProcess } from "../../../../src-tauri/src/plugins/node/browser-process.mjs";
import { BrowserTarget } from "../../../../src-tauri/src/plugins/node/browser-target.mjs";
import { click, waitFor } from "../../../../scripts/plugin-tests/market-ui-support.mjs";

const baseline = process.env.PERF_BASELINE === "1";
async function fixture(t) {
  const scope = cleanupScope(t), root = await temporary(scope);
  const server = await createServer({ configFile: false, logLevel: "warn", cacheDir: join(root, "vite"),
    plugins: [{ name: "perf-counter-test-only", enforce: "pre", transform(source, id) {
      if (!id.endsWith("/src/layout/components/TerminalStage.tsx")) return;
      const anchor = "  // launch 变了";
      assert.equal(source.split(anchor).length, 2, "SessionTerminal instrumentation anchor must be unique");
      return source.replace(anchor, "  window.__perf.terminals[tab.id] = (window.__perf.terminals[tab.id] ?? 0) + 1;\n" + anchor);
    } }, react()], server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
  });
  scope.after(() => server.close()); await server.listen();
  const browser = await new BrowserProcess(join(root, "browser")).start(); scope.after(() => browser.close());
  const view = await new BrowserTarget(browser, { workspace: root, frame: () => {}, state: () => {} }).start();
  scope.after(() => view.close());
  await view.bounds({ x: 0, y: 0, width: 1440, height: 960 });
  await view.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  const source = await readFile(new URL("./productionNative.js", import.meta.url), "utf8");
  await view.send("Page.addScriptToEvaluateOnNewDocument", { source });
  await view.navigate({ url: `http://127.0.0.1:${server.httpServer.address().port}/src/components/lazy/testing/perf-interactions.html` });
  try {
    await waitFor(view, "window.__perf && Object.values(__perf.snapshots).filter(s => s.phase === 'running').length === 3 && document.querySelectorAll('.xterm').length === 3");
  } catch (error) {
    t.diagnostic(JSON.stringify(await view.cdp.evaluate("({native:window.__productionQA,perf:window.__perf})")));
    throw error;
  }
  await view.cdp.evaluate(`window.__originalTerminals = [...document.querySelectorAll('.xterm')];
    window.__bodyChanges = 0;
    new MutationObserver(records => { __bodyChanges += records.length; }).observe(document.body, {attributes:true, attributeFilter:['class']});`);
  await settle(view);
  return view;
}
const settle = (view) => view.cdp.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30))))");
const reset = (view) => view.cdp.evaluate("__perfAPI.reset(); __bodyChanges = 0");
const counts = (view) => view.cdp.evaluate("({commits:__perf.commits, dragCommits:__perf.dragCommits, terminals: {A:0,B:0,C:0,...__perf.terminals}, bodyClassMutations:__bodyChanges})");
const pointer = (view, type, x, y, selector, button = 0) => view.cdp.evaluate(`__perfAPI.pointer(${JSON.stringify(type)},${x},${y},${JSON.stringify(selector)},${button})`);

// Capture BEFORE editing with PERF_BASELINE=1. The exact same mounted browser
// sequence is then rerun without that flag, which enables optimization assertions.
test("mounted terminal/sidebar/switch/drag measured regression", { timeout: 90_000 }, async (t) => {
  const view = await fixture(t);
  const result = { mode: baseline ? "baseline" : "optimized", environment: await view.send("Browser.getVersion"), operations: {} };
  await reset(view);
  await click(view, "#toggle"); await settle(view);
  result.operations.sidebarClose = await counts(view);
  await reset(view);
  await click(view, "#toggle"); await settle(view);
  result.operations.sidebarOpen = await counts(view);
  await reset(view);
  await click(view, "#switch-B"); await settle(view);
  await click(view, "#switch-A"); await settle(view);
  result.operations.switchBA = await counts(view);
  await reset(view);
  await pointer(view, "pointerdown", 30, 60, "#drag-B");
  await view.cdp.evaluate(`(async () => {
    for (let burst = 0; burst < 5; burst++) {
      await new Promise(resolve => requestAnimationFrame(() => {
        for (let i = 0; i < 12; i++) __perfAPI.pointer('pointermove', 400 + burst * 30 + i, 250);
        resolve();
      }));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
    }
  })()`);
  assert.deepEqual(await view.cdp.evaluate("({x:__perf.drag.pointerX,y:__perf.drag.pointerY})"), { x: 531, y: 250 });
  await pointer(view, "pointerup", 1400, 300);
  await settle(view);
  result.operations.drag60Moves = await counts(view);
  assert.deepEqual(await view.cdp.evaluate("__perf.drops"), [["B", "A", "right"]]);
  assert.deepEqual(await view.cdp.evaluate("[__perfAPI.consume(), __perfAPI.consume()]"), [true, false]);
  assert.equal(await view.cdp.evaluate("document.body.classList.contains('is-dragging-session')"), false);

  // Input reaches the synthetic native terminal_write and echoes through real xterm.
  await view.cdp.evaluate("document.querySelector('.terminal-pane.is-onstage .xterm-helper-textarea').focus()");
  await view.send("Input.insertText", { text: "perf-input-alive" });
  await waitFor(view, "__productionQA.writes.some(w => w.sessionId === 'A-pty' && new TextDecoder().decode(new Uint8Array(w.bytes)).includes('perf-input-alive'))");
  assert.deepEqual(await view.cdp.evaluate(`({ creates:__productionQA.creates,
    connected:__originalTerminals.every(el => el.isConnected),
    same:__originalTerminals.every((el,i) => el === document.querySelectorAll('.xterm')[i]),
    closes:__productionQA.calls.filter(c => /^(terminal_close|terminal_close_tab|terminal_detach)$/.test(c.command)).length,
    errors:__productionQA.errors })`), { creates: 3, connected: true, same: true, closes: 0, errors: [] });
  if (!baseline) {
    assert.deepEqual(result.operations.sidebarClose.terminals, { A: 0, B: 0, C: 0 });
    assert.deepEqual(result.operations.sidebarOpen.terminals, { A: 0, B: 0, C: 0 });
    assert.deepEqual(result.operations.switchBA.terminals, { A: 2, B: 2, C: 0 });
    assert.deepEqual(result.operations.drag60Moves.terminals, { A: 0, B: 0, C: 0 });
    assert.equal(result.operations.drag60Moves.dragCommits, 5);
    assert.equal(result.operations.drag60Moves.bodyClassMutations, 2);
  }
  t.diagnostic(JSON.stringify(result));
  if (process.env.PERF_REPORT) await writeFile(process.env.PERF_REPORT, JSON.stringify(result, null, 2) + "\n");
});

test("drag final coordinates, threshold, cancellation, latest target, unmount cleanup", { timeout: 90_000, skip: baseline }, async (t) => {
  const view = await fixture(t);
  await view.cdp.evaluate(`window.__gestureListeners = Object.fromEntries(['pointermove','pointerup','pointercancel'].map(type => [type,new Set()]));
    const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
    document.addEventListener = (type, listener, options) => { __gestureListeners[type]?.add(listener); add(type,listener,options); };
    document.removeEventListener = (type, listener, options) => { __gestureListeners[type]?.delete(listener); remove(type,listener,options); };`);
  const listeners = () => view.cdp.evaluate("Object.values(__gestureListeners).map(set => set.size)");
  // A click / movement below 5px does not drag; right mouse button is ignored.
  await pointer(view, "pointerdown", 30, 60, "#drag-B");
  await pointer(view, "pointermove", 32, 62); await pointer(view, "pointerup", 32, 62);
  assert.deepEqual(await view.cdp.evaluate("[__perf.drops.length,__perfAPI.consume()]"), [0, false]);
  await pointer(view, "pointerdown", 30, 60, "#drag-B", 2);
  await pointer(view, "pointermove", 500, 250); await pointer(view, "pointerup", 500, 250);
  assert.equal(await view.cdp.evaluate("__perf.drops.length"), 0);

  // Up arrives before the first RAF. Its location, not the queued move, wins.
  await view.cdp.evaluate(`__perfAPI.pointer('pointerdown',30,60,'#drag-B');
    __perfAPI.pointer('pointermove',300,250); __perfAPI.pointer('pointerup',1400,300);`);
  await settle(view);
  assert.deepEqual(await view.cdp.evaluate("__perf.drops"), [["B", "A", "right"]]);
  assert.equal(await view.cdp.evaluate("__perf.drag"), null);
  assert.deepEqual(await view.cdp.evaluate("[__perfAPI.consume(),__perfAPI.consume()]"), [true, false]);

  // Cancel a queued frame and an already visible drag; neither may drop/eject.
  await reset(view);
  for (const visible of [false, true]) {
    await view.cdp.evaluate(`__perfAPI.pointer('pointerdown',30,60,'#drag-B'); __perfAPI.pointer('pointermove',500,250); ${visible ? '' : "__perfAPI.pointer('pointercancel',500,250);"}`);
    if (visible) { await settle(view); await pointer(view, "pointercancel", 500, 250); }
    await settle(view);
    assert.deepEqual(await view.cdp.evaluate("[__perf.drag,__perf.drops.length,__perf.ejects.length,__perfAPI.consume(),document.body.classList.contains('is-dragging-session')]"), [null, 0, 0, false, false]);
    assert.deepEqual(await listeners(), [0, 0, 0]);
  }

  // Pane-origin drag can eject; sidebar-origin cannot, even after crossing 5px.
  await view.cdp.evaluate(`__perfAPI.pointer('pointerdown',500,60,'.terminal-pane.is-onstage .terminal-pane__bar');
    __perfAPI.pointer('pointermove',700,250); __perfAPI.pointer('pointerup',30,100);`);
  assert.deepEqual(await view.cdp.evaluate("__perf.ejects"), ["A"]);
  await reset(view);
  await view.cdp.evaluate(`__perfAPI.pointer('pointerdown',30,60,'#drag-B');
    __perfAPI.pointer('pointermove',500,250); __perfAPI.pointer('pointerup',30,100);`);
  assert.deepEqual(await view.cdp.evaluate("__perf.ejects"), []);
  await reset(view);
  await view.cdp.evaluate(`__perf.canEject = false; __perfAPI.pointer('pointerdown',500,60,'.terminal-pane.is-onstage .terminal-pane__bar');
    __perfAPI.pointer('pointermove',700,250); __perfAPI.pointer('pointerup',30,100);`);
  assert.deepEqual(await view.cdp.evaluate("__perf.ejects"), []);
  await view.cdp.evaluate("__perf.canEject = true");

  // A new start replaces the previous document listeners, not duplicates them.
  await reset(view);
  await view.cdp.evaluate(`__perfAPI.pointer('pointerdown',30,60,'#drag-B'); __perfAPI.pointer('pointermove',500,250);
    __perfAPI.pointer('pointerdown',30,60,'#drag-C'); __perfAPI.pointer('pointermove',510,250);`);
  assert.deepEqual(await listeners(), [1, 1, 1]);
  await pointer(view, 'pointerup', 1400, 300);
  assert.deepEqual(await view.cdp.evaluate("__perf.drops"), [["C", "A", "right"]]);
  // Panes are read through the latest ref after a session switch during a drag.
  await reset(view);
  await pointer(view, "pointerdown", 30, 60, "#drag-C");
  await pointer(view, "pointermove", 500, 250);
  await view.cdp.evaluate("document.querySelector('#switch-B').click()");
  await settle(view);
  await pointer(view, "pointerup", 1400, 300);
  assert.deepEqual(await view.cdp.evaluate("__perf.drops"), [["C", "B", "right"]]);

  await reset(view);
  await view.cdp.evaluate(`__perfAPI.pointer('pointerdown',30,60,'#drag-C'); __perfAPI.pointer('pointermove',500,250);`);
  await settle(view);
  await view.cdp.evaluate(`__perfAPI.pointer('pointermove',510,250); __perfAPI.unmount();`);
  assert.deepEqual(await listeners(), [0, 0, 0], 'unmount must remove listeners before any further event');
  await view.cdp.evaluate(`__perfAPI.pointer('pointermove',520,250); __perfAPI.pointer('pointerup',1400,300);`);
  await settle(view);
  assert.deepEqual(await view.cdp.evaluate("[__perf.drops.length,__perf.ejects.length,document.body.classList.contains('is-dragging-session'),__productionQA.errors]"), [0, 0, false, []]);
});

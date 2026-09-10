import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { BrowserClipboard } from "../../src-tauri/src/plugins/node/browser-clipboard.mjs";
import { BrowserProcess } from "../../src-tauri/src/plugins/node/browser-process.mjs";
import { BrowserTarget } from "../../src-tauri/src/plugins/node/browser-target.mjs";
import { browserInput } from "../../src-tauri/src/plugins/node/browser-input.mjs";
import { browserAvailable } from "./panel-support.mjs";
import { cleanupScope, temporary } from "./support.mjs";

const COPY = { kind: "key", type: "keyDown", key: "c", modifiers: 4 };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function expiredTarget(reason, target) {
  if (reason === "navigation") target.generation++;
  if (reason === "revoked") target.options.active = () => false;
  if (reason === "closed") target.closed = true;
  if (reason === "hidden") target.visible = false;
}

test("stale clipboard requests never dispatch or write after initialization", async (t) => {
  for (const reason of ["navigation", "revoked", "closed", "hidden"]) await t.test(reason, async () => {
    const entered = deferred(), ready = deferred(), calls = [];
    const clipboard = new BrowserClipboard({});
    clipboard.ready = () => { entered.resolve(); return ready.promise; };
    const target = { generation: 0, visible: true, options: { writeClipboard: () => calls.push("write") } };
    const pending = clipboard.copy(target, async () => calls.push("dispatch"));
    await entered.promise;
    expiredTarget(reason, target); ready.resolve({ send: async () => calls.push("read") });
    await pending;
    assert.deepEqual([], calls);
  });
});

test("navigation and revocation discard clipboard results that arrive after copying", async (t) => {
  for (const reason of ["navigation", "revoked", "closed", "hidden"]) await t.test(reason, async () => {
    const entered = deferred(), released = deferred(), writes = [];
    const clipboard = new BrowserClipboard({});
    clipboard.ready = async () => ({ send: async () => ({ result: { value: { text: "stale text" } } }) });
    const target = { generation: 0, visible: true, options: { writeClipboard: (text) => writes.push(text) } };
    const pending = clipboard.copy(target, async () => { entered.resolve(); await released.promise; });
    await entered.promise;
    expiredTarget(reason, target); released.resolve(); await pending;
    assert.deepEqual([], writes);
  });
});

async function liveTargets(t, names) {
  const lifetime = cleanupScope(t);
  const root = await temporary(lifetime), writes = [], targets = [];
  for (const name of names) await writeFile(join(root, `${name}.html`), `<!doctype html><input value="${name}">`);
  const process = await new BrowserProcess(join(root, "engine")).start();
  lifetime.after(() => process.close());
  for (const name of names) {
    const target = await new BrowserTarget(process, { workspace: root, frame: () => {}, state: () => {},
      writeClipboard: async (text) => writes.push({ name, text }) }).start();
    lifetime.after(() => target.close());
    await target.navigate({ path: `${name}.html` }); await target.visibility(true);
    await target.cdp.evaluate("document.querySelector('input').select();true");
    targets.push(target);
  }
  return { targets, writes };
}

test("concurrent browser copies keep each target's payload separate", async (t) => {
  if (!await browserAvailable(t)) return;
  const { targets, writes } = await liveTargets(t, ["first", "second"]);
  await Promise.all(targets.map((target) => browserInput(target, COPY)));
  assert.deepEqual([{ name: "first", text: "first" }, { name: "second", text: "second" }], writes);
});

test("oversized browser copies fail without overwriting the desktop or disconnecting the engine", async (t) => {
  if (!await browserAvailable(t)) return;
  const { targets: [target], writes } = await liveTargets(t, ["bounded"]);
  await target.cdp.evaluate("(()=>{const input=document.querySelector('input');input.value='中'.repeat(200000);input.select();return true})()");
  await assert.rejects(browserInput(target, COPY), { code: "LIMIT_EXCEEDED" });
  assert.deepEqual([], writes);
  await target.cdp.evaluate("(()=>{const input=document.querySelector('input');input.value='recovered';input.select();return true})()");
  await browserInput(target, COPY);
  assert.deepEqual([{ name: "bounded", text: "recovered" }], writes);
});

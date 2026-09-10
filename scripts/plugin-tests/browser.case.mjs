import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { cleanupScope, temporary } from "./support.mjs";
import { PluginBrowser } from "../../src-tauri/src/plugins/node/browser.mjs";
import { BrowserPreview } from "../../src-tauri/src/plugins/node/browser-preview.mjs";

test("PI browser APIs operate a real isolated guest and keep workspace sessions separate", async (t) => {
  const lifetime = cleanupScope(t);
  const root = await temporary(lifetime), workspace = join(root, "workspace"); await mkdir(workspace);
  await writeFile(join(workspace, "index.html"), '<!doctype html><title>Plugin Browser QA</title><label>Name<input aria-label="Name"></label><button onclick="document.title=document.querySelector(\'input\').value">Apply</button><script>console.log("fixture ready")</script>');
  const context = { workspace, sessionId: "first" }, browser = new PluginBrowser({ base: root, context: () => context, platform: async () => null });
  lifetime.after(() => browser.close());
  const entry = { manifest: { id: "mine.browser", permissions: ["browser.cdp"] }, abort: new AbortController() };
  const call = (api, input, current = context) => browser.call(entry, { api: `browser.${api}`, input }, current);
  const state = await call("navigate", { path: "index.html" });
  assert.equal(state.title, "Plugin Browser QA");
  const snapshot = await call("snapshot");
  const uid = snapshot.tree.match(/- (e\d+) textbox "Name"/)?.[1]; assert.ok(uid, snapshot.tree);
  await call("fill", { uid, text: "Filled through PI" });
  const button = snapshot.tree.match(/- (e\d+) button "Apply"/)?.[1];
  await call("click", { uid: button });
  assert.equal(await call("evaluate", { expression: "document.title" }), "Filled through PI");
  assert.ok((await call("console")).messages.some((message) => message.text.includes("fixture ready")));
  const shot = await call("screenshot"); assert.equal(shot.mimeType, "image/jpeg"); assert.ok(shot.data.length > 100);
  await assert.rejects(call("cdp", { method: "Browser.close" }), { code: "PERMISSION_DENIED" });
  await assert.rejects(call("navigate", { path: "../outside.html" }), { code: "PERMISSION_DENIED" });
  assert.equal((await call("getState", undefined, { ...context, sessionId: "second" })), null);
  await browser.revoke("first");
  assert.equal(await call("getState"), null);
});

test("workspace-relative browser URLs resolve files and keep the preview inside the workspace", async (t) => {
  const lifetime = cleanupScope(t);
  const root = await temporary(lifetime); await writeFile(join(root, "index.html"), "<title>Local</title>");
  const preview = new BrowserPreview(root, async () => {}); lifetime.after(() => preview.close());
  const url = await preview.target({ url: "index.html" });
  assert.match(url, /^http:\/\/127\.0\.0\.1:/);
  assert.equal(await (await fetch(url)).text(), "<title>Local</title>");
  assert.equal(await preview.target({ url: "https://example.com" }), "https://example.com/");
});

test("a crashed browser releases stale targets and restarts on the next navigation", async (t) => {
  const lifetime = cleanupScope(t);
  const root = await temporary(lifetime), context = { workspace: root, sessionId: "restart" };
  await writeFile(join(root, "index.html"), "<title>Recovered</title>");
  const browser = new PluginBrowser({ base: root, context: () => context, platform: async () => null });
  lifetime.after(() => browser.close());
  const entry = { manifest: { id: "mine.restart", permissions: ["browser.cdp"] }, abort: new AbortController() };
  const navigate = () => browser.call(entry, { api: "browser.navigate", input: { path: "index.html" } }, context);
  await navigate();
  const original = await browser.target(entry, context); lifetime.after(() => original.close());
  const engine = await browser.starting;
  engine.child.kill("SIGKILL"); await engine.exited;
  assert.equal((await navigate()).title, "Recovered");
  assert.notEqual((await browser.starting).child.pid, engine.child.pid);
});

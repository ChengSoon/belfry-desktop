import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { cleanupScope, temporary } from "./support.mjs";
import { PluginBrowser } from "../../src-tauri/src/plugins/node/browser.mjs";
import { BrowserPreview } from "../../src-tauri/src/plugins/node/browser-preview.mjs";
import { terminate } from "../../src-tauri/src/plugins/node/process-tree.mjs";
import { click } from "./market-ui-support.mjs";

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

test("fixture click reaches its target after a delayed focus restoration scrolls the page", async t => {
  const lifetime = cleanupScope(t), root = await temporary(lifetime);
  await writeFile(join(root, "index.html"), `<!doctype html><style>
    body { margin:0; height:2200px } button { position:absolute; left:16px; width:100px; height:40px }
    #reset { top:16px } #editor { top:1600px }
    </style><button id="reset">Reset</button><button id="editor">Editor</button><script>
    window.clicked=[]; window.restored=false;
    document.addEventListener('click', event => clicked.push(event.target.id));
    window.addEventListener('scroll', () => {
      if (!restored && scrollY === 0) { restored=true; requestAnimationFrame(() => document.querySelector('#editor').focus()); }
    });
    window.scrollTo(0,900);
    </script>`);
  const context = { workspace:root, sessionId:"focus-scroll" };
  const browser = new PluginBrowser({ base:root, context:() => context, platform:async () => null });
  lifetime.after(() => browser.close());
  const entry = { manifest:{ id:"mine.focus-scroll", permissions:["browser.cdp"] }, abort:new AbortController() };
  await browser.call(entry, { api:"browser.navigate", input:{path:"index.html"} }, context);
  const view = await browser.target(entry, context);
  await view.bounds({x:0,y:0,width:720,height:480});
  await view.cdp.evaluate("window.scrollTo(0,900); true");
  await click(view, "#reset");
  assert.deepEqual(await view.cdp.evaluate("({restored,clicked})"), {restored:true,clicked:["reset"]});
});

test("local preview reloads changed page resources without discarding input for unrelated directory events", async (t) => {
  const lifetime = cleanupScope(t), root = await temporary(lifetime);
  await writeFile(join(root, "index.html"), '<title>Local</title><link rel="stylesheet" href="style.css">');
  await writeFile(join(root, "style.css"), "body { color: red; }");
  let reloads = 0;
  const preview = new BrowserPreview(root, async () => { reloads++; });
  lifetime.after(() => preview.close());
  const url = await preview.target({ path: "index.html" });
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(new URL("style.css", url))).status, 200);
  assert.equal((await fetch(new URL("generated.js", url))).status, 404);
  await mkdir(join(root, "upload"));
  await writeFile(join(root, "upload", "note.txt"), "upload only");
  await writeFile(join(root, "unrelated.txt"), "not a page resource");
  // A watcher notification alone is not evidence that a displayed resource changed.
  preview.watcher.emit("change", "change", "index.html");
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(reloads, 0, "unrelated/metadata notifications must preserve the current document");
  await writeFile(join(root, "style.css"), "body { color: blue; }");
  await waitForReloads(() => reloads, 1);
  await writeFile(join(root, "index.html"), "<title>Updated page</title>");
  await waitForReloads(() => reloads, 2);
  await writeFile(join(root, "generated.js"), "console.log('build ready');");
  await waitForReloads(() => reloads, 3);
  preview.watcher.emit("change", "change", "index.html");
  await preview.target({ url: "https://example.com" });
  await writeFile(join(root, "index.html"), "<title>Inactive preview</title>");
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(reloads, 3, "an inactive preview must not reload an external page");
});

async function waitForReloads(count, expected) {
  const deadline = Date.now() + 5_000;
  while (count() < expected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(count(), expected);
}

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
  const closed = once(engine.child, "close");
  // Windows 的 Chrome 子进程会继承调试管道；只杀主进程会让测试 worker 永远等不到管道关闭。
  terminate(engine.child, "SIGKILL"); await engine.exited;
  // exit 只表示主进程退出；close 才能确认子进程继承的管道也已释放。
  await closed;
  assert.equal((await navigate()).title, "Recovered");
  assert.notEqual((await browser.starting).child.pid, engine.child.pid);
});

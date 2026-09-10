import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanupScope, host, plugin, temporary } from "./support.mjs";
import { BrowserProcess, browserExecutable } from "../../src-tauri/src/plugins/node/browser-process.mjs";
import { BrowserTarget } from "../../src-tauri/src/plugins/node/browser-target.mjs";

export async function panelFixture(t, { body = "", manifest, platform } = {}) {
  const lifetime = cleanupScope(t);
  const root = await temporary(lifetime), workspace = join(root, "workspace"); await mkdir(workspace);
  const selected = join(workspace, "large.txt"), text = "文件内容:" + "a".repeat(5 * 1024 * 1024);
  await writeFile(selected, text);
  const entry = await plugin(root, "mine.panel-qa", { code: "module.exports = {};", manifest: {
    permissions: ["ui.view", "fs.read", "browser.cdp"], fs: { read: { root: "userSelected" } },
    contributes: { views: [{ id: "qa", title: "QA", entry: "index.html" }] }, ...manifest,
  } });
  await writeFile(join(entry.path, "index.html"), `<!doctype html><html><head><title>Panel QA</title></head><body>${body}</body></html>`);
  const runtime = await host(lifetime, root, { platform: (message) =>
    platform?.({ ...message, selected }) ?? (message.api === "fs.pickFiles" ? [selected] : null) });
  await runtime.call("context", { workspace, theme: "dark" }); await runtime.call("load", entry);
  const surface = await runtime.call("surface", { pluginId: entry.manifest.id, viewId: "qa" });
  const process = await new BrowserProcess(join(root, "test-view")).start();
  lifetime.after(() => process.close());
  const view = await new BrowserTarget(process, { workspace, frame: () => {}, state: () => {} }).start();
  lifetime.after(() => view.close());
  await view.navigate({ url: surface.url });
  return { view, runtime, workspace, text, entry, selected };
}

export async function browserAvailable(t) {
  try { await browserExecutable(); return true; }
  catch (error) { if (process.env.BELFRY_REQUIRE_BROWSER_TESTS === "1") throw error; t.skip(error.message); return false; }
}

export async function showGuest(view, path = "guest.html") {
  return view.cdp.evaluate(`(async () => {
    await pluginBridge.invoke('browser.navigate',{path:${JSON.stringify(path)}});
    await pluginBridge.invoke('browser.setBounds',{x:0,y:80,width:500,height:300});
    await pluginBridge.invoke('browser.setVisible',{visible:true});
    return await new Promise(resolve=>{
      const image=document.querySelector('[role=application] img');
      if(image.complete&&image.naturalWidth)resolve(true); else image.addEventListener('load',()=>resolve(image.naturalWidth>0),{once:true});
    });
  })()`);
}

export async function clickGuest(view) {
  for (const type of ["mousePressed", "mouseReleased"]) {
    await view.send("Input.dispatchMouseEvent", { type, x: 60, y: 115, button: "left", clickCount: 1 });
  }
}

export function guestValue(view, expression) {
  return view.cdp.evaluate(`pluginBridge.invoke('browser.evaluate',{expression:${JSON.stringify(expression)}})`);
}

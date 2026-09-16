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

// 画面帧迟迟不来时返回现场而不是空等：CDP 的 20s 兜底只会报一句 Runtime.evaluate 超时，看不出卡在哪。
// 分次轮询而不是在一次 evaluate 里长等：单次调用远低于 CDP 上限，诊断信息得以保留，
// 总时长又能覆盖 Windows CI 冷启动首帧（各文件第一个用例要新建引擎和 profile，最慢）。
const GUEST_FRAME_TIMEOUT = 40_000, GUEST_FRAME_INTERVAL = 250;

export async function showGuest(view, path = "guest.html") {
  await view.cdp.evaluate(`(async () => {
    await pluginBridge.invoke('browser.navigate',{path:${JSON.stringify(path)}});
    await pluginBridge.invoke('browser.setBounds',{x:0,y:80,width:500,height:300});
    await pluginBridge.invoke('browser.setVisible',{visible:true});
  })()`);
  const deadline = Date.now() + GUEST_FRAME_TIMEOUT;
  for (;;) {
    const state = await view.cdp.evaluate(`(() => {
      const image=document.querySelector('[role=application] img');
      return { painted: !!(image.complete&&image.naturalWidth), complete: image.complete,
        naturalWidth: image.naturalWidth, src:String(image.getAttribute('src')||'').slice(0,48) };
    })()`);
    if (state.painted) return true;
    if (Date.now() >= deadline) return { frameTimeout: GUEST_FRAME_TIMEOUT, ...state };
    await new Promise((resolve) => setTimeout(resolve, GUEST_FRAME_INTERVAL));
  }
}

export async function clickGuest(view) {
  for (const type of ["mousePressed", "mouseReleased"]) {
    await view.send("Input.dispatchMouseEvent", { type, x: 60, y: 115, button: "left", clickCount: 1 });
  }
}

export function guestValue(view, expression) {
  return view.cdp.evaluate(`pluginBridge.invoke('browser.evaluate',{expression:${JSON.stringify(expression)}})`);
}

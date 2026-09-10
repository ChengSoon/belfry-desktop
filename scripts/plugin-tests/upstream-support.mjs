import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanupScope, host, temporary } from "./support.mjs";
import { BrowserProcess } from "../../src-tauri/src/plugins/node/browser-process.mjs";
import { BrowserTarget } from "../../src-tauri/src/plugins/node/browser-target.mjs";

export function upstreamPath(t, name) {
  const root = process.env.BELFRY_PI_SOURCE;
  if (!root) { t.skip("设置 BELFRY_PI_SOURCE 为固定版本 PI 源码和 market-fixtures 的目录后执行原版互操作验收"); return null; }
  return join(root, name === "pi.browser" ? "apps/desktop/resources/plugins/pi.browser" : `market-fixtures/${name}`);
}
export async function originalPlugin(t, { path, prepare, platform }) {
  const lifetime = cleanupScope(t);
  const root = await temporary(lifetime), workspace = join(root, "workspace"); await mkdir(workspace);
  await prepare?.(workspace);
  const events = [];
  const runtime = await host(lifetime, root, { event: (event) => events.push(event), platform: (message) => message.api === "ui.openPanel" ? message : platform?.(message) ?? null });
  const manifest = JSON.parse(await readFile(join(path, "manifest.json"), "utf8")), entry = { path, manifest };
  await runtime.call("context", { workspace, sessionId: "interop", locale: "zh-CN", theme: "dark" });
  await runtime.call("load", entry);
  const viewId = manifest.contributes?.views?.[0]?.id;
  const surface = await runtime.call(viewId ? "surface" : "panel", { pluginId: manifest.id, viewId });
  const engine = await new BrowserProcess(join(root, "page-browser")).start();
  lifetime.after(() => engine.close());
  const view = await new BrowserTarget(engine, { workspace, frame: () => {}, state: () => {} }).start();
  lifetime.after(() => view.close());
  await view.navigate({ url: surface.url });
  return { root, workspace, runtime, view, entry, surface, events };
}
export function pageReady(view, expression) {
  return view.cdp.evaluate(`new Promise(resolve => {
    const end = Date.now() + 3000;
    const check = () => { const ready = Boolean(${expression}); if (ready || Date.now() > end) resolve(ready); else setTimeout(check, 25); };
    check();
  })`);
}
export async function capturePage(view, name) {
  const directory = process.env.BELFRY_PI_ARTIFACTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const screenshot = await view.cdp.screenshot();
  await writeFile(join(directory, `${name}.jpg`), Buffer.from(screenshot.data, "base64"));
}

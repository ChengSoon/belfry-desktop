import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { join } from "node:path";
import { cleanupScope, temporary } from "../../../../scripts/plugin-tests/support.mjs";
import { BrowserProcess } from "../../../../src-tauri/src/plugins/node/browser-process.mjs";
import { BrowserTarget } from "../../../../src-tauri/src/plugins/node/browser-target.mjs";
export { click, press, waitFor } from "../../../../scripts/plugin-tests/market-ui-support.mjs";
export { capturePanel } from "./panelArtifacts.mjs";

/** 独立端口、临时浏览器配置与进程；不会连接正式 Belfry 或已有浏览器。 */
export async function browserFixture(t, page, options = {}) {
  const lifetime = cleanupScope(t), root = await temporary(lifetime), requests = [];
  const server = await createServer({ configFile: false, logLevel: "silent", cacheDir: join(root, "vite-cache"),
    plugins: [react(), { name: "optional-panel-qa", configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        requests.push(request.url);
        if (options.handle?.(request, response)) return;
        next();
      });
    } }], server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
  });
  lifetime.after(() => server.close());
  await server.listen();
  const browser = await new BrowserProcess(join(root, "browser")).start();
  lifetime.after(() => browser.close());
  const view = await new BrowserTarget(browser, { workspace: root, frame: () => {}, state: () => {} }).start();
  lifetime.after(() => view.close());
  await view.bounds({ x: 0, y: 0, width: 1080, height: 700 });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await view.navigate({ url: `${origin}/${page}` });
  return { view, requests, origin, root };
}

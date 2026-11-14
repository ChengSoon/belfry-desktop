import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { mkdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { prepareRuntime } from "../../plugins/playwriter/runtime.mjs";
import { readDirectory } from "../../src-tauri/src/plugins/node/directory.mjs";
import { cleanupScope, host, temporary, waitFor } from "../plugin-tests/support.mjs";
import { isolatedPlugin, isolatedExtension } from "./support.mjs";

test("real Playwriter extension drives browser through Belfry tools and panel", { timeout: 90_000 }, async t => {
  const cleanup = cleanupScope(t), root = await temporary(cleanup);
  const engine = await prepareRuntime(join(root, "engine"));
  const { chromium } = createRequire(join(engine, "node_modules/playwriter/package.json"))("@xmorse/playwright-core");
  const runtime = await host(cleanup, root, { platform: request => request.api === "ui.openPanel" ? request : null });
  const { plugin, port } = await isolatedPlugin(root);
  await runtime.call("context", { workspace: root, sessionId: "browser-e2e", theme: "light" });
  await runtime.call("load", { path: plugin.root, manifest: plugin.manifest, development: false });
  const tool = (name, args = {}, sessionId = "browser-e2e") => runtime.call("tool", { pluginId: plugin.manifest.id,
    name, args, context: { workspace: root, sessionId } });
  const status = async () => JSON.parse((await tool("playwriter_status")).content[0].text);
  assert.ok(await waitFor(async () => {
    const value = await status(); assert.notEqual(value.phase, "error", value.lastError); return value.phase === "ready";
  }));
  const fixture = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end('<!doctype html><title>Browser fixture</title><h1>浏览器联调</h1><label>名称<input aria-label="名称"></label><button>保存</button><output></output><script>document.querySelector("button").onclick=()=>document.querySelector("output").textContent="已保存："+document.querySelector("input").value</script>');
  });
  await new Promise(done => fixture.listen(0, "127.0.0.1", done));
  cleanup.after(() => { fixture.closeAllConnections(); fixture.close(); });
  const url = `http://127.0.0.1:${fixture.address().port}/`;
  let executablePath = process.env.BELFRY_PLAYWRITER_TEST_CHROME;
  if (!executablePath && process.platform === "darwin") executablePath = join(homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
  if (executablePath) await access(executablePath);
  const extensionPath = await isolatedExtension(engine, root, port);
  const browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath, channel: executablePath ? undefined : "chromium",
    headless: true, viewport: { width: 900, height: 760 }, ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  cleanup.after(() => browser.close());
  const page = await browser.newPage(); await page.goto(url); await page.bringToFront();
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent("serviceworker");
  // The official extension exposes the same handler its toolbar button invokes.
  await worker.evaluate(async () => { await globalThis.toggleExtensionForActiveTab(); });
  assert.ok(await waitFor(async () => (await status()).extensions.length === 1));
  const execute = async (code, sessionId) => {
    const result = await tool("playwriter_execute", { code }, sessionId);
    assert.ok(!result.isError, result.content.map(item => item.text ?? "image").join("\n"));
    return result;
  };
  await execute(`state.page = context.pages().find(p => p.url() === ${JSON.stringify(url)}); state.owner = 'one'; console.log(await state.page.title())`);
  await execute("await state.page.getByRole('textbox', {name:'名称'}).fill('Belfry'); await state.page.getByRole('button', {name:'保存'}).click()");
  assert.match((await execute("console.log(await state.page.locator('output').textContent())")).content[0].text, /已保存：Belfry/);
  assert.match((await execute("console.log(await snapshot({page:state.page}))")).content[0].text, /浏览器联调/);
  assert.match((await execute("console.log(state.owner ?? 'isolated')", "agent-two")).content[0].text, /isolated/);
  assert.match((await execute("console.log(state.owner)")).content[0].text, /one/);
  const screenshot = await execute("await screenshotWithAccessibilityLabels({page:state.page})");
  assert.ok(screenshot.content.some(item => item.type === "image"));
  assert.match(screenshot.content[0].text, /截图：/);
  const panel = await runtime.call("panel", { pluginId: plugin.manifest.id });
  const ui = await browser.newPage(); await ui.goto(panel.url);
  await ui.getByText("已连接", { exact: true }).waitFor();
  await ui.getByRole("button", { name: "测试连接", exact: true }).click();
  await ui.getByText("连接测试通过。网页读取、输入和点击均正常，可以向 Agent 下任务了。").waitFor({ timeout: 15_000 });
  const evidence = resolve("tmp/playwriter-plugin-review"); await mkdir(evidence, { recursive: true });
  await ui.screenshot({ path: join(evidence, "light.png"), fullPage: true });
  await ui.setViewportSize({ width: 390, height: 820 });
  await ui.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  assert.ok(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ui.screenshot({ path: join(evidence, "dark-mobile.png"), fullPage: true });
  await tool("playwriter_reset");
  assert.equal(page.isClosed(), false);
  assert.match((await execute("console.log(state.owner ?? 'reset')")).content[0].text, /reset/);
  await runtime.call("unload", { pluginId: plugin.manifest.id });
  assert.equal((await runtime.call("catalog")).tools.filter(item => item.pluginId === plugin.manifest.id).length, 0);
  assert.equal((await readDirectory(plugin.root)).digest, plugin.digest, "browser operations must not write artifacts into the installed plugin");
  t.diagnostic(`Browser evidence: ${evidence}`);
});

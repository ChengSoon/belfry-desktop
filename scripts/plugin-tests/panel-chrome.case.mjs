import assert from "node:assert/strict";
import test from "node:test";
import { browserAvailable, panelFixture } from "./panel-support.mjs";

const TITLEBAR_HEIGHT = 46, TITLEBAR_POINT = { x: 240, y: TITLEBAR_HEIGHT / 2 };
const CONTROLS = [["关闭", "close"], ["最小化", "minimize"], ["最大化 / 还原", "toggleMaximize"]];

async function fixture(t, { mode = "legacy", embedded = false, body = "" } = {}) {
  const actions = [];
  const panel = await panelFixture(t, {
    body: `${mode === "legacy" ? "" : `<meta name="pi-plugin-chrome" content="${mode}">`}${body}`,
    manifest: { permissions: ["ui.view", "ui.panel", "fs.read", "browser.cdp"], ui: { panel: "index.html" } },
    platform: (message) => {
      const { api, args } = message;
      if (api === "ui.openPanel") return message;
      if (api !== "ui.windowControl") return null;
      actions.push(args[0].action);
      return { maximized: args[0].action === "toggleMaximize" };
    },
  });
  if (!embedded) {
    const surface = await panel.runtime.call("panel", { pluginId: panel.entry.manifest.id });
    await panel.view.navigate({ url: surface.url });
  }
  // 保留真实请求，只记录完成状态，避免异步宿主响应掩盖多余的拖拽动作。
  await panel.view.cdp.evaluate(`(() => {
    const request = window.fetch.bind(window);
    window.__qaWindowRequests = [];
    window.fetch = (url, options) => {
      const response = request(url, options);
      if (options?.body && JSON.parse(options.body).api === 'ui.windowControl') {
        window.__qaWindowRequests.push(response.then(value => value.clone().json()));
      }
      return response;
    };
  })()`);
  return { ...panel, actions };
}

async function settle(view) {
  const responses = await view.cdp.evaluate("Promise.all(window.__qaWindowRequests.splice(0))");
  for (const response of responses) assert.equal(true, response.ok, JSON.stringify(response));
}

async function clickButton(view, label) {
  const { tree } = await view.cdp.snapshot();
  const line = tree.split("\n").find((item) => item.includes(`button ${JSON.stringify(label)}`));
  const uid = line?.match(/\be\d+\b/)?.[0];
  assert.ok(uid, `缺少按钮：${label}\n${tree}`);
  await view.cdp.click({ uid });
  await settle(view);
}

async function clickAt(view, point, { button = "left", clickCount = 1 } = {}) {
  for (const type of ["mousePressed", "mouseReleased"]) {
    await view.send("Input.dispatchMouseEvent", { type, ...point, button, clickCount });
  }
  await settle(view);
}

for (const mode of ["legacy", "v2", "v3"]) {
  test(`${mode} panel window buttons send only their own action without starting a drag`, async (t) => {
    if (!await browserAvailable(t)) return;
    const { view, actions } = await fixture(t, { mode });
    for (const [label, action] of CONTROLS) {
      await clickButton(view, label);
      assert.deepEqual([action], actions.splice(0), `${label}不能触发窗口拖拽`);
    }
  });
}

test("panel titlebar still drags and double-clicks while content and right-clicks do not drag", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view, actions } = await fixture(t);
  await clickAt(view, TITLEBAR_POINT);
  assert.deepEqual(["drag"], actions.splice(0), "空白标题栏只触发一次拖拽");
  await clickAt(view, TITLEBAR_POINT, { clickCount: 2 });
  assert.deepEqual(["drag", "toggleMaximize"], actions.splice(0));
  await clickAt(view, TITLEBAR_POINT, { button: "right" });
  await clickAt(view, { ...TITLEBAR_POINT, y: TITLEBAR_HEIGHT * 2 });
  assert.deepEqual([], actions);
});

test("paint-through titlebar preserves plugin controls and explicit no-drag regions", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view, actions } = await fixture(t, { mode: "v3", body: `
    <style>body{margin:0}#action,#no-drag{position:fixed;top:8px;height:28px}#action{left:12px}#no-drag{left:100px;width:80px}</style>
    <button id="action" onclick="this.dataset.clicked='true'"><span>插件操作</span></button>
    <div id="no-drag" data-pi-plugin-no-drag><span>不可拖拽</span></div>` });
  await clickButton(view, "插件操作");
  assert.equal("true", await view.cdp.evaluate("document.querySelector('#action').dataset.clicked"));
  await clickAt(view, { x: 140, y: TITLEBAR_POINT.y });
  assert.deepEqual([], actions.splice(0));
  await clickAt(view, TITLEBAR_POINT);
  assert.deepEqual(["drag"], actions);
});

test("embedded plugin views omit window chrome and leave top content clicks alone", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view, actions } = await fixture(t, { embedded: true });
  assert.equal(false, await view.cdp.evaluate("!!document.querySelector('pi-plugin-panel-chrome')"));
  assert.equal("0px", await view.cdp.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--pi-plugin-titlebar-height')"));
  await clickAt(view, TITLEBAR_POINT);
  assert.deepEqual([], actions);
});

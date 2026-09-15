import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { host, plugin, temporary } from "./support.mjs";

async function eventually(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.fail(label);
}
test("development code reloads automatically and disabling cancels further reloads", async (t) => {
  const root = await temporary(t);
  const code = (value) => `module.exports.onLoad = () => pi.commands.register({ id: "version", title: "Version", run: () => ${value} });`;
  const entry = await plugin(root, "local.watch", { code: code(1), manifest: { contributes: { commands: [{ id: "version", title: "Version" }] } } });
  const runtime = await host(t, root);
  await runtime.call("load", { ...entry, development: true });
  await writeFile(join(entry.path, "main.js"), code(2));
  await eventually(async () => {
    try { return await runtime.call("command", { pluginId: entry.manifest.id, commandId: "version" }) === 2; } catch { return false; }
  }, "开发代码未自动重载");
  await runtime.call("unload", { pluginId: entry.manifest.id });
  await writeFile(join(entry.path, "main.js"), code(3));
  assert.deepEqual((await runtime.call("catalog")).plugins, []);
});
test("resident services restart a crashed worker, while disable cancels restart", async (t) => {
  const restartObservationMs = 1000;
  const root = await temporary(t);
  const entry = await plugin(root, "local.restart", { code: `module.exports.onLoad = async () => {
    const settings = await pi.plugin.getSettings(); await pi.plugin.setSettings({ starts: (settings.starts || 0) + 1 });
    pi.services.register({ id: "background", start() {}, stop() {} });
  };`, manifest: { permissions: ["background.service"], contributes: { services: [{ id: "background" }] } } });
  const crashes = [];
  const runtime = await host(t, root, { event: (event) => {
    if (event.name === "error" && event.pluginId === entry.manifest.id) crashes.push(event);
  } });
  // 先完成启动握手，再终止本测试创建的 worker，避免退出定时器抢在 load 之前触发。
  const loaded = await runtime.call("load", entry);
  process.kill(loaded.pid);
  await eventually(async () => {
    try { return (await runtime.call("settings.get", { pluginId: entry.manifest.id })).starts === 2; } catch { return false; }
  }, "服务未重启");
  const restarted = (await runtime.call("catalog")).plugins.find((item) => item.id === entry.manifest.id);
  assert.equal(restarted.status, "ready");
  process.kill(restarted.pid);
  await eventually(() => crashes.length === 2, "宿主未观察到第二次退出");
  await runtime.call("unload", { pluginId: entry.manifest.id });
  await new Promise((resolve) => setTimeout(resolve, restartObservationMs));
  const catalog = await runtime.call("catalog");
  assert.deepEqual(catalog.plugins, []);
  assert.deepEqual(catalog.services, []);
});
test("parallel partial setting writes preserve all submitted keys", async (t) => {
  const root = await temporary(t), entry = await plugin(root, "local.settings", { code: "module.exports = {};" });
  const runtime = await host(t, root); await runtime.call("load", entry);
  await Promise.all(Array.from({ length: 12 }, (_, i) => runtime.call("settings.set", { pluginId: entry.manifest.id, values: { [`key${i}`]: i } })));
  assert.equal(Object.keys(await runtime.call("settings.get", { pluginId: entry.manifest.id })).length, 12);
});

test("unload also terminates subprocesses started by the plugin worker", async (t) => {
  const root = await temporary(t);
  const entry = await plugin(root, "local.children", { code: `const child = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    module.exports.onLoad = () => pi.commands.register({ id: "pid", title: "Pid", run: () => child.pid });`, manifest: { contributes: { commands: [{ id: "pid", title: "Pid" }] } } });
  const runtime = await host(t, root); await runtime.call("load", entry);
  const pid = await runtime.call("command", { pluginId: entry.manifest.id, commandId: "pid" });
  await runtime.call("unload", { pluginId: entry.manifest.id });
  await eventually(async () => { try { process.kill(pid, 0); return false; } catch { return true; } }, "插件子进程未清理");
});

import assert from "node:assert/strict";
import test from "node:test";
import { PluginChild } from "../../src-tauri/src/plugins/node/child.mjs";
import { terminate } from "../../src-tauri/src/plugins/node/process-tree.mjs";
import { plugin, temporary, waitFor } from "./support.mjs";

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

async function worker(t, root, id, code) {
  const entry = await plugin(root, id, { code });
  const child = new PluginChild({ path: entry.path, onHost: () => null, onExit: () => {}, onLog: () => {} });
  t.after(async () => { terminate(child.process, "SIGKILL"); await child.exited; });
  await child.invoke("init", entry, { timeout: 3000 });
  return child;
}

const grandchildCode = 'process.on("SIGTERM", () => {}); console.log(process.pid); setInterval(() => {}, 1000);';
const childCode = `process.on("SIGTERM", () => {}); const child = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchildCode)}], {stdio:["ignore","pipe","ignore"]}); child.stdout.once("data", (data) => console.log(JSON.stringify([process.pid, Number(String(data).trim())]))); setInterval(() => {}, 1000);`;
const resistant = `
  process.on("SIGTERM", () => {});
  const spawn = require("node:child_process").spawn;
  const child = spawn(process.execPath, ["-e", ${JSON.stringify(childCode)}], { stdio: ["ignore", "pipe", "ignore"] });
  let descendants;
  module.exports.onLoad = () => new Promise((resolve) => child.stdout.once("data", (data) => { descendants = JSON.parse(String(data)); resolve(); }));
  module.exports.onPanelInvoke = (channel) => channel === "pids" ? [process.pid, ...descendants] : new Promise(() => {});
`;

test("TIMEOUT force-kills a TERM-resistant worker and its descendants while other plugins keep working", { timeout: 10000 }, async (t) => {
  const root = await temporary(t);
  const hung = await worker(t, root, "local.hung", resistant);
  const pids = await hung.invoke("panel.invoke", { channel: "pids" });
  const healthy = await worker(t, root, "local.healthy", "module.exports.onPanelInvoke = () => 'still working';");
  const started = Date.now();
  await assert.rejects(hung.invoke("panel.invoke", { channel: "hang" }, { timeout: 50 }), { code: "TIMEOUT" });
  assert.equal(await healthy.invoke("panel.invoke", {}), "still working");
  assert.ok(await waitFor(() => pids.every((pid) => !alive(pid)), { timeout: 1800 }), `still alive after TIMEOUT: ${pids.filter(alive)}`);
  assert.ok(Date.now() - started < 2000);
  assert.equal(hung.pending.size, 0);
});

test("cancelled unresponsive calls have a short cleanup grace instead of their original request timeout", { timeout: 10000 }, async (t) => {
  const root = await temporary(t);
  const child = await worker(t, root, "local.cancel-hung", resistant);
  const pids = await child.invoke("panel.invoke", { channel: "pids" });
  const abort = new AbortController();
  const result = child.invoke("panel.invoke", { channel: "hang" }, { timeout: 15000, context: { abort } });
  abort.abort();
  await assert.rejects(result, { code: "CANCELLED" });
  assert.ok(await waitFor(() => pids.every((pid) => !alive(pid)), { timeout: 1800 }), `cancel left live children: ${pids.filter(alive)}`);
  assert.equal(child.pending.size, 0);
});

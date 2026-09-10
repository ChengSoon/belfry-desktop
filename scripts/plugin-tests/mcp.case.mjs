import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import test from "node:test";
import { host, plugin, temporary } from "./support.mjs";

async function request(session, method, { params = {}, headers = {} } = {}) {
  const response = await fetch(session.url, { method: "POST", headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return { status: response.status, data: await response.json() };
}

test("MCP authenticates sessions and binds plugin file APIs to the invoking workspace", async (t) => {
  const root = await temporary(t), first = join(root, "first"), second = join(root, "second");
  await mkdir(first); await mkdir(second);
  await writeFile(join(first, "note.txt"), "first workspace"); await writeFile(join(second, "note.txt"), "second workspace");
  const entry = await plugin(root, "local.mcp", { code: `module.exports.onLoad = () => pi.agent.registerTool({ name: "read_note", description: "read_note",
    schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, execute: args => pi.fs.readText(args.path) });`, manifest: {
    permissions: ["agent.tool.register", "fs.read"], fs: { read: { scope: ["*.txt"] } },
    contributes: { agentTools: [{ name: "read_note", description: "read_note" }] },
  } });
  const runtime = await host(t, root);
  await runtime.call("context", { workspace: second }); await runtime.call("load", entry);
  const session = await runtime.call("session.open", { workspace: first, sessionId: "tab-one" });
  const initialized = await request(session, "initialize", { params: { protocolVersion: "2024-11-05" } });
  assert.equal(initialized.data.result.protocolVersion, "2024-11-05");
  const catalog = await request(session, "tools/list");
  const tool = catalog.data.result.tools.find((item) => item.description.includes("read_note"));
  assert.ok(tool);
  const result = await request(session, "tools/call", { params: { name: tool.name, arguments: { path: "note.txt" } } });
  assert.equal(result.data.result.content[0].text, "first workspace");
  const missing = await request({ ...session, token: "invalid" }, "tools/list"); assert.equal(missing.status, 401);
  const external = await request(session, "tools/list", { params: {}, headers: { Origin: "https://example.invalid" } }); assert.equal(external.status, 403);
  await runtime.call("session.revoke", { sessionId: "tab-one" });
  assert.equal((await request(session, "tools/list")).status, 401);
});

test("Agent authoring tools scaffold, check and pack only inside the session workspace", async (t) => {
  const root = await temporary(t), workspace = join(root, "workspace"); await mkdir(workspace);
  const runtime = await host(t, root);
  const session = await runtime.call("session.open", { workspace, sessionId: "author" });
  const scaffold = await request(session, "tools/call", { params: { name: "PluginScaffold", arguments: { directory: "demo", template: "skill-pack", id: "local.from-agent", name: "Agent 插件" } } });
  assert.equal(scaffold.data.result.isError, undefined);
  assert.equal(JSON.parse(await readFile(join(workspace, "demo/manifest.json"), "utf8")).id, "local.from-agent");
  const check = await request(session, "tools/call", { params: { name: "PluginCheck", arguments: { directory: "demo" } } });
  assert.match(check.data.result.content[0].text, /"ok":true/);
  const packed = await request(session, "tools/call", { params: { name: "PluginPack", arguments: { directory: "demo" } } });
  assert.match(packed.data.result.content[0].text, /piplug/);
  const denied = await request(session, "tools/call", { params: { name: "PluginScaffold", arguments: { directory: "../escape", template: "panel-basic" } } });
  assert.equal(denied.data.result.isError, true);
});

test("real stdio adapter speaks MCP without putting session credentials in arguments", async (t) => {
  const root = await temporary(t), runtime = await host(t, root);
  const session = await runtime.call("session.open", { workspace: root, sessionId: "stdio" });
  const child = spawn(process.execPath, [resolve("src-tauri/src/plugins/node/mcp-stdio.mjs")], { stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: process.env.PATH, BELFRY_PLUGIN_MCP_URL: session.url, BELFRY_PLUGIN_MCP_TOKEN: session.token } });
  t.after(() => { child.stdin.end(); child.kill(); });
  const lines = createInterface({ input: child.stdout });
  const response = new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => reject(new Error("stdio MCP timeout")), 5000);
    lines.once("line", (line) => { clearTimeout(timer); resolveResult(JSON.parse(line)); });
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "initialize", params: { protocolVersion: "2024-11-05" } }) + "\n");
  const result = await response;
  assert.equal(result.id, 7); assert.equal(result.result.serverInfo.name, "belfry-plugins");
  assert.ok(!child.spawnargs.join(" ").includes(session.token));
});

test("revoking a session denies subsequent host APIs in an already running tool", async (t) => {
  const root = await temporary(t);
  await writeFile(join(root, "note.txt"), "session data");
  let release, signal;
  const started = new Promise((resolveStarted) => { signal = resolveStarted; });
  const runtime = await host(t, root, { platform: () => new Promise((resolveUi) => { release = resolveUi; signal(); }) });
  t.after(() => release?.(null));
  const entry = await plugin(root, "local.revoked", { code: `module.exports.onLoad = () => pi.agent.registerTool({
    name: "delayed_read", description: "delayed_read", execute: async () => {
      await pi.ui.showToast("started"); return pi.fs.readText("note.txt");
    } });`, manifest: { permissions: ["agent.tool.register", "fs.read"], fs: { read: { scope: ["*.txt"] } },
    contributes: { agentTools: [{ name: "delayed_read", description: "delayed_read" }] } } });
  await runtime.call("load", entry);
  const session = await runtime.call("session.open", { workspace: root, sessionId: "revoked" });
  const catalog = await request(session, "tools/list");
  const tool = catalog.data.result.tools.find((item) => item.description.includes("delayed_read"));
  const pending = request(session, "tools/call", { params: { name: tool.name } });
  await started;
  await runtime.call("session.revoke", { sessionId: "revoked" });
  release(null);
  const result = (await pending).data.result;
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /会话.*失效/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cleanupScope, host, temporary } from "./support.mjs";

test("命令收藏库在真实 PI 进程中隔离项目，重载保留数据，停用撤销入口", async (t) => {
  const cleanup = cleanupScope(t), root = await temporary(cleanup), calls = [];
  const first = join(root, "项目 A 空格"), second = join(root, "项目 B"); await mkdir(first); await mkdir(second);
  const runtime = await host(cleanup, root, { platform: (call) => { calls.push(call); return null; } });
  const path = resolve("examples/plugins/command-library"), manifest = JSON.parse(await readFile(join(path, "manifest.json"), "utf8"));
  const entry = { path, manifest, development: false }, pluginId = manifest.id;
  await runtime.call("context", { workspace: first }); await runtime.call("load", entry);
  const open = async () => {
    await runtime.call("panel", { pluginId });
    const url = new URL(calls.filter((call) => call.api === "ui.openPanel").at(-1).url);
    const endpoint = new URL(url); endpoint.pathname = endpoint.pathname.slice(0, endpoint.pathname.indexOf("renderer/")) + "__invoke";
    return async (api, payload = {}) => {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Origin: endpoint.origin }, body: JSON.stringify({ api, payload }) });
      const result = await response.json(); if (!result.ok) throw new Error(result.error.message); return result.value;
    };
  };
  let invoke = await open(), snapshot = await invoke("library.list");
  assert.equal(snapshot.workspace.path, first);
  snapshot = await invoke("library.save", { revision: snapshot.revision, projectKey: snapshot.projectKey,
    entry: { title: "审查", category: "开发", scope: "project", kind: "prompt", body: "审查 {{project.path}}" } });
  const saved = snapshot.entries[0], preview = await invoke("library.preview", { id: saved.id, projectKey: snapshot.projectKey });
  await invoke("library.copy", { projectKey: preview.projectKey, text: preview.text + "；保留中文" });
  assert.equal(calls.find((call) => call.api === "clipboard.writeText").args[0], `审查 ${first}；保留中文`);
  await runtime.call("context", { workspace: second });
  assert.equal((await invoke("library.list")).entries.length, 0);
  await assert.rejects(invoke("library.copy", { projectKey: preview.projectKey, text: "旧目录" }), /项目已切换/);
  await runtime.call("unload", { pluginId });
  assert.equal((await runtime.call("catalog")).commands.some((command) => command.pluginId === pluginId), false);
  await runtime.call("context", { workspace: first }); await runtime.call("load", entry); invoke = await open();
  assert.equal((await invoke("library.list")).entries[0].body, "审查 {{project.path}}");
  assert.deepEqual(manifest.permissions, ["ui.panel", "clipboard.write"]);
});

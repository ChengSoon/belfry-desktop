import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runtimeZip, extractRuntime } from "../../plugins/playwriter/runtime-archive.mjs";
import { prepareRuntime } from "../../plugins/playwriter/runtime.mjs";
import { createController } from "../../plugins/playwriter/controller.mjs";
import { readDirectory } from "../../src-tauri/src/plugins/node/directory.mjs";
import { host, temporary, waitFor } from "../plugin-tests/support.mjs";

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), "playwriter-test-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
function mocked({ extensions = [{ extensionId: "test-browser", browser: "Chrome", activeTargets: 1 }], version = { version: "0.11.0", instanceId: "test-relay" } } = {}) {
  const executors = [];
  class Executor {
    constructor(options) { this.options = options; this.value = "unset"; executors.push(this); }
    async execute(code, options) {
      this.optionsForExecute = options;
      if (code === "set") this.value = "saved";
      if (code === "huge") return { text: "image", images: [{ data: "a".repeat(900_000), mimeType: "image/png" }] };
      return { text: this.value, images: [] };
    }
    async dispose() { this.disposed = true; }
  }
  const controller = createController({ dataPath: async () => "/tmp", engineLoader: async () => ({ PlaywrightExecutor: Executor,
    startPlayWriterCDPRelayServer: () => { throw new Error("must reuse the existing relay"); } }),
    fetchImpl: async url => ({ ok: true, json: async () => url.endsWith("/version") ? version : { extensions } }) });
  return { controller, executors };
}

test("runtime archive roundtrips and rejects traversal and damaged contents", async t => {
  const root = await directory(t), content = Buffer.from("runtime content"), path = "node_modules/example/index.js";
  const zip = runtimeZip(new Map([[path, content]]));
  assert.deepEqual(await extractRuntime(zip, root), { fileCount: 1, totalBytes: content.length });
  assert.deepEqual(await readFile(join(root, path)), content);
  assert.throws(() => runtimeZip(new Map([["node_modules/../../escape", content]])), /路径/);
  const corrupted = Buffer.from(zip); corrupted[30 + Buffer.byteLength(path)] ^= 0xff;
  await assert.rejects(extractRuntime(corrupted, await directory(t)));
  const malicious = Buffer.from(zip);
  for (let offset = 0; (offset = malicious.indexOf(Buffer.from(path), offset)) >= 0; offset += path.length) {
    malicious.write("node_modules/../../outside.js".padEnd(path.length, "x").slice(0, path.length), offset);
  }
  await assert.rejects(extractRuntime(malicious, await directory(t)), /路径/);
});

test("offline runtime prepares atomically, reuses cache and verifies archive digest", async t => {
  const root = await directory(t);
  const target = await prepareRuntime(join(root, "data"));
  assert.equal(await prepareRuntime(join(root, "data")), target);
  assert.ok((await readFile(join(target, "node_modules/playwriter/dist/executor.js"))).length > 1000);
  const vendor = join(root, "vendor"); await mkdir(vendor);
  const metadata = JSON.parse(await readFile("plugins/playwriter/vendor/runtime.json", "utf8"));
  await writeFile(join(vendor, "runtime.json"), JSON.stringify(metadata));
  await writeFile(join(vendor, "runtime.zip"), "damaged");
  await assert.rejects(prepareRuntime(join(root, "invalid"), { vendor: pathToFileURL(vendor + "/") }), /摘要不一致/);
});

test("executors are isolated by both Agent and workspace; reset only releases its owner", async t => {
  const { controller, executors } = mocked(); t.after(() => controller.stop());
  const a = { workspace: "/project/a", sessionId: "agent-one" }, b = { ...a, sessionId: "agent-two" };
  await Promise.all([controller.execute({ code: "set" }, a), controller.execute({ code: "read" }, a)]);
  assert.equal(executors.length, 1);
  assert.match((await controller.execute({ code: "read" }, a)).content[0].text, /saved/);
  assert.equal((await controller.execute({ code: "read" }, b)).content[0].text, "unset");
  await controller.execute({ code: "read" }, { ...a, workspace: "/project/b" });
  assert.equal(executors.length, 3);
  assert.equal(executors[0].options.cwd, a.workspace);
  assert.notEqual(executors[0].options.cdpConfig.sessionId, executors[1].options.cdpConfig.sessionId);
  await controller.reset(a);
  assert.equal(executors[0].disposed, true); assert.equal(executors[1].disposed, undefined);
  const oversized = await controller.execute({ code: "huge" }, b);
  assert.ok(Buffer.byteLength(JSON.stringify(oversized)) < 800_000);
  assert.match(oversized.content[0].text, /图片超过/);
  await assert.rejects(controller.execute({ code: "read", timeout: 90_000 }, a), /timeout/);
});

test("missing extension and unrelated port holder produce actionable errors", async t => {
  const missing = mocked({ extensions: [] }); t.after(() => missing.controller.stop());
  await assert.rejects(missing.controller.execute({ code: "read" }, { workspace: "/tmp", sessionId: "a" }), /请先安装 Playwriter/);
  const conflict = mocked({ version: { name: "unrelated" } }); t.after(() => conflict.controller.stop());
  await assert.rejects(conflict.controller.start(), /其他服务占用/);
  assert.equal((await conflict.controller.status()).phase, "error");
});

test("packaged plugin loads in the real Belfry host, registers tools and unloads cleanly", async t => {
  const root = await temporary(t), runtime = await host(t, root);
  const snapshot = await readDirectory(resolve("plugins/playwriter"));
  await runtime.call("context", { workspace: root, sessionId: "plugin-test" });
  await runtime.call("load", { path: snapshot.root, manifest: snapshot.manifest, development: false });
  const tools = (await runtime.call("catalog")).tools.filter(tool => tool.pluginId === snapshot.manifest.id);
  assert.equal(tools.length, 4);
  const call = (name, args = {}) => runtime.call("tool", { pluginId: snapshot.manifest.id, name, args });
  const status = await waitFor(async () => {
    const value = JSON.parse((await call("playwriter_status")).content[0].text);
    assert.notEqual(value.phase, "error", value.lastError);
    return value.phase === "ready" && value;
  });
  assert.ok(status.relayRunning);
  assert.match((await call("playwriter_help")).content[0].text, /snapshot/);
  const missing = await call("playwriter_execute", { code: "console.log('test')" });
  assert.equal(missing.isError, true); assert.match(missing.content[0].text, /扩展/);
  await runtime.call("unload", { pluginId: snapshot.manifest.id });
  assert.equal((await runtime.call("catalog")).tools.filter(tool => tool.pluginId === snapshot.manifest.id).length, 0);
});

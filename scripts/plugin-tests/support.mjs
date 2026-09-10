import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

export function cleanupScope(t) {
  const cleanups = [];
  t.after(async () => {
    const errors = [];
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "测试资源清理失败");
  });
  return { after: (cleanup) => { cleanups.push(cleanup); } };
}

export async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), "belfry-runtime-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
export async function plugin(root, id, { code, manifest: extra = {} }) {
  const path = join(root, id);
  await mkdir(path, { recursive: true });
  const manifest = { schemaVersion: 1, id, name: id, version: "0.1.0", main: "main.js",
    permissions: [], contributes: {}, ...extra };
  await writeFile(join(path, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(path, "main.js"), code);
  return { path, manifest, development: false };
}
export async function host(t, root, options = {}) {
  const child = spawn(process.execPath, [resolve("src-tauri/src/plugins/node/host.mjs"), join(root, "data")], {
    stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...options.env },
  });
  let nextId = 0, stderr = "";
  const pending = new Map();
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8000); });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.type === "host") {
      Promise.resolve(options.platform?.(message) ?? null).then((value) => child.stdin.write(JSON.stringify({ type: "hostReply", id: message.id, value }) + "\n"));
      return;
    }
    if (message.type === "event") { options.event?.(message); return; }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.value);
    else entry.reject(Object.assign(new Error(message.error?.message || "host failed"), { code: message.error?.code }));
  });
  child.on("exit", (code) => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(`host exited ${code}: ${stderr}`)); }
    pending.clear();
  });
  function call(method, params = {}) {
    return new Promise((resolveCall, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`host timeout: ${method}: ${stderr}`)); }, 8000);
      pending.set(id, { resolve: resolveCall, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  t.after(async () => {
    if (child.exitCode !== null) return;
    await call("shutdown").catch(() => {});
    child.stdin.end();
    if (child.exitCode === null) child.kill();
  });
  await call("hello");
  return { call, child };
}

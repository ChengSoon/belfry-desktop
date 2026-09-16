import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { terminate } from "../../src-tauri/src/plugins/node/process-tree.mjs";

// 轮询到 read() 返回真值为止。按墙钟超时而不是固定次数：写死次数等于把等待时长
// 绑在开发机速度上，Windows CI 慢 2~3 倍时就会误判成功能失败。
export async function waitFor(read, { timeout = 10_000, interval = 25 } = {}) {
  const deadline = Date.now() + timeout;
  let value = await read();
  while (!value && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    value = await read();
  }
  return value;
}

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

// t.after 是先注册先执行：temporary() 的删除总排在 host() 的清理之前。
// Windows 上被宿主/worker 占着的插件目录删不掉（EBUSY），所以这里按 test 记下
// 待停的宿主，删目录前先把它们等干净。
const hostsByTest = new WeakMap();
function stopHostsFirst(t) {
  let stops = hostsByTest.get(t);
  if (!stops) { stops = []; hostsByTest.set(t, stops); }
  return stops;
}

export async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), "belfry-runtime-test-"));
  t.after(async () => {
    for (const stop of stopHostsFirst(t).splice(0)) await stop().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
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
  const stop = async () => {
    if (child.exitCode !== null) return;
    const closed = once(child, "close");
    await call("shutdown").catch(() => {});
    child.stdin.end();
    // 宿主 fork 的 worker 继承了这里的管道，也攥着插件目录的文件句柄；等 close
    // 才能确认句柄真的放开。超时未退再杀整棵进程树兜底，避免残留 worker 攥着管道，
    // 让测试进程在用例全部通过后仍无法退出。
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (process.platform === "win32") terminate(child, "SIGKILL");
    }, 5000);
    await closed; clearTimeout(timer);
  };
  // 同一个 test 里若有 temporary()，删目录前会先执行这里；否则由下面的 t.after 兜底。
  stopHostsFirst(t).push(stop);
  t.after(stop);
  await call("hello");
  return { call, child };
}

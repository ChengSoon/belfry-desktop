import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { host, plugin, temporary } from "./support.mjs";

test("panel background work retains its workspace until the user changes the workspace", async (t) => {
  const root = await temporary(t), other = join(root, "other"); await mkdir(other);
  await writeFile(join(root, "note.txt"), "original workspace"); await writeFile(join(other, "note.txt"), "other workspace");
  let release;
  const runtime = await host(t, root, { platform: () => new Promise((resolve) => { release = resolve; }) });
  const entry = await plugin(root, "mine.panel-jobs", { code: `let outcome = null;
    module.exports.onPanelInvoke = channel => {
      if (channel === "job.start") {
        outcome = "pending";
        void (async () => { await pi.ui.showToast("ready"); outcome = await pi.fs.readText("note.txt"); })().catch(error => { outcome = error.message; });
        return true;
      }
      return outcome;
    };`, manifest: { permissions: ["ui.view", "fs.read"], fs: { read: { scope: ["*.txt"] } }, contributes: { views: [{ id: "jobs", title: "Jobs", entry: "index.html" }] } } });
  await writeFile(join(entry.path, "index.html"), "<!doctype html><p>Jobs</p>");
  await runtime.call("context", { workspace: root }); await runtime.call("load", entry);
  const surface = await runtime.call("surface", { pluginId: entry.manifest.id, viewId: "jobs" });
  const url = new URL(surface.url), endpoint = url.origin + url.pathname.split("/").slice(0, 3).join("/") + "/__invoke";
  const invoke = async (api) => {
    const response = await fetch(endpoint, { method: "POST", headers: { Origin: url.origin, "Content-Type": "application/json" }, body: JSON.stringify({ api }) });
    return (await response.json()).value;
  };
  const outcome = async () => {
    let value;
    for (let attempt = 0; attempt < 40; attempt++) { value = await invoke("job.status"); if (value !== "pending") break; await delay(25); }
    return value;
  };
  t.after(() => release?.(null));
  await invoke("job.start"); release(null);
  assert.equal(await outcome(), "original workspace");
  await invoke("job.start"); await runtime.call("context", { workspace: other }); release(null);
  assert.match(await outcome(), /会话.*失效/);
});

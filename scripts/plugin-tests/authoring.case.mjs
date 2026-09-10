import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cli = resolve("scripts/plugin-devkit.mjs");
const invoke = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 10_000 });

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "belfry-author-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("all four templates create a runnable manifest and pass check", async (t) => {
  const root = await workspace(t);
  for (const template of ["panel-basic", "agent-tool-basic", "skill-pack", "full-demo"]) {
    const directory = join(root, template);
    const created = invoke("init", template, directory, "--id", `local.${template}`, "--name", "我的插件");
    assert.equal(created.status, 0, created.stderr);
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    assert.equal(manifest.main, "main.js");
    assert.equal(manifest.name, "我的插件");
    assert.match(await readFile(join(directory, "main.js"), "utf8"), /onLoad/);
    const checked = invoke("check", directory);
    assert.equal(checked.status, 0, checked.stderr);
  }
});

test("scaffolding refuses nonempty destinations without changing files", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "keep.txt"), "existing project");
  const result = invoke("init", "panel-basic", root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /非空|not empty/i);
  assert.equal(await readFile(join(root, "keep.txt"), "utf8"), "existing project");
});

test("pack produces a Store archive with manifest at its root and no nested dist", async (t) => {
  const root = await workspace(t);
  const directory = join(root, "demo");
  const created = invoke("init", "panel-basic", directory, "--id", "local.pack");
  assert.equal(created.status, 0, created.stderr);
  await mkdir(join(directory, "dist"));
  await writeFile(join(directory, "dist/previous.piplug"), "excluded");
  const result = invoke("pack", directory);
  assert.equal(result.status, 0, result.stderr);
  const bytes = await readFile(join(directory, "dist/local.pack-0.1.0.piplug"));
  const members = [];
  let cursor = 0;
  while (bytes.readUInt32LE(cursor) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(cursor + 8), 0);
    const size = bytes.readUInt32LE(cursor + 18);
    const nameLength = bytes.readUInt16LE(cursor + 26);
    const extraLength = bytes.readUInt16LE(cursor + 28);
    members.push(bytes.subarray(cursor + 30, cursor + 30 + nameLength).toString("utf8"));
    cursor += 30 + nameLength + extraLength + size;
  }
  assert.ok(members.includes("manifest.json"));
  assert.ok(members.includes("main.js"));
  assert.ok(members.every((name) => !name.startsWith("dist/")));
  assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
  assert.match(result.stdout, /sha256/i);
});

test("check rejects missing resources and pack writes no package on failure", async (t) => {
  const root = await workspace(t);
  const created = invoke("init", "panel-basic", root);
  assert.equal(created.status, 0, created.stderr);
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  manifest.main = "../outside.js";
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
  const result = invoke("pack", root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /路径|path|范围/i);
  await assert.rejects(readFile(join(root, "dist", `${manifest.id}-${manifest.version}.piplug`)));
});

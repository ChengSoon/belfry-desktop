import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderTemplate, projectKey } from "../examples/plugins/command-library/model.mjs";
import { createLibrary } from "../examples/plugins/command-library/library.mjs";

test("变量保留中文/空格，并明确区分原文和 Shell 引用", () => {
  const workspace = { name: "项目 A", path: "/项目/John's folder" };
  assert.equal(renderTemplate("{{project.name}}: {{project.path}}", workspace), "项目 A: /项目/John's folder");
  assert.equal(renderTemplate("cd {{project.path.posix}}", workspace), "cd '/项目/John'\"'\"'s folder'");
  assert.equal(renderTemplate("cd {{project.path.powershell}}", workspace), "cd '/项目/John''s folder'");
  assert.throws(() => renderTemplate("{{project.path}}", null), /项目/);
  assert.throws(() => renderTemplate("{{unknown}}", workspace), /变量/);
  assert.equal(projectKey({ path: "C:\\项目\\Demo\\" }), projectKey({ path: "c:/项目/demo" }));
});

test("跨项目隔离、编辑预览、重启保存和乐观锁", async () => {
  const root = await mkdtemp(join(tmpdir(), "belfry-command-library-"));
  let workspace = { name: "甲", path: "/项目 甲" }; const copied = [];
  const bridge = { dataPath: async () => root, workspace: async () => workspace, copy: async (value) => copied.push(value) };
  let library = createLibrary(bridge);
  try {
    const first = await library.list();
    const saved = await library.save({ projectKey: first.projectKey, revision: first.revision, entry: { title: "审查", kind: "prompt", scope: "project", body: "审查 {{project.path}}", category: "研发" } });
    const entry = saved.entries[0];
    const preview = await library.preview({ id: entry.id, projectKey: projectKey(workspace) });
    assert.equal(preview.text, "审查 /项目 甲");
    await library.copy({ text: preview.text + "，只读", projectKey: preview.projectKey });
    assert.deepEqual(copied, ["审查 /项目 甲，只读"]);
    await assert.rejects(library.save({ projectKey: first.projectKey, revision: first.revision, entry }), /变化/);
    workspace = { name: "乙", path: "/项目 乙" };
    assert.equal((await library.list()).entries.length, 0);
    await assert.rejects(library.preview({ id: entry.id, projectKey: projectKey(workspace) }), /当前项目/);
    await assert.rejects(library.copy({ text: "旧项目内容", projectKey: preview.projectKey }), /项目已切换/);
    await assert.rejects(library.save({ projectKey: projectKey(workspace), revision: (await library.list()).revision, entry }), /当前项目/);
    workspace = { name: "甲", path: "/项目 甲" }; library = createLibrary(bridge);
    assert.equal((await library.list()).entries[0].title, "审查");
    const before = await readFile(join(root, "library.json"));
    await writeFile(join(root, "library.json"), '{"version":99}');
    await assert.rejects(library.list(), /版本/);
    assert.equal(await readFile(join(root, "library.json"), "utf8"), '{"version":99}');
    await writeFile(join(root, "library.json"), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("全局收藏可复用，归档与恢复不永久丢失内容", async () => {
  const root = await mkdtemp(join(tmpdir(), "belfry-command-library-"));
  const library = createLibrary({ dataPath: async () => root, workspace: async () => null, copy: async () => {} });
  try {
    let snapshot = await library.list();
    await assert.rejects(library.save({ projectKey: snapshot.projectKey, revision: snapshot.revision, entry: { title: "项目", scope: "project", kind: "command", body: "pwd" } }), /项目/);
    snapshot = await library.save({ projectKey: snapshot.projectKey, revision: snapshot.revision, entry: { title: "状态", scope: "global", kind: "command", body: "git status", category: "Git" } });
    const entry = snapshot.entries[0];
    snapshot = await library.save({ projectKey: snapshot.projectKey, revision: snapshot.revision, entry: { ...entry, archived: true } });
    assert.equal(snapshot.entries[0].archived, true);
    snapshot = await library.save({ projectKey: snapshot.projectKey, revision: snapshot.revision, entry: { ...entry, archived: false } });
    assert.equal(snapshot.entries[0].body, "git status");
    assert.equal(snapshot.entries[0].archived, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

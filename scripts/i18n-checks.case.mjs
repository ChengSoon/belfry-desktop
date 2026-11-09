import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["scripts/export-backend-i18n.mjs", "scripts/sync-backend-i18n.mjs",
  "src-tauri/crates/belfry-i18n/catalog.json", "docs/backend-error-codes.json",
  "src/i18n/locales/zh-CN/errors.json", "src/i18n/locales/en/errors.json"];
const scripts = ["export-backend-i18n.mjs", "sync-backend-i18n.mjs"];

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 20_000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

async function fixture(t, crlf) {
  const root = await mkdtemp(join(tmpdir(), "belfry-i18n-check-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  for (const path of files) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, (await readFile(join(repo, path), "utf8")).replace(/\r\n/g, "\n"));
  }
  for (const args of [["init", "-q"], ["-c", "core.autocrlf=false", "add", "."]]) {
    const result = run("git", args, root);
    assert.equal(result.status, 0, result.stderr);
  }
  // Remove the worktree copies so Git must actually apply its checkout conversion.
  for (const path of files) await unlink(join(root, path));
  const result = run("git", ["-c", `core.autocrlf=${crlf}`, "checkout-index", "--all", "--force"], root);
  assert.equal(result.status, 0, result.stderr);
  const eol = run("git", ["ls-files", "--eol"], root);
  assert.equal(eol.status, 0, eol.stderr);
  assert.equal(eol.stdout.trim().split(/\r?\n/).length, files.length);
  for (const line of eol.stdout.trim().split(/\r?\n/)) {
    assert.match(line, crlf ? /i\/lf\s+w\/crlf\s/ : /i\/lf\s+w\/lf\s/);
  }
  return root;
}

async function check(root, script, expected) {
  const before = await Promise.all(files.map(path => readFile(join(root, path))));
  const result = run(process.execPath, [join("scripts", script), "--check"], root);
  assert.equal(result.status, expected, `${script}: ${result.stdout}\n${result.stderr}`);
  const after = await Promise.all(files.map(path => readFile(join(root, path))));
  assert.deepEqual(after, before, "--check must never rewrite any input or generated catalog");
  return result;
}

async function changeJson(root, path, crlf, mutate) {
  const value = JSON.parse(await readFile(join(root, path), "utf8"));
  mutate(value);
  const text = JSON.stringify(value, null, 2) + "\n";
  await writeFile(join(root, path), crlf ? text.replace(/\n/g, "\r\n") : text);
}

for (const crlf of [false, true]) {
  const eol = crlf ? "CRLF" : "LF";
  test(`both catalog checks accept an unchanged Git ${eol} checkout`, async t => {
    const root = await fixture(t, crlf);
    for (const script of scripts) await check(root, script, 0);
  });

  test(`the export check rejects real source text drift in a ${eol} checkout`, async t => {
    const root = await fixture(t, crlf);
    await changeJson(root, "src-tauri/crates/belfry-i18n/catalog.json", crlf, catalog => {
      catalog.find(entry => entry.code === "ROOM_NAME_REQUIRED").en = "Changed room name requirement.";
    });
    const result = await check(root, scripts[0], 1);
    assert.match(result.stderr, /Backend error directory is stale/);
  });

  test(`the export check rejects changed parameter names in a ${eol} checkout`, async t => {
    const root = await fixture(t, crlf);
    await changeJson(root, "docs/backend-error-codes.json", crlf, directory => {
      directory.entries.find(entry => entry.code === "ROOM_ROLE_NAME_LIMIT").params = ["wrongLimit"];
    });
    const result = await check(root, scripts[0], 1);
    assert.match(result.stderr, /Backend error directory is stale/);
  });

  for (const locale of ["zh-CN", "en"]) {
    test(`the sync check rejects ${locale} text and parameter drift in a ${eol} checkout`, async t => {
      const root = await fixture(t, crlf);
      await changeJson(root, `src/i18n/locales/${locale}/errors.json`, crlf, catalog => {
        catalog.ROOM_NAME_REQUIRED = "Changed text {{unexpected}}";
      });
      const result = await check(root, scripts[1], 1);
      assert.ok(result.stderr.includes(`Backend translations changed: run pnpm sync:i18n (${locale})`), result.stderr);
    });
  }
}

test("report the actual checkout line endings used by this CI runner", async t => {
  const endings = {};
  for (const path of files.slice(2)) {
    const bytes = await readFile(join(repo, path), "utf8");
    endings[path] = bytes.includes("\r\n") ? "CRLF" : "LF";
  }
  t.diagnostic(JSON.stringify({ platform: process.platform, endings }));
});

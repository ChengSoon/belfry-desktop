import assert from "node:assert/strict";
// 显式由 node --test 执行，避免被 Vitest 的 *.test.* 默认模式重复收集。
import test from "node:test";
import { parseUpdaterManifest, validateReleaseAssets } from "./release-assets.mjs";

function completeRelease(urlField = "browser_download_url") {
  const base = "https://github.com/ChengSoon/belfry-desktop/releases";
  const api = "https://api.github.com/repos/ChengSoon/belfry-desktop/releases/assets";
  const version = "0.20.2", tag = `v${version}`;
  const files = { "darwin-aarch64": "Belfry_aarch64.app.tar.gz", "darwin-x86_64": "Belfry_x64.app.tar.gz",
    "windows-x86_64": `Belfry_${version}_x64-setup.exe` };
  const names = [...Object.values(files).flatMap((name) => [name, `${name}.sig`]),
    `Belfry_${version}_aarch64.dmg`, `Belfry_${version}_x64.dmg`];
  const assets = names.map((name, index) => ({ id: 100 + index, name, size: 1,
    url: `${api}/${100 + index}`, browser_download_url: `${base}/download/${tag}/${name}` }));
  return { release: { draft: true, tag_name: tag, html_url: `${base}/tag/${tag}` },
    assets,
    manifest: { version, platforms: Object.fromEntries(Object.entries(files).map(([platform, name]) =>
      [platform, { signature: "test-signature", url: assets.find((asset) => asset.name === name)[urlField] }])) } };
}

test("updater downloads accept Octokit's JSON, text and binary response forms", () => {
  const manifest = completeRelease().manifest, json = JSON.stringify(manifest);
  for (const response of [manifest, json, Buffer.from(json), new TextEncoder().encode(json).buffer]) {
    assert.deepEqual(manifest, parseUpdaterManifest(response));
  }
  assert.throws(() => parseUpdaterManifest(null), /无法解析/);
  assert.throws(() => parseUpdaterManifest("incomplete JSON"));
});

test("all platform uploads must be complete before a draft can be published", () => {
  assert.doesNotThrow(() => validateReleaseAssets(completeRelease()));
  for (const missing of ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]) {
    const input = completeRelease(); delete input.manifest.platforms[missing];
    assert.throws(() => validateReleaseAssets(input), /缺少/);
  }
});

test("a manifest alone cannot publish missing, empty or unsigned assets", () => {
  const missing = completeRelease(); missing.assets = missing.assets.filter((asset) => !asset.name.endsWith(".sig"));
  assert.throws(() => validateReleaseAssets(missing), /尚未上传/);
  const empty = completeRelease(); empty.assets.forEach((asset) => { asset.size = 0; });
  assert.throws(() => validateReleaseAssets(empty), /尚未上传|非空资产/);
  const unsigned = completeRelease(); unsigned.manifest.platforms["windows-x86_64"].signature = "";
  assert.throws(() => validateReleaseAssets(unsigned), /签名/);
  const installer = completeRelease(); installer.assets = installer.assets.filter((asset) => !asset.name.endsWith(".dmg"));
  assert.throws(() => validateReleaseAssets(installer), /缺少安装包/);
  const overwritten = completeRelease(); overwritten.manifest.platforms["darwin-x86_64"] = overwritten.manifest.platforms["darwin-aarch64"];
  assert.throws(() => validateReleaseAssets(overwritten), /不能覆盖/);
});

test("published releases, wrong versions and foreign URLs cannot pass the gate", () => {
  const published = completeRelease(); published.release.draft = false;
  assert.throws(() => validateReleaseAssets(published), /草稿/);
  const version = completeRelease(); version.manifest.version = "0.20.1";
  assert.throws(() => validateReleaseAssets(version), /版本/);
  for (const url of ["https://example.com/asset", "https://github.com/another/repo/releases/download/v0.20.2/file",
    "https://github.com/ChengSoon/belfry-desktop/releases/download/v0.20.1/file"]) {
    const input = completeRelease(); input.manifest.platforms["windows-x86_64"].url = url;
    assert.throws(() => validateReleaseAssets(input), /更新地址/);
  }
});

test("tauri-action v1 API asset URLs identify the uploaded files without filename parsing", () => {
  // v1 upload-version-json.ts 使用 /repos/{owner}/{repo}/releases/assets/{asset.id}。
  const input = completeRelease("url");
  assert.match(input.manifest.platforms["darwin-aarch64"].url, /\/releases\/assets\/100$/);
  assert.doesNotThrow(() => validateReleaseAssets(input));
});

test("API and browser aliases of one asset cannot satisfy different targets", () => {
  const input = completeRelease();
  input.manifest.platforms["darwin-x86_64"].url = input.assets[0].url;
  assert.throws(() => validateReleaseAssets(input), /不能覆盖/);
});

test("only exact asset URLs from the current release can be published", () => {
  for (const urlField of ["url", "browser_download_url"]) {
    const input = completeRelease(urlField);
    const target = "windows-x86_64", original = input.manifest.platforms[target].url;
    const invalid = [original.replace("/download/", "/download/extra/").replace("/assets/", "/assets/extra/"),
      original + "?download=1", original + "#fragment", original + "/extra",
      original.replace("/belfry-desktop/", "/another-repo/"), original.replace("https://", "https://user@")];
    for (const url of invalid) {
      input.manifest.platforms[target].url = url;
      assert.throws(() => validateReleaseAssets(input), /更新地址/, url);
    }
  }
});

test("unknown IDs and empty assets cannot borrow another uploaded filename", () => {
  for (const urlField of ["url", "browser_download_url"]) {
    const input = completeRelease(urlField);
    const asset = input.assets[0];
    asset.size = 0;
    input.assets.push({ ...asset, id: 999, size: 1, url: `${asset.url}/wrong`,
      browser_download_url: `${asset.browser_download_url}/wrong` });
    assert.throws(() => validateReleaseAssets(input), /更新地址/);
  }
  const unknown = completeRelease("url");
  unknown.manifest.platforms["windows-x86_64"].url = "https://api.github.com/repos/ChengSoon/belfry-desktop/releases/assets/999";
  assert.throws(() => validateReleaseAssets(unknown), /更新地址/);
});

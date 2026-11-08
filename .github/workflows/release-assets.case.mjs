import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
// 显式由 node --test 执行，避免被 Vitest 的 *.test.* 默认模式重复收集。
import test from "node:test";
import { parseUpdaterManifest, validateReleaseAssets } from "./release-assets.mjs";
import { downloadReleaseAsset, formatChecksums, hashReleaseAssets } from "./release-checksums.mjs";
import { publishRelease } from "./publish-release.mjs";

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
  const manifest = { version, platforms: Object.fromEntries(Object.entries(files).map(([platform, name]) =>
    [platform, { signature: "test-signature", url: assets.find((asset) => asset.name === name)[urlField] }])) };
  assets.push({ id: 108, name: "latest.json", size: 1, url: `${api}/108`, browser_download_url: `${base}/download/${tag}/latest.json` });
  const payloads = new Map(assets.map(asset => [asset.id, Buffer.from(asset.name === "latest.json"
    ? JSON.stringify(manifest, null, 2) + "\n" : `original bytes: ${asset.name}`)]));
  for (const asset of assets) asset.size = payloads.get(asset.id).length;
  const hashes = assets.map(asset => ({ id: asset.id, name: asset.name, size: asset.size,
    sha256: createHash("sha256").update(payloads.get(asset.id)).digest("hex") }));
  const checksums = hashes.map(item => `${item.sha256}  ${item.name}\n`).sort().join("");
  assets.push({ id: 109, name: "SHA256SUMS.txt", size: Buffer.byteLength(checksums), url: `${api}/109`,
    browser_download_url: `${base}/download/${tag}/SHA256SUMS.txt` });
  payloads.set(109, Buffer.from(checksums));
  return { release: { id: 42, draft: true, tag_name: tag, html_url: `${base}/tag/${tag}`, upload_url: `${api}{?name,label}` },
    assets, manifest, checksums, hashes, payloads };
}

test("a release cannot be published without the uploaded SHA256SUMS.txt", () => {
  const missing = completeRelease();
  missing.assets = missing.assets.filter(asset => asset.name !== "SHA256SUMS.txt");
  assert.throws(() => validateReleaseAssets(missing), /SHA256SUMS/);
});

test("checksums must match every asset's downloaded bytes and current identity", () => {
  const mismatch = completeRelease();
  mismatch.checksums = mismatch.checksums.replace(mismatch.hashes[0].sha256, "0".repeat(64));
  assert.throws(() => validateReleaseAssets(mismatch), /SHA256|校验和/);
  const changed = completeRelease();
  changed.assets[0] = { ...changed.assets[0], id: 999, url: changed.assets[0].url.replace("100", "999") };
  assert.throws(() => validateReleaseAssets(changed), /资产.*变|重新.*计算|校验和/);
});

test("partial or duplicate checksum records cannot satisfy release validation", () => {
  const partial = completeRelease();
  partial.checksums = partial.checksums.split("\n").slice(1).join("\n");
  assert.throws(() => validateReleaseAssets(partial), /校验和|SHA256/);
  const duplicate = completeRelease();
  duplicate.checksums += duplicate.checksums.split("\n")[0] + "\n";
  assert.throws(() => validateReleaseAssets(duplicate), /重复|校验和/);
});

test("the repository does not contain the downloaded rustup installer", () => {
  assert.equal(existsSync(new URL("../../rustup-init.exe", import.meta.url)), false);
});

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

test("checksum generation streams exact byte ranges and sorts filenames deterministically", async () => {
  const input = completeRelease();
  let active = 0;
  let peak = 0;
  const read = async function* (asset) {
    active++;
    peak = Math.max(peak, active);
    try {
      const payload = input.payloads.get(asset.id);
      const padded = Buffer.concat([Buffer.from("prefix"), payload, Buffer.from("suffix")]);
      yield padded.subarray(6, 9);
      await Promise.resolve();
      yield new DataView(padded.buffer, padded.byteOffset + 9, payload.length - 3);
    } finally { active--; }
  };
  const hashes = await hashReleaseAssets([...input.assets].reverse(), read);
  assert.equal(peak, 1);
  assert.deepEqual(hashes.map(item => item.name), input.hashes.map(item => item.name).sort());
  for (const item of hashes) assert.deepEqual(item, input.hashes.find(expected => expected.id === item.id));
  const checksums = formatChecksums(hashes);
  assert.equal(checksums, formatChecksums([...hashes].reverse()));
  validateReleaseAssets({ ...input, checksums, hashes });
});

test("generated checksums agree with the platform tools documented for downloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "belfry-release-checksums-"));
  try {
    const name = "Belfry fixture.dmg";
    const payload = Buffer.from([0, 1, 2, 127, 128, 254, 255]);
    await writeFile(join(root, name), payload);
    const hashes = await hashReleaseAssets([{ id: 1, name, size: payload.length }], asset => createReadStream(join(root, asset.name)));
    await writeFile(join(root, "SHA256SUMS.txt"), formatChecksums(hashes));
    const windows = process.platform === "win32";
    const result = spawnSync(windows ? "certutil.exe" : "shasum", windows
      ? ["-hashfile", name, "SHA256"] : ["-a", "256", "-c", "SHA256SUMS.txt"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, `${result.error || ""}\n${result.stdout}\n${result.stderr}`);
    if (windows) assert.ok(result.stdout.replace(/\s/gu, "").toLowerCase().includes(hashes[0].sha256));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("failed, truncated, oversized or decoded asset downloads cannot become checksums", async () => {
  const asset = { id: 1, name: "Belfry test.dmg", size: 4 };
  for (const body of [Buffer.from("abc"), Buffer.from("abcde"), { decoded: "JSON" }, "text"]) {
    await assert.rejects(hashReleaseAssets([asset], async () => body), /字节|不完整/);
  }
  await assert.rejects(hashReleaseAssets([asset], async () => { throw new Error("download interrupted"); }), /interrupted/);
  for (const name of ["../Belfry.dmg", "Belfry\ninstaller.exe", "Belfry\\installer.exe"]) {
    await assert.rejects(hashReleaseAssets([{ ...asset, name }], async () => Buffer.from("data")), /名称/);
  }
  await assert.rejects(hashReleaseAssets([asset, asset], async () => Buffer.from("data")), /重复/);
});

test("asset downloads request raw bytes and reject HTTP errors", async () => {
  const asset = { id: 1, name: "latest.json", url: "https://api.github.com/repos/example/belfry/releases/assets/1", size: 4 };
  const body = await downloadReleaseAsset(asset, "fixture-token", async (url, options) => {
    assert.equal(url, asset.url);
    assert.equal(options.headers.accept, "application/octet-stream");
    assert.equal(options.headers.authorization, "Bearer fixture-token");
    assert.equal(options.signal.aborted, false);
    return new Response(Buffer.from("{}\r\n"));
  });
  const hashes = await hashReleaseAssets([asset], async () => body);
  assert.equal(hashes[0].sha256, createHash("sha256").update("{}\r\n").digest("hex"));
  await assert.rejects(downloadReleaseAsset(asset, "fixture-token", async () => new Response("no", { status: 403 })), /HTTP 403/);
});

function publicationFixture(faults = {}) {
  const input = completeRelease();
  const calls = [];
  let nextId = 1000;
  const repos = {
    getRelease: async () => ({ data: { ...input.release } }),
    listReleaseAssets: async () => ({ data: input.assets.map(asset => ({ ...asset })) }),
    deleteReleaseAsset: async ({ asset_id }) => {
      calls.push("delete-checksum");
      assert.equal(input.assets.find(asset => asset.id === asset_id).name, "SHA256SUMS.txt");
      input.assets = input.assets.filter(asset => asset.id !== asset_id);
      input.payloads.delete(asset_id);
    },
    uploadReleaseAsset: async ({ name, data, release_id }) => {
      calls.push("upload-checksum");
      assert.equal(release_id, input.release.id);
      assert.equal(name, "SHA256SUMS.txt");
      const asset = { id: nextId++, name, size: data.length, url: `https://api.github.com/assets/${nextId}` };
      const payload = Buffer.from(data);
      if (faults.corrupt) payload[0] = payload[0] === 48 ? 49 : 48;
      input.payloads.set(asset.id, payload);
      if (!faults.missing) input.assets.push(asset);
      if (faults.replaced) input.assets[0] = { ...input.assets[0], id: 999 };
      return { data: asset };
    },
    updateRelease: async ({ draft, make_latest }) => {
      calls.push("publish");
      assert.equal(draft, false);
      assert.equal(make_latest, "true");
      input.release.draft = false;
      return { data: input.release };
    },
  };
  const github = { rest: { repos }, paginate: async (method, args) => (await method(args)).data };
  const readAsset = async asset => {
    calls.push(`read:${asset.name}`);
    if (faults.download && asset.name.endsWith(".dmg")) throw new Error("download interrupted");
    const payload = input.payloads.get(asset.id);
    return faults.truncated && asset.name === "SHA256SUMS.txt" ? payload.subarray(1) : payload;
  };
  return { input, calls, options: { github, repo: { owner: "example", repo: "belfry" }, releaseId: input.release.id, readAsset } };
}

test("publication reads back the uploaded checksum before making the draft public", async () => {
  const fixture = publicationFixture();
  await publishRelease(fixture.options);
  assert.equal(fixture.input.release.draft, false);
  assert.equal(fixture.calls.at(-1), "publish");
  assert.ok(fixture.calls.indexOf("upload-checksum") < fixture.calls.indexOf("read:SHA256SUMS.txt"));
  assert.ok(fixture.calls.indexOf("read:SHA256SUMS.txt") < fixture.calls.indexOf("publish"));
  const uploaded = fixture.input.assets.find(asset => asset.name === "SHA256SUMS.txt");
  assert.equal(fixture.input.payloads.get(uploaded.id).toString(), formatChecksums(fixture.input.hashes));
});

test("checksum faults and asset replacement keep the release unpublished", async () => {
  for (const faults of [{ corrupt: true }, { missing: true }, { replaced: true }, { truncated: true }, { download: true }]) {
    const fixture = publicationFixture(faults);
    await assert.rejects(publishRelease(fixture.options));
    assert.equal(fixture.input.release.draft, true, JSON.stringify(faults));
    assert.equal(fixture.calls.includes("publish"), false, JSON.stringify(faults));
    if (faults.download) assert.equal(fixture.calls.includes("delete-checksum"), false);
  }
  const publicRelease = publicationFixture();
  publicRelease.input.release.draft = false;
  await assert.rejects(publishRelease(publicRelease.options), /草稿/);
  assert.deepEqual(publicRelease.calls, []);
});

test("retrying a failed draft replaces its checksum without duplicating other assets", async () => {
  const faults = { corrupt: true };
  const fixture = publicationFixture(faults);
  const original = fixture.input.assets.filter(asset => asset.name !== "SHA256SUMS.txt");
  await assert.rejects(publishRelease(fixture.options), /SHA256/);
  faults.corrupt = false;
  await publishRelease(fixture.options);
  assert.equal(fixture.input.assets.filter(asset => asset.name === "SHA256SUMS.txt").length, 1);
  assert.deepEqual(fixture.input.assets.filter(asset => asset.name !== "SHA256SUMS.txt"), original);
  assert.equal(fixture.calls.filter(call => call === "publish").length, 1);
});

const TARGETS = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"];

export function parseUpdaterManifest(value) {
  if (typeof value === "string") return JSON.parse(value);
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : Buffer.from(value);
    return JSON.parse(bytes.toString("utf8"));
  }
  // Octokit 可根据下载后的 Content-Type 直接解析 JSON。
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  throw new Error("无法解析更新清单响应");
}

/** 只有三个平台的可用签名更新包和安装包都到齐，草稿才允许发布。 */
export function validateReleaseAssets({ release, assets, manifest }) {
  if (!release.draft) throw new Error("仅允许发布尚未公开的草稿");
  if (`v${manifest.version}` !== release.tag_name) throw new Error("更新清单版本与 tag 不一致");
  const uploaded = assets.filter((asset) => asset.size > 0);
  const names = new Set(uploaded.map((asset) => asset.name));
  const updates = new Set();
  for (const target of TARGETS) {
    const entry = manifest.platforms?.[target];
    if (!entry?.url || !entry.signature?.trim()) throw new Error(`缺少 ${target} 的更新包或签名`);
    // tauri-action v1 使用 API 资产 ID 地址；两种地址都必须精确对应本次 release 的非空资产。
    const asset = uploaded.find((item) => item.url === entry.url || item.browser_download_url === entry.url);
    if (!asset) throw new Error(`${target} 的更新地址未匹配本次发布的非空资产`);
    const { name } = asset;
    if (!names.has(`${name}.sig`)) throw new Error(`${target} 的更新文件尚未上传完毕`);
    if (updates.has(name)) throw new Error("不同目标架构的更新包不能覆盖同一个文件");
    updates.add(name);
  }
  for (const pattern of [/aarch64\.dmg$/, /(?:x64|x86_64)\.dmg$/, /(?:x64|x86_64).*setup\.exe$/]) {
    if (![...names].some((name) => pattern.test(name))) throw new Error(`缺少安装包：${pattern}`);
  }
}

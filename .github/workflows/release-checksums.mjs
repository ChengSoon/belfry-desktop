import { createHash } from "node:crypto";

export const CHECKSUM_NAME = "SHA256SUMS.txt";
const MAX_MANIFEST_BYTES = 1024 * 1024;

function validName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 1024
    && name.trim() === name && name !== "." && name !== ".." && !/[\\/\x00-\x1f\x7f]/u.test(name);
}

/** Hash every release asset except the checksum manifest itself, including updater metadata. */
function checksumAssets(assets) {
  const names = new Set();
  const files = [];
  for (const asset of assets) {
    if (!validName(asset.name)) throw new Error("校验和资产名称无效");
    if (names.has(asset.name)) throw new Error(`重复的发布资产名称：${asset.name}`);
    names.add(asset.name);
    if (asset.name === CHECKSUM_NAME) continue;
    if (!Number.isSafeInteger(asset.id) || asset.id <= 0 || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new Error(`校验和需要非空且有效的发布资产：${asset.name}`);
    }
    files.push(asset);
  }
  if (!files.length) throw new Error("没有可生成校验和的发布资产");
  return files.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

function bytes(value) {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("资产下载必须返回原始字节，不能使用解析后的 JSON 或文本");
}

async function consume(asset, readAsset, onChunk) {
  const body = await readAsset(asset);
  const chunks = body instanceof ArrayBuffer || ArrayBuffer.isView(body) ? [body] : body;
  if (!chunks || typeof chunks === "string" || (!chunks[Symbol.asyncIterator] && !chunks[Symbol.iterator])) {
    throw new Error(`资产下载没有字节流：${asset.name}`);
  }
  let size = 0;
  for await (const chunk of chunks) {
    const data = bytes(chunk);
    size += data.length;
    if (size > asset.size) throw new Error(`资产下载字节数与发布记录不一致：${asset.name}`);
    onChunk(data);
  }
  if (size !== asset.size || size === 0) throw new Error(`资产下载不完整：${asset.name}`);
}

export async function hashReleaseAssets(assets, readAsset) {
  const hashes = [];
  // Stream one asset at a time; installers are never buffered together or written to disk.
  for (const asset of checksumAssets(assets)) {
    const digest = createHash("sha256");
    await consume(asset, readAsset, chunk => digest.update(chunk));
    hashes.push({ id: asset.id, name: asset.name, size: asset.size, sha256: digest.digest("hex") });
  }
  return hashes;
}

export function formatChecksums(hashes) {
  const names = new Set();
  const text = [...hashes].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0).map(item => {
    if (!validName(item.name) || item.name === CHECKSUM_NAME || !/^[a-f0-9]{64}$/u.test(item.sha256) || names.has(item.name)) {
      throw new Error("无法生成重复或无效的 SHA256 校验和记录");
    }
    names.add(item.name);
    return `${item.sha256}  ${item.name}\n`;
  }).join("");
  if (!text || Buffer.byteLength(text) > MAX_MANIFEST_BYTES) throw new Error("SHA256SUMS.txt 大小无效");
  return text;
}

export async function readSmallReleaseAsset(asset, readAsset) {
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_MANIFEST_BYTES) {
    throw new Error(`发布清单大小无效：${asset.name}`);
  }
  const chunks = [];
  await consume(asset, readAsset, chunk => chunks.push(Buffer.from(chunk)));
  return Buffer.concat(chunks);
}

function parseChecksums(value) {
  const buffer = typeof value === "string" ? Buffer.from(value) : bytes(value);
  if (!buffer.length || buffer.length > MAX_MANIFEST_BYTES) throw new Error("SHA256SUMS.txt 大小无效");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  const entries = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64}) [ *](.+)$/iu.exec(line);
    if (!match || !validName(match[2]) || match[2] === CHECKSUM_NAME) throw new Error("SHA256 校验和记录格式无效");
    if (entries.has(match[2])) throw new Error(`重复的校验和记录：${match[2]}`);
    entries.set(match[2], match[1].toLowerCase());
  }
  return { entries, length: buffer.length };
}

export function verifyReleaseChecksums({ assets, checksums, hashes }) {
  const manifests = assets.filter(asset => asset.name === CHECKSUM_NAME);
  if (manifests.length !== 1 || manifests[0].size <= 0) throw new Error(`缺少唯一非空的 ${CHECKSUM_NAME}`);
  const files = checksumAssets(assets);
  const { entries: recorded, length } = parseChecksums(checksums);
  if (length !== manifests[0].size) throw new Error("SHA256 校验和清单字节数与资产记录不一致");
  if (!Array.isArray(hashes) || hashes.length !== files.length || recorded.size !== files.length) {
    throw new Error("校验和必须完整覆盖本次发布的每个资产");
  }
  const actual = new Map(hashes.map(item => [item.name, item]));
  if (actual.size !== hashes.length) throw new Error("重复的资产校验和计算结果");
  for (const asset of files) {
    const digest = actual.get(asset.name);
    if (!digest || digest.id !== asset.id || digest.size !== asset.size) {
      throw new Error(`计算校验和后资产已变更，需要重新计算：${asset.name}`);
    }
    if (!/^[a-f0-9]{64}$/u.test(digest.sha256) || recorded.get(asset.name) !== digest.sha256) {
      throw new Error(`SHA256 校验和与发布资产不一致：${asset.name}`);
    }
  }
}

export async function downloadReleaseAsset(asset, token, fetchImpl = fetch) {
  const response = await fetchImpl(asset.url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/octet-stream" },
    redirect: "follow",
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  if (!response.ok || !response.body) throw new Error(`下载发布资产失败：${asset.name} (HTTP ${response.status})`);
  return response.body;
}

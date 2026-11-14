import { deflateRawSync, inflateRawSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const MAX_BYTES = 256 * 1024 * 1024;
const table = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n >>> 1 ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crc >>> 8 ^ table[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function safeName(name) {
  if (!name.startsWith("node_modules/") || name.includes("\\") || name.includes(":")
    || name.split("/").some(part => !part || part === "." || part === "..") || /[\x00-\x1f]/.test(name)) {
    throw new Error("运行组件包含无效路径");
  }
}

// Standard ZIP without timestamps or platform permissions, reproducible across builds.
export function runtimeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, body] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    safeName(name);
    const filename = Buffer.from(name), compressed = deflateRawSync(body, { level: 9 });
    const local = Buffer.alloc(30), central = Buffer.alloc(46), crc = crc32(body);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(body.length, 22); local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    const block = Buffer.concat([local, filename, compressed]);
    locals.push(block); centrals.push(Buffer.concat([central, filename])); offset += block.length;
  }
  const index = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(locals.length, 8); end.writeUInt16LE(locals.length, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, index, end]);
}

function archiveIndex(bytes) {
  if (bytes.length < 22 || bytes.length > 50 * 1024 * 1024) throw new Error("运行组件包大小无效");
  const end = bytes.length - 22;
  if (bytes.readUInt32LE(end) !== 0x06054b50) throw new Error("运行组件包格式无效");
  const count = bytes.readUInt16LE(end + 10), indexStart = bytes.readUInt32LE(end + 16);
  if (!count || count > 20_000 || indexStart + bytes.readUInt32LE(end + 12) !== end) throw new Error("运行组件包目录无效");
  return { end, count, indexStart };
}
function archiveEntry(bytes, cursor, { end, indexStart }) {
  if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("运行组件包目录损坏");
  const length = bytes.readUInt16LE(cursor + 28), size = bytes.readUInt32LE(cursor + 24);
  const compressedSize = bytes.readUInt32LE(cursor + 20), offset = bytes.readUInt32LE(cursor + 42);
  const next = cursor + 46 + length + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
  if (next > end || offset + 30 > indexStart) throw new Error("运行组件包条目越界");
  const name = bytes.subarray(cursor + 46, cursor + 46 + length).toString("utf8");
  safeName(name);
  return { name, size, compressedSize, offset, next, cursor, indexStart };
}
function entryContents(bytes, entry) {
  const { offset, cursor, name, size, compressedSize, indexStart } = entry;
  const localNameLength = bytes.readUInt16LE(offset + 26);
  const start = offset + 30 + localNameLength + bytes.readUInt16LE(offset + 28);
  if (bytes.readUInt32LE(offset) !== 0x04034b50 || bytes.readUInt16LE(cursor + 10) !== 8
    || bytes.readUInt16LE(cursor + 8) !== 0x800 || start + compressedSize > indexStart
    || bytes.subarray(offset + 30, offset + 30 + localNameLength).toString("utf8") !== name) {
    throw new Error("运行组件包条目无效");
  }
  const body = inflateRawSync(bytes.subarray(start, start + compressedSize), { maxOutputLength: Math.max(1, size) });
  if (body.length !== size || crc32(body) !== bytes.readUInt32LE(cursor + 16)) throw new Error("运行组件校验失败");
  return body;
}

export async function extractRuntime(bytes, destination, { signal } = {}) {
  const index = archiveIndex(bytes), seen = new Set();
  let cursor = index.indexStart, totalBytes = 0;
  for (let i = 0; i < index.count; i++) {
    signal?.throwIfAborted();
    const entry = archiveEntry(bytes, cursor, index);
    if (seen.has(entry.name.toLowerCase())) throw new Error("运行组件包包含重复路径");
    seen.add(entry.name.toLowerCase());
    totalBytes += entry.size;
    if (entry.size > 64 * 1024 * 1024 || totalBytes > MAX_BYTES) throw new Error("运行组件解压大小超额");
    const body = entryContents(bytes, entry), target = join(destination, entry.name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body, { flag: "wx", mode: 0o600 });
    cursor = entry.next;
  }
  if (cursor !== index.end) throw new Error("运行组件包目录长度不一致");
  return { fileCount: index.count, totalBytes };
}

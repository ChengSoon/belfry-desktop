export function* rangeSteps(input) {
  const chunkSize = 512 * 1024;
  const offset = input.byteOffset ?? input.offset, length = input.length;
  function validate(offset, length) {
    const limit = 8 * 1024 * 1024;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > limit) {
      throw Object.assign(new Error("读取范围必须为非负整数，长度最多为 8 MiB"), { code: "INVALID_ARGUMENT" });
    }
  }
  validate(offset, length);
  const chunks = []; let read = 0, totalSize = 0;
  do {
    const requested = Math.min(chunkSize, length - read);
    const value = yield { path: input.path, offset: offset + read, length: requested, grantId: input.grantId };
    if (!(value?.bytes instanceof Uint8Array) || value.bytes.length > requested) throw Object.assign(new Error("文件分块结果无效"), { code: "INVALID_RESULT" });
    chunks.push(value.bytes); read += value.bytes.length; totalSize = value.totalSize;
    if (value.bytes.length < requested) break;
  } while (read < length);
  const bytes = new Uint8Array(read); let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
  return { bytes, totalSize };
}
export async function collectRange(read, input, steps = rangeSteps) {
  const iterator = steps(input); let current = iterator.next();
  while (!current.done) current = iterator.next(await read(current.value));
  return current.value;
}

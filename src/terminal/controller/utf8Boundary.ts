const CONTINUATION_MASK = 0xc0;
const CONTINUATION_TAG = 0x80;
const MAX_UTF8_BYTES = 4;
const MULTIBYTE_RANGES = [[0xc2, 0xdf, 2], [0xe0, 0xef, 3], [0xf0, 0xf4, 4]] as const;

/** xterm 6 对暂存的 0x80 续字节处理有误；只把完整码点交给每次 write，最多留 3 字节。 */
export class Utf8Boundary {
  private pending = new Uint8Array();
  private skipContinuations = false;

  push(bytes: Uint8Array, flush = false): Uint8Array {
    if (this.skipContinuations) {
      let start = 0;
      while (start < bytes.length && isContinuation(bytes[start])) start += 1;
      bytes = bytes.subarray(start);
      this.skipContinuations = bytes.length === 0 && !flush;
    }
    const joined = append(this.pending, bytes);
    const boundary = flush ? joined.length : completeBoundary(joined);
    this.pending = joined.slice(boundary);
    return joined.subarray(0, boundary);
  }

  /** gap 已明确丢失前文，不能把半个旧字符拼到新的回放位置。 */
  reset(skipContinuations = false) {
    this.pending = new Uint8Array();
    this.skipContinuations = skipContinuations;
  }
}

function append(pending: Uint8Array, bytes: Uint8Array) {
  if (!pending.length) return bytes;
  const joined = new Uint8Array(pending.length + bytes.length);
  joined.set(pending);
  joined.set(bytes, pending.length);
  return joined;
}

function completeBoundary(bytes: Uint8Array) {
  let start = bytes.length - 1;
  while (start >= 0 && bytes.length - start < MAX_UTF8_BYTES && isContinuation(bytes[start])) start -= 1;
  if (start < 0) return bytes.length;
  const range = MULTIBYTE_RANGES.find(([min, max]) => bytes[start] >= min && bytes[start] <= max);
  return range && bytes.length - start < range[2] ? start : bytes.length;
}

function isContinuation(byte: number) {
  return (byte & CONTINUATION_MASK) === CONTINUATION_TAG;
}

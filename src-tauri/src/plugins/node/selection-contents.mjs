// 原生文件选择的内容按需读取；大文件不在选择时整份装入 WebView。
export function installSelectionContents(bridge) {
  const records = new WeakMap(), chunkSize = 256 * 1024;
  const nativeSize = Object.getOwnPropertyDescriptor(Blob.prototype, "size").get;
  function stream(blob, signal) {
    const record = records.get(blob); let offset = record.start, cancelled = false;
    return new ReadableStream({
      async pull(controller) {
        if (cancelled || signal?.aborted) { controller.error(new DOMException("读取已取消", "AbortError")); return; }
        if (offset >= record.end) { controller.close(); return; }
        try {
          const { bytes } = await bridge.invoke("fs.readSelection", { selectionId: record.selectionId,
            offset, length: Math.min(chunkSize, record.end - offset) });
          if (cancelled) return;
          if (signal?.aborted) throw new DOMException("读取已取消", "AbortError");
          if (!bytes.length) throw new DOMException("文件已变化，请重新选择", "NotReadableError");
          offset += bytes.length; controller.enqueue(bytes);
        } catch (error) { if (!cancelled) controller.error(error); }
      },
      cancel() { cancelled = true; },
    });
  }
  const collect = (blob, options) => collectSelectedBlob(stream, blob, options);
  function attach(blob, descriptor) {
    const record = { ...descriptor, start: descriptor.start ?? 0, end: descriptor.end ?? descriptor.size };
    records.set(blob, record);
    Object.defineProperty(blob, "size", { configurable: true, get: () => record.end - record.start });
    if (blob instanceof File) Object.defineProperty(blob, "lastModified", { configurable: true, value: Math.trunc(record.mtimeMs) });
    if (nativeSize.call(blob) === blob.size) return blob;
    Object.defineProperties(blob, {
      stream: { value: () => stream(blob), configurable: true },
      arrayBuffer: { value: () => collect(blob).then((value) => value.arrayBuffer()), configurable: true },
      bytes: { value: () => collect(blob).then(async (value) => new Uint8Array(await value.arrayBuffer())), configurable: true },
      text: { value: () => collect(blob).then((value) => value.text()), configurable: true },
      slice: { value: (start = 0, end = blob.size, type = "") => {
        const position = (value) => value < 0 ? Math.max(blob.size + Math.trunc(value), 0) : Math.min(Math.trunc(value) || 0, blob.size);
        const from = position(start), to = Math.max(from, position(end));
        return attach(new Blob([], { type }), { ...record, start: record.start + from, end: record.start + to });
      }, configurable: true },
    });
    return blob;
  }
  return { attach, collect, isSelected: (blob) => records.has(blob) && nativeSize.call(blob) !== blob.size };
}

export async function collectSelectedBlob(stream, blob, options = {}) {
  const arrayLimit = 256 * 1024 * 1024;
  if (blob.size > arrayLimit) throw new DOMException("文件过大，请分段读取或使用文件流", "NotReadableError");
  const reader = stream(blob, options.signal).getReader(), parts = []; let loaded = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      parts.push(value); loaded += value.length; options.progress?.(loaded);
    }
  } finally { reader.releaseLock(); }
  return new Blob(parts, { type: blob.type });
}

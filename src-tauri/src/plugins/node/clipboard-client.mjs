/** 分页与分块只存在于宿主传输层，插件仍得到 PI SDK 原生历史数组。 */
export function* clipboardHistorySteps() {
  const { snapshot } = yield ["clipboard.getHistory", []];
  function* readImage(index, byteLength) {
    const data = new Uint8Array(byteLength); let position = 0;
    while (position < byteLength) {
      const encoded = yield ["clipboard.imageChunk", [{ snapshot, index, offset: position }]];
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      if (!bytes.length) throw new Error("剪贴板图片读取中断");
      data.set(bytes, position); position += bytes.length;
    }
    return data;
  }
  const result = []; let offset = 0;
  try {
    do {
      const page = yield ["clipboard.historyPage", [{ snapshot, offset }]];
      for (const item of page.items) {
        const { index, byteLength, ...entry } = item;
        if (entry.type === "image") entry.data = yield* readImage(index, byteLength);
        result.push(entry);
      }
      offset = page.nextOffset;
    } while (offset !== null);
    return result;
  } finally { yield ["clipboard.releaseHistory", [{ snapshot }]]; }
}
export async function collectClipboardHistory(call, steps = clipboardHistorySteps) {
  const iterator = steps(); let current = iterator.next();
  while (!current.done) {
    let value;
    try { value = await call(...current.value); }
    catch (error) { current = iterator.throw(error); continue; }
    current = iterator.next(value);
  }
  return current.value;
}

import { emptyPriceBook, MAX_PRICE_BYTES, PRICE_BOOK_KEY, type PriceBook, type PriceBookState } from "./contracts";
import { validatePriceBook } from "./validation";

type StoragePort = Pick<Storage, "getItem" | "setItem">;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function decode(raw: string | null): PriceBookState {
  if (raw === null) return { book: emptyPriceBook(), raw, error: null };
  try {
    if (new TextEncoder().encode(raw).length > MAX_PRICE_BYTES) throw new Error("价格存档过大，原内容已保留");
    const result = validatePriceBook(JSON.parse(raw));
    if (!result.book) throw new Error(result.error ?? "价格存档无效");
    return { book: result.book, raw, error: null };
  } catch (error) {
    return { book: emptyPriceBook(), raw, error: "无法读取价格表：" + errorText(error) };
  }
}

export function loadPriceBook(storage?: StoragePort): PriceBookState {
  try { return decode((storage ?? window.localStorage).getItem(PRICE_BOOK_KEY)); }
  catch (error) { return { book: emptyPriceBook(), raw: null, error: errorText(error) }; }
}

export function savePriceBook(book: PriceBook, expectedRaw: string | null, storage?: StoragePort): PriceBookState {
  const port = storage ?? window.localStorage;
  const current = port.getItem(PRICE_BOOK_KEY);
  if (current !== expectedRaw) throw new Error("价格表已在其他窗口改变，请取消编辑后重新读取");
  const previous = decode(current);
  if (previous.error) throw new Error(previous.error);
  const valid = validatePriceBook(book);
  if (!valid.book) throw new Error(valid.error ?? "价格配置无效");
  const raw = JSON.stringify(valid.book);
  if (new TextEncoder().encode(raw).length > MAX_PRICE_BYTES) throw new Error("价格存档超过大小上限");
  port.setItem(PRICE_BOOK_KEY, raw);
  if (port.getItem(PRICE_BOOK_KEY) !== raw) throw new Error("价格保存后回读不一致，请重新读取");
  return { book: valid.book, raw, error: null };
}

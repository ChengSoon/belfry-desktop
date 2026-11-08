import { TranslationError, t } from "../../i18n";
import { emptyPriceBook, MAX_PRICE_BYTES, PRICE_BOOK_KEY, type PriceBook, type PriceBookState } from "./contracts";
import { validatePriceBook } from "./validation";

type StoragePort = Pick<Storage, "getItem" | "setItem">;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function decode(raw: string | null): PriceBookState {
  if (raw === null) return { book: emptyPriceBook(), raw, error: null };
  try {
    if (new TextEncoder().encode(raw).length > MAX_PRICE_BYTES) throw new TranslationError("usage.storage.text_f49cc4f526");
    const result = validatePriceBook(JSON.parse(raw));
    if (!result.book) throw new Error(result.error ?? t("usage.storage.text_805bb686e7"));
    return { book: result.book, raw, error: null };
  } catch (error) {
    return { book: emptyPriceBook(), raw, get error() { return t("usage.storage.text_9e2810a300", { error: errorText(error) }); } };
  }
}

export function loadPriceBook(storage?: StoragePort): PriceBookState {
  try { return decode((storage ?? window.localStorage).getItem(PRICE_BOOK_KEY)); }
  catch (error) { return { book: emptyPriceBook(), raw: null, get error() { return errorText(error); } }; }
}

export function savePriceBook(book: PriceBook, expectedRaw: string | null, storage?: StoragePort): PriceBookState {
  const port = storage ?? window.localStorage;
  const current = port.getItem(PRICE_BOOK_KEY);
  if (current !== expectedRaw) throw new TranslationError("usage.storage.text_1e7d969426");
  const previous = decode(current);
  if (previous.error) throw new Error(previous.error);
  const valid = validatePriceBook(book);
  if (!valid.book) throw new Error(valid.error ?? t("usage.storage.text_00958447a1"));
  const raw = JSON.stringify(valid.book);
  if (new TextEncoder().encode(raw).length > MAX_PRICE_BYTES) throw new TranslationError("usage.storage.text_f6c4532934");
  port.setItem(PRICE_BOOK_KEY, raw);
  if (port.getItem(PRICE_BOOK_KEY) !== raw) throw new TranslationError("usage.storage.text_55024d7373");
  return { book: valid.book, raw, error: null };
}

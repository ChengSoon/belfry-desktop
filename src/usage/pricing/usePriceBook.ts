import { useCallback, useEffect, useState } from "react";
import { PRICE_BOOK_CHANGED, PRICE_BOOK_KEY, type PriceBook } from "./contracts";
import { loadPriceBook, savePriceBook } from "./storage";

export function usePriceBook() {
  const [state, setState] = useState(() => loadPriceBook());
  const reload = useCallback(() => setState(loadPriceBook()), []);
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (!event.key || event.key === PRICE_BOOK_KEY) reload(); };
    window.addEventListener("storage", changed);
    window.addEventListener(PRICE_BOOK_CHANGED, reload);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener(PRICE_BOOK_CHANGED, reload);
    };
  }, [reload]);
  const save = useCallback((book: PriceBook, raw: string | null) => {
    try {
      setState(savePriceBook(book, raw));
      window.dispatchEvent(new Event(PRICE_BOOK_CHANGED));
      return null;
    } catch (error) { return error instanceof Error ? error.message : String(error); }
  }, []);
  return { ...state, save, reload };
}

export type PriceBookModel = ReturnType<typeof usePriceBook>;

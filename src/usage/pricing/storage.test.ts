import { expect, it, vi } from "vitest";
import { loadPriceBook, savePriceBook } from "./storage";
import { emptyPriceBook, PRICE_BOOK_KEY, type PriceBook } from "./contracts";

function memory(raw: string | null = null) {
  const items = new Map(raw === null ? [] : [[PRICE_BOOK_KEY, raw]]);
  return { items, getItem: (key: string) => items.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { items.set(key, value); }) };
}

it("缺少价格存档时保留空价格表，不写入假定费率", () => {
  const storage = memory();
  expect(loadPriceBook(storage)).toEqual({ book: emptyPriceBook(), raw: null, error: null });
  expect(storage.setItem).not.toHaveBeenCalled();
});

it("显式保存后可重载，保存时核对原内容防止覆盖其他窗口", () => {
  const storage = memory();
  const saved = savePriceBook(emptyPriceBook(), null, storage);
  expect(loadPriceBook(storage)).toEqual(saved);
  storage.setItem(PRICE_BOOK_KEY, '{"version":1,"rules":[],"changed":true}');
  expect(() => savePriceBook(emptyPriceBook(), saved.raw, storage)).toThrow("其他窗口");
  expect(storage.getItem(PRICE_BOOK_KEY)).toContain('"changed":true');
});

it("损坏或新版本的价格表保留原文并阻止直接覆盖", () => {
  for (const raw of ["invalid json", '{"version":99,"rules":[]}']) {
    const storage = memory(raw);
    expect(loadPriceBook(storage).error).toBeTruthy();
    expect(storage.getItem(PRICE_BOOK_KEY)).toBe(raw);
    expect(() => savePriceBook(emptyPriceBook(), raw, storage)).toThrow();
    expect(storage.setItem).not.toHaveBeenCalled();
  }
});

it("读取、写入和写后回读失败不被报告为成功", () => {
  const denied = { getItem: () => { throw new Error("存储不可用"); }, setItem: vi.fn() };
  expect(loadPriceBook(denied).error).toContain("存储不可用");
  const full = { getItem: () => null, setItem: () => { throw new Error("空间不足"); } };
  expect(() => savePriceBook(emptyPriceBook(), null, full)).toThrow("空间不足");
  const lost = { getItem: () => null, setItem: vi.fn() };
  expect(() => savePriceBook(emptyPriceBook(), null, lost)).toThrow("回读");
});

it("无效价格不能被写入", () => {
  const storage = memory();
  expect(() => savePriceBook({ version: 2, rules: [] } as unknown as PriceBook, null, storage)).toThrow();
  expect(storage.setItem).not.toHaveBeenCalled();
});

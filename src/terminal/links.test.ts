import { describe, expect, it } from "vitest";
import { findFilePaths, findHttpUrls } from "./links";

describe("terminal HTTP links", () => {
  it("extracts HTTP and HTTPS URLs while trimming sentence punctuation", () => {
    expect(findHttpUrls("see https://example.com/docs, then http://localhost:3000/test!")).toEqual([
      { url: "https://example.com/docs", offset: 4 },
      { url: "http://localhost:3000/test", offset: 35 },
    ]);
  });

  it("keeps balanced parentheses and rejects other protocols", () => {
    expect(findHttpUrls("https://example.com/a_(b) ftp://example.com ssh://host")).toEqual([
      { url: "https://example.com/a_(b)", offset: 0 },
    ]);
  });

  it("returns no links for plain text", () => {
    expect(findHttpUrls("nothing to open")).toEqual([]);
  });
});

describe("terminal file links", () => {
  it("extracts relative, absolute, and file URI paths with locations", () => {
    expect(findFilePaths("error src/App.tsx:12 /tmp/main.rs:8 file:///work/demo/a.py:4:2")).toEqual([
      { path: "src/App.tsx", line: 12, column: null, text: "src/App.tsx:12", offset: 6 },
      { path: "/tmp/main.rs", line: 8, column: null, text: "/tmp/main.rs:8", offset: 21 },
      { path: "file:///work/demo/a.py", line: 4, column: 2, text: "file:///work/demo/a.py:4:2", offset: 36 },
    ]);
  });

  it("trims shell punctuation and ignores URL protocols", () => {
    expect(findFilePaths("see (src/App.tsx:3), https://example.com/app.tsx ssh://host/a.rs")).toEqual([
      { path: "src/App.tsx", line: 3, column: null, text: "src/App.tsx:3", offset: 5 },
    ]);
  });

  it("accepts Windows paths and parenthesized locations", () => {
    expect(findFilePaths("C:\\work\\app\\main.rs(10,4)")).toEqual([
      { path: "C:\\work\\app\\main.rs", line: 10, column: 4, text: "C:\\work\\app\\main.rs(10,4)", offset: 0 },
    ]);
  });
});

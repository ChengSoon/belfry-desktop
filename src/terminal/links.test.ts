import { describe, expect, it } from "vitest";
import { findHttpUrls } from "./links";

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

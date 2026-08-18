import { describe, expect, it } from "vitest";
import { DEFAULT_BACKGROUND } from "./contracts";
import { loadBackground, parseBackground } from "./storage";

const complete = {
  fileName: "background.png",
  mime: "image/png",
  fit: "contain",
  opacity: 0.6,
  blur: 12,
  veil: 0.3,
  videoPaused: false,
};

describe("background config persistence", () => {
  it("round-trips a complete config", () => {
    expect(parseBackground(JSON.stringify(complete))).toEqual(complete);
  });

  it("falls back to the default for anything unparseable", () => {
    expect(parseBackground(null)).toEqual(DEFAULT_BACKGROUND);
    expect(parseBackground("")).toEqual(DEFAULT_BACKGROUND);
    expect(parseBackground("{ not json")).toEqual(DEFAULT_BACKGROUND);
    expect(parseBackground('"a string"')).toEqual(DEFAULT_BACKGROUND);
    expect(parseBackground("null")).toEqual(DEFAULT_BACKGROUND);
    expect(parseBackground("[]")).toEqual(DEFAULT_BACKGROUND);
  });

  /* devtools 里手改坏一个字段，不该把整份配置连坐掉。 */
  it("repairs each field independently", () => {
    const parsed = parseBackground(
      JSON.stringify({ ...complete, fit: "diagonal", opacity: 99 }),
    );
    expect(parsed.fit).toBe(DEFAULT_BACKGROUND.fit);
    expect(parsed.opacity).toBe(1);
    // 同一份 JSON 里没坏的字段照旧保留
    expect(parsed.fileName).toBe("background.png");
    expect(parsed.blur).toBe(12);
  });

  it("clamps the numeric ranges instead of trusting them", () => {
    const low = parseBackground(JSON.stringify({ opacity: -5, blur: -3, veil: -1 }));
    expect(low.opacity).toBe(0);
    expect(low.blur).toBe(0);
    expect(low.veil).toBe(0);

    const high = parseBackground(JSON.stringify({ opacity: 4, blur: 9999, veil: 2 }));
    expect(high.opacity).toBe(1);
    expect(high.blur).toBe(40);
    expect(high.veil).toBe(1);
  });

  /* veil 是后加的字段：旧版本存的 JSON 里没有它，必须落回默认值而不是 0——
     否则升级上来的用户第一眼看到的就是文字裸压在图上的旧毛病。 */
  it("defaults veil for configs saved before it existed", () => {
    const legacy = { ...complete } as Record<string, unknown>;
    delete legacy.veil;
    expect(parseBackground(JSON.stringify(legacy)).veil).toBe(DEFAULT_BACKGROUND.veil);
  });

  it("defaults playback state for configs saved before video wallpapers existed", () => {
    const legacy = { ...complete } as Record<string, unknown>;
    delete legacy.videoPaused;
    expect(parseBackground(JSON.stringify(legacy)).videoPaused).toBe(false);
  });

  /* NaN 落到 CSS 变量里会让整条规则失效，背景直接不显示，所以要退回默认值而不是 0。 */
  it("rejects non-finite and non-number values", () => {
    const parsed = parseBackground('{"opacity": "0.5", "blur": null}');
    expect(parsed.opacity).toBe(DEFAULT_BACKGROUND.opacity);
    expect(parsed.blur).toBe(DEFAULT_BACKGROUND.blur);
  });

  it("treats an empty file name as no background", () => {
    expect(parseBackground('{"fileName": ""}').fileName).toBeNull();
    expect(parseBackground('{"fileName": 42}').fileName).toBeNull();
  });

  it("falls back to the default when storage throws", () => {
    const storage = {
      getItem() {
        throw new Error("storage disabled");
      },
    };
    expect(loadBackground(storage)).toEqual(DEFAULT_BACKGROUND);
  });
});

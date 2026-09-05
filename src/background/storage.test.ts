import { describe, expect, it } from "vitest";
import { DEFAULT_BACKGROUND } from "./contracts";
import { loadBackground, parseBackground } from "./storage";

const complete = {
  fileName: "background.png",
  mime: "image/png",
  fit: "contain",
  opacity: 0.6,
  blur: 12,
  veil: { dark: 0.3, light: 0.9 },
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
    const low = parseBackground(
      JSON.stringify({ opacity: -5, blur: -3, veil: { dark: -1, light: -1 } }),
    );
    expect(low.opacity).toBe(0);
    expect(low.blur).toBe(0);
    expect(low.veil).toStrictEqual({ dark: 0, light: 0 });

    const high = parseBackground(
      JSON.stringify({ opacity: 4, blur: 9999, veil: { dark: 2, light: 2 } }),
    );
    expect(high.opacity).toBe(1);
    expect(high.blur).toBe(40);
    expect(high.veil).toStrictEqual({ dark: 1, light: 1 });
  });

  /* veil 是后加的字段：旧版本存的 JSON 里没有它，必须落回默认值而不是 0——
     否则升级上来的用户第一眼看到的就是文字裸压在图上的旧毛病。 */
  it("defaults veil for configs saved before it existed", () => {
    const legacy = { ...complete } as Record<string, unknown>;
    delete legacy.veil;
    expect(parseBackground(JSON.stringify(legacy)).veil).toStrictEqual(DEFAULT_BACKGROUND.veil);
  });

  /* veil 又从单一数值拆成了亮暗两份。旧值只继承给暗色：那时候滑块是主题无关的一根，
     用户没有为亮色单独定过浓度，而亮色恰恰是浓度不够、这次要修的那一侧。 */
  it("migrates a legacy single veil number into the dark slot only", () => {
    const parsed = parseBackground(JSON.stringify({ ...complete, veil: 0.2 }));
    expect(parsed.veil).toStrictEqual({ dark: 0.2, light: DEFAULT_BACKGROUND.veil.light });
  });

  /* 半个对象、或被改成字符串的那一份，只坏它自己。 */
  it("repairs one veil slot without dragging the other down", () => {
    expect(parseBackground('{"veil": {"dark": 0.1}}').veil).toStrictEqual({
      dark: 0.1,
      light: DEFAULT_BACKGROUND.veil.light,
    });
    expect(parseBackground('{"veil": {"dark": "0.1", "light": 0.7}}').veil).toStrictEqual({
      dark: DEFAULT_BACKGROUND.veil.dark,
      light: 0.7,
    });
    expect(parseBackground('{"veil": null}').veil).toStrictEqual(DEFAULT_BACKGROUND.veil);
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { xtermTheme } from "../theme/xtermTheme";
import { loadTerminalFonts, terminalFontWeights } from "./fontRendering";

const FONT_OPTIONS = { fontFamily: '"JetBrains Mono", "HarmonyOS Sans SC", monospace', fontSize: 15 };

describe("终端字体加载", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("亮色下同时加载测宽、正文、粗体及中文字体", async () => {
    const load = vi.fn().mockResolvedValue([]);
    vi.stubGlobal("document", { fonts: { load } });
    await loadTerminalFonts({ ...FONT_OPTIONS, ...terminalFontWeights(xtermTheme("light")) });
    expect(load.mock.calls.map(([font]) => font)).toEqual([
      `400 15px ${FONT_OPTIONS.fontFamily}`,
      `500 15px ${FONT_OPTIONS.fontFamily}`,
      `600 15px ${FONT_OPTIONS.fontFamily}`,
    ]);
    expect(load.mock.calls.every(([, sample]) => /[a-z]/i.test(sample) && /\p{Script=Han}/u.test(sample))).toBe(true);
  });

  it("暗色加载必要字重且不重复请求 Regular", async () => {
    const load = vi.fn().mockResolvedValue([]);
    vi.stubGlobal("document", { fonts: { load } });
    await loadTerminalFonts({ ...FONT_OPTIONS, ...terminalFontWeights(xtermTheme("dark")) });
    expect(load.mock.calls.map(([font]) => font)).toEqual([
      `400 15px ${FONT_OPTIONS.fontFamily}`,
      `500 15px ${FONT_OPTIONS.fontFamily}`,
    ]);
  });

  it("某一字重失败后仍等待其余字体就绪，避免刷新时再次缓存回退字形", async () => {
    let resolveMedium!: (faces: FontFace[]) => void;
    const medium = new Promise<FontFace[]>((resolve) => { resolveMedium = resolve; });
    const finished = vi.fn();
    const load = vi.fn().mockImplementation((font: string) =>
      font.startsWith("500") ? medium : Promise.reject(new Error("font unavailable")),
    );
    vi.stubGlobal("document", { fonts: { load } });
    const pending = loadTerminalFonts({ ...FONT_OPTIONS, ...terminalFontWeights(xtermTheme("light")) }).then(finished);
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    resolveMedium([]);
    await pending;
    expect(finished).toHaveBeenCalledOnce();
  });

  it("没有 Font Loading API 时保留系统字体回退", async () => {
    vi.stubGlobal("document", {});
    await expect(loadTerminalFonts(FONT_OPTIONS)).resolves.toBeUndefined();
  });
});

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import canvas from "./canvas.json";
import backdrop from "./backdrop.json";

// 补 graphite.test 的两处盲区：
// 1. 原生窗口底色（window_reveal.rs ← backdrop.json）与 styles.css 的 --backdrop 之间的一致性；
// 2. graphite.test 的 palette() 只收 #rrggbb，rgb(... / a%) 写的 soft 底色和描边整组被跳过，
//    Notice 正文/图标/动作按钮落在 danger-soft / warning-soft 上的对比度从未被测。
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8")
  .replace(/var\(--theme-canvas-(dark|light)\)/g, (_, mode) => canvas[mode]);
const rust = readFileSync(new URL("../../src-tauri/src/window_reveal.rs", import.meta.url), "utf8");

const block = mode => css.match(new RegExp(`\\[data-theme="${mode}"\\]\\s*\\{([^}]+)\\}`))[1];
const token = (mode, name) => block(mode).match(new RegExp(`--${name}:\\s*([^;]+);`))[1].trim();
const parse = value => {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return { rgb: hex[1].match(/../g).map(v => parseInt(v, 16)), alpha: 1 };
  const fn = value.match(/^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)%\)$/);
  if (fn) return { rgb: fn.slice(1, 4).map(Number), alpha: Number(fn[4]) / 100 };
  throw new Error(`Unsupported color ${value}`);
};
const over = (fg, bg) => fg.rgb.map((v, i) => v * fg.alpha + bg[i] * (1 - fg.alpha));
const luminance = rgb => rgb.map(v => v / 255)
  .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};
const resolve = (mode, name) => {
  const value = token(mode, name);
  const alias = value.match(/^var\(--([\w-]+)\)$/);
  return alias ? resolve(mode, alias[1]) : value;
};

it("backdrop.json (native window + theme-color) matches --backdrop for both themes", () => {
  for (const mode of ["dark", "light"]) expect(backdrop[mode]).toBe(token(mode, "backdrop"));
});

it("window_reveal.rs reads backdrop.json and its fallbacks match it", () => {
  expect(rust).toContain('include_str!("../../src/theme/backdrop.json")');
  const hex = match => "#" + match.slice(1, 4).map(v => Number(v).toString(16).padStart(2, "0")).join("");
  const dark = rust.match(/Mode::Dark => Color\((0x[0-9a-f]{2}), (0x[0-9a-f]{2}), (0x[0-9a-f]{2})/i);
  const light = rust.match(/Mode::Light => Color\((0x[0-9a-f]{2}), (0x[0-9a-f]{2}), (0x[0-9a-f]{2})/i);
  expect(hex(dark)).toBe(backdrop.dark);
  expect(hex(light)).toBe(backdrop.light);
});

for (const mode of ["dark", "light"]) {
  it(`${mode}: Notice text, icon and action stay readable on translucent tone backgrounds`, () => {
    for (const surface of ["canvas", "panel", "surface", "surface-raised"]) {
      const base = parse(resolve(mode, surface)).rgb;
      for (const tone of ["danger", "warning"]) {
        const background = over(parse(resolve(mode, `${tone}-soft`)), base);
        const pairs = { "text-muted": 4.5, accent: 4.5, [tone]: 3 };
        for (const [fg, minimum] of Object.entries(pairs)) {
          expect(contrast(parse(resolve(mode, fg)).rgb, background), `${fg} on ${tone}-soft/${surface}`)
            .toBeGreaterThanOrEqual(minimum);
        }
      }
    }
  });
}

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { xtermTheme } from "./xtermTheme";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const palette = mode => {
  const block = css.match(new RegExp(`\\[data-theme="${mode}"\\]\\s*\\{([^}]+)\\}`))[1];
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/g)].map(m => [m[1], m[2]]));
};
const luminance = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
  .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};
for (const mode of ["dark", "light"]) {
  it(`${mode}: UI and terminal share Graphite canvas/foreground/scrollbar`, () => {
    const p = palette(mode), terminal = xtermTheme(mode);
    expect(terminal.background).toBe(p.canvas);
    expect(terminal.foreground).toBe(p.text);
    expect(terminal.scrollbarSliderBackground).toBe(p.scrollbar);
  });
  it(`${mode}: text tiers remain readable on every standard surface`, () => {
    const p = palette(mode);
    for (const text of ["text", "text-muted", "text-faint"]) {
      for (const surface of ["canvas", "panel", "sidebar", "surface", "surface-raised", "surface-hover"]) {
        expect(contrast(p[text], p[surface]), `${text}/${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
}

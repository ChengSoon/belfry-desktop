import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { EXIT_MS } from "../components/motion/Presence";
import { THEME_MODE_KEY } from "./storage";
import { xtermTheme } from "./xtermTheme";
import canvas from "./canvas.json";
import backdrop from "./backdrop.json";
import { renderCanvasHtml, themeCanvasPlugin } from "../../scripts/theme-canvas";

const sourceCss = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const css = sourceCss.replace(/var\(--theme-canvas-(dark|light)\)/g, (_, mode) => canvas[mode]);
const startup = readFileSync(new URL("../../public/startup.js", import.meta.url), "utf8");
const sourceHtml = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const html = renderCanvasHtml(sourceHtml, canvas, backdrop);
function startupDocument(markup = html) {
  const meta = Object.fromEntries([...markup.matchAll(/<meta name="([^"]+)" content="([^"]+)"/g)]
    .map(([, name, content]) => [name, { content }]));
  return { documentElement: { dataset: {} }, querySelector: selector => meta[selector.match(/name="([^"]+)"/)[1]] };
}
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
  it(`${mode}: UI and terminal share canvas/foreground/scrollbar`, () => {
    const p = palette(mode), terminal = xtermTheme(mode);
    expect(terminal.background).toBe(p.canvas);
    expect(terminal.foreground).toBe(p.text);
    expect(terminal.scrollbarSliderBackground).toBe(p.scrollbar);
  });
  it(`${mode}: text tiers remain readable on every standard surface`, () => {
    const p = palette(mode);
    for (const text of ["text", "text-muted", "text-faint", "accent", "success", "warning", "danger", "info"]) {
      for (const surface of ["canvas", "panel", "sidebar", "surface", "surface-raised", "surface-hover", "sidebar-active"]) {
        expect(contrast(p[text], p[surface]), `${text}/${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it(`${mode}: controls, selection and primary actions retain sufficient contrast`, () => {
    const p = palette(mode);
    expect(contrast(p["border-strong"], p.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.accent, p["sidebar-active"])).toBeGreaterThanOrEqual(3);
    expect(contrast(p["accent-contrast"], p.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.text, p["accent-soft"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.accent, p["accent-soft"])).toBeGreaterThanOrEqual(4.5);
    expect(p.success).not.toBe(p.accent);
  });
}

for (const [saved, systemLight, expected] of [
  ["dark", true, "dark"],
  ["light", false, "light"],
  [null, false, "dark"],
  [null, true, "light"],
  ["invalid", true, "light"],
]) {
  it(`first paint matches CSS/xterm for saved=${saved}, systemLight=${systemLight}`, () => {
    const document = startupDocument();
    runInNewContext(startup, {
      localStorage: { getItem: key => { expect(key).toBe(THEME_MODE_KEY); return saved; } },
      window: { matchMedia: query => { expect(query).toBe("(prefers-color-scheme: light)"); return { matches: systemLight }; } },
      document,
      navigator: { userAgent: "Windows" },
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    expect(document.documentElement.dataset.theme).toBe(expected);
    // theme-color 跟窗口底（backdrop）走；内容面 canvas 与 xterm 背景一致。
    expect(meta.content).toBe(palette(expected).backdrop);
    expect(palette(expected).canvas).toBe(xtermTheme(expected).background);
  });
}

it("first paint and HTML have a matching dark fallback when storage is unavailable", () => {
  const document = startupDocument();
  runInNewContext(startup, {
    localStorage: { getItem: () => { throw new Error("storage unavailable"); } },
    window: { matchMedia: () => ({ matches: true }) },
    document,
    navigator: { userAgent: "Mac" },
  });
  const fallback = html.match(/<meta name="theme-color" content="([^"]+)"/)[1];
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.querySelector('meta[name="theme-color"]').content).toBe(fallback);
  expect(fallback).toBe(palette("dark").backdrop);
});

it("one palette change feeds HTML, CSS and first paint without editing each consumer", () => {
  const next = { dark: "#121314", light: "#fdfcfb" };
  const nextBackdrop = { dark: "#010203", light: "#e0e1e2" };
  const plugin = themeCanvasPlugin(next, nextBackdrop);
  const nextCss = plugin.transform(sourceCss, "/workspace/src/styles.css").code;
  const nextHtml = plugin.transformIndexHtml.handler(sourceHtml);
  expect(nextCss).toContain(`--theme-canvas-dark: ${next.dark}`);
  expect(nextCss).toContain(`--theme-canvas-light: ${next.light}`);
  expect(nextHtml).toContain(`name="belfry-canvas-dark" content="${next.dark}"`);
  expect(nextHtml).toContain(`name="belfry-canvas-light" content="${next.light}"`);
  expect(nextHtml).toContain(`name="belfry-backdrop-dark" content="${nextBackdrop.dark}"`);
  expect(nextHtml).toContain(`name="belfry-backdrop-light" content="${nextBackdrop.light}"`);
  expect(nextHtml).not.toMatch(/%BELFRY_(CANVAS|BACKDROP)_/);
  for (const mode of ["dark", "light"]) {
    const document = startupDocument(nextHtml);
    runInNewContext(startup, { document, localStorage: { getItem: () => mode }, navigator: { userAgent: "Mac" } });
    expect(document.querySelector('meta[name="theme-color"]').content).toBe(nextBackdrop[mode]);
  }
});

it("startup keeps the platform marker even when theme metas are missing", () => {
  const document = { documentElement: { dataset: {} }, querySelector: () => null };
  expect(() => runInNewContext(startup, { document, localStorage: { getItem: () => "light" }, navigator: { userAgent: "Windows" } })).not.toThrow();
  expect(document.documentElement.dataset).toEqual({ theme: "light", platform: "windows" });
});

it("drawer exit duration stays aligned with the Presence removal timer", () => {
  const exitMs = Number(css.match(/--motion-exit:\s*(\d+)ms;/)[1]);
  expect(exitMs).toBe(180);
  expect(exitMs).toBe(EXIT_MS);
});

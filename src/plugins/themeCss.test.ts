import { describe, expect, it } from "vitest";
import { sanitizeThemeCss, THEME_CSS_MAX_BYTES } from "./themeCss";

describe("PI theme stylesheets", () => {
  it("preserves complete CSS including variables, media queries and animations", () => {
    const css = ':root { --ds-bg-primary: color-mix(in srgb, #123 40%, black); } @media (min-width: 1px) { .x { animation: glow 1s; } } @keyframes glow { to { opacity: .5; } }';
    expect(sanitizeThemeCss(css)).toEqual({ ok: true, css });
    expect(sanitizeThemeCss(':root { --art: url("data:image/png;base64,AAAA"); }').ok).toBe(true);
    expect(sanitizeThemeCss(`/* ${"x".repeat(70_000)} */ :root { --ds-accent: red; }`).ok).toBe(true);
  });
  it("rejects external references even when escaped or hidden in image-set", () => {
    for (const css of [
      '@import "https://example.invalid/a.css";',
      String.raw`@\69mport "https://example.invalid/a.css";`,
      String.raw`body { background: u\72l("https://example.invalid/a"); }`,
      'body { background: image-set("https://example.invalid/a" 1x); }',
      'body { background: url("unterminated); }',
      '</style><script>alert(1)</script>',
      `/* ${"字".repeat(THEME_CSS_MAX_BYTES / 2)} */`,
    ]) expect(sanitizeThemeCss(css).ok, css.slice(0, 80)).toBe(false);
  });
});

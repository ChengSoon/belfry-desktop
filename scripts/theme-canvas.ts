import type { Plugin } from "vite";

type CanvasPalette = Record<"dark" | "light", string>;

// The config imports canvas.json directly so Vite restarts when its values change.
// backdrop（窗口底）进 theme-color 与原生窗口底色；canvas（内容面）进 CSS 与 xterm。
export function renderCanvasHtml(html: string, canvas: CanvasPalette, backdrop: CanvasPalette) {
  return html.replaceAll("%BELFRY_CANVAS_DARK%", canvas.dark)
    .replaceAll("%BELFRY_CANVAS_LIGHT%", canvas.light)
    .replaceAll("%BELFRY_BACKDROP_DARK%", backdrop.dark)
    .replaceAll("%BELFRY_BACKDROP_LIGHT%", backdrop.light);
}

export function themeCanvasPlugin(canvas: CanvasPalette, backdrop: CanvasPalette) {
  for (const [name, palette] of [["canvas", canvas], ["backdrop", backdrop]] as const) {
    for (const mode of ["dark", "light"] as const) {
      if (!/^#[0-9a-f]{6}$/i.test(palette[mode])) throw new Error(`Invalid ${mode} ${name} color`);
    }
  }
  const variables = `:root { --theme-canvas-dark: ${canvas.dark}; --theme-canvas-light: ${canvas.light}; }\n`;
  return {
    name: "belfry-theme-canvas",
    enforce: "pre",
    transform(source, id) {
      if (id.replaceAll("\\", "/").split("?")[0].endsWith("/src/styles.css")) {
        return { code: variables + source, map: null };
      }
    },
    transformIndexHtml: { order: "pre", handler: html => renderCanvasHtml(html, canvas, backdrop) },
  } satisfies Plugin;
}

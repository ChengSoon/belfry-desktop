// 曜石 Obsidian 令牌对比度核算（T5）。用法：node docs/design/belfry-ui/obsidian-contrast.mjs
// 输出 obsidian-tokens.md 里的对比度表；改任何色值后重跑，并把结果贴回文档。
// 半透明令牌按其实际铺设的底色合成后再算。

const T = {
  dark: {
    sidebar: "#0c0d10", canvas: "#131418", panel: "#16171b", surface: "#1a1c21",
    raised: "#1d1f24", hover: "#212328", "sidebar-active": "#1c1e23", "accent-soft": "#25284a",
    text: "#ecedf0", muted: "#b0b2ba", faint: "#8c8f99",
    accent: "#8b93ff", "accent-contrast": "#0c0d10", success: "#5fd4a0", warning: "#f2c46b",
    danger: "#ff8a80", info: "#7ab8f0", "brand-claude": "#d9825b", border: "#26282e", "border-strong": "#60646f",
    ansi: { background: "#131418", foreground: "#ecedf0", black: "#2a2c33", red: "#ff7b72", green: "#5fd4a0",
      yellow: "#f2c46b", blue: "#5aa9f0", magenta: "#d08be8", cyan: "#5cc8d0", white: "#c9cbd2",
      brightBlack: "#6e717c", brightRed: "#ffa198", brightGreen: "#85e3b9", brightYellow: "#f7d58f",
      brightBlue: "#86c3f7", brightMagenta: "#e0aaf2", brightCyan: "#85dce2", brightWhite: "#f5f6f8" },
  },
  light: {
    sidebar: "#ececef", canvas: "#ffffff", panel: "#fafafb", surface: "#f4f4f6",
    raised: "#ffffff", hover: "#e9e9ed", "sidebar-active": "#e4e4ea", "accent-soft": "#ebecfc",
    text: "#16171c", muted: "#474a54", faint: "#5b5e68",
    accent: "#484ed4", "accent-contrast": "#ffffff", success: "#0f6c48", warning: "#835500",
    danger: "#b02c25", info: "#195f9c", "brand-claude": "#b8653f", border: "#e1e1e6", "border-strong": "#8e909a",
    ansi: { background: "#ffffff", foreground: "#16171c", black: "#26272b", red: "#c4342a", green: "#12875a",
      yellow: "#9a6b0f", blue: "#1d6fb8", magenta: "#a23aa8", cyan: "#0e7490", white: "#4a4c53",
      brightBlack: "#8e909a", brightRed: "#d94334", brightGreen: "#16a06c", brightYellow: "#b8811a",
      brightBlue: "#2f86d6", brightMagenta: "#bf52c4", brightCyan: "#128aa8", brightWhite: "#17181b" },
  },
};

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => {
  const c = rgb(h).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hue = (h) => {
  const [r, g, b] = rgb(h).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const k = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((k * 60 + 360) % 360);
};

const surfaces = ["sidebar", "canvas", "panel", "surface", "raised", "hover", "sidebar-active"];
const inks = ["text", "muted", "faint", "accent", "success", "warning", "danger", "info"];
let fail = 0;
for (const mode of ["dark", "light"]) {
  const t = T[mode];
  console.log(`\n#### ${mode === "dark" ? "暗色" : "亮色"}：文字 × 表面\n`);
  console.log(`| 文字 \\ 表面 | ${surfaces.join(" | ")} | 最小 |`);
  console.log(`| --- | ${surfaces.map(() => "---:").join(" | ")} | ---: |`);
  for (const ink of inks) {
    const rs = surfaces.map((s) => ratio(t[ink], t[s]));
    const min = Math.min(...rs);
    if (min < 4.5) fail++;
    console.log(`| ${ink} | ${rs.map((r) => r.toFixed(2)).join(" | ")} | **${min.toFixed(2)}** |`);
  }
  const extra = [
    ["accent-contrast on accent（实心主按钮）", t["accent-contrast"], t.accent, 4.5],
    ["text on accent-soft（候选/轻强调）", t.text, t["accent-soft"], 4.5],
    ["accent on accent-soft", t.accent, t["accent-soft"], 4.5],
    ["border-strong on canvas（控件描边，非文本）", t["border-strong"], t.canvas, 3],
    ["accent on sidebar-active（2px 竖条，非文本）", t.accent, t["sidebar-active"], 3],
    ["accent on canvas（焦点环，非文本）", t.accent, t.canvas, 3],
    // L9：Claude 品牌橙只用于图标块（非文本），按 3:1 核算其可能落的所有表面。
    ...surfaces.map((s) => [`brand-claude on ${s}（图标，非文本）`, t["brand-claude"], t[s], 3]),
  ];
  console.log(`\n| 组合 | 对比度 | 要求 |\n| --- | ---: | ---: |`);
  for (const [n, a, b, need] of extra) {
    const r = ratio(a, b);
    if (r < need) fail++;
    console.log(`| ${n} | ${r.toFixed(2)} | ≥${need} |`);
  }
  const a = t.ansi;
  console.log(`\n终端（背景 ${a.background}）：`);
  console.log(`| 色号 | 值 | 对比度 |\n| --- | --- | ---: |`);
  for (const [k, v] of Object.entries(a)) if (k !== "background") console.log(`| ${k} | \`${v}\` | ${ratio(v, a.background).toFixed(2)} |`);
  console.log(`\n强调靛蓝 ${t.accent} 色相 ${hue(t.accent)}°；ANSI blue ${a.blue} ${hue(a.blue)}°、brightBlue ${a.brightBlue} ${hue(a.brightBlue)}°、magenta ${a.magenta} ${hue(a.magenta)}°`);
}
console.log(fail ? `\n✗ ${fail} 项未达标` : "\n✓ 全部达标");
process.exitCode = fail ? 1 : 0;

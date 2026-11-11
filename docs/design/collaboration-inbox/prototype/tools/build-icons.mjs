// 从 lucide-react 生成原型用的内联 SVG 表：node tools/build-icons.mjs <lucide-react/dist/esm/icons 目录>
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = process.argv[2];
const names = ["Inbox","Users","MessagesSquare","History","CircleCheck","Play","Sun","Moon","Pause","ArrowUp","ArrowRight","ArrowUpFromLine","CheckCheck","Clock3","Layers","Send","Undo2","Reply","FileText","ChevronRight","ListTodo","Lock","TriangleAlert","WifiOff","RotateCcw","CircleHelp","Hourglass","Link","Terminal","ChevronDown","X","SlidersHorizontal","Power","CornerDownRight","Info","Search"];
const kebab = (s) => ({ History: "rotate-ccw-clock", CircleHelp: "circle-question-mark" })[s] ?? s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([a-zA-Z])([0-9])/g, "$1-$2").toLowerCase();
const out = {};
for (const n of names) {
  const { __iconNode } = await import(pathToFileURL(join(dir, `${kebab(n)}.mjs`)).href);
  const body = __iconNode.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
  out[n] = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
writeFileSync(new URL("../icons.js", import.meta.url), `// 由 tools/build-icons.mjs 从 lucide-react（ISC）生成，勿手改。\nwindow.BELFRY_ICONS = ${JSON.stringify(out, null, 0)};\n`);
console.log(Object.keys(out).length, "icons");

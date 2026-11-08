// One-time source preparation: retain whole sentences before catalog extraction.
import { readFile, writeFile } from "node:fs/promises";
import { sourceFiles, inspect, walk, jsxText, hasChinese } from "./i18n-source.mjs";

const modules = new Set((process.argv.find(arg => arg.startsWith("--modules=")) ?? "").slice(10).split(","));
const excluded = new Set((process.argv.find(arg => arg.startsWith("--exclude=")) ?? "--exclude=").slice(10).split(","));
const quote = text => text.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
function contains(node, condition) { let found = false; walk(node, child => { if (condition(child)) found = true; }); return found; }
function apply(source, edits) {
  const outer = edits.filter(edit => !edits.some(other => other !== edit && other.start <= edit.start && other.end >= edit.end));
  for (const edit of outer.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}
for (const file of await sourceFiles()) {
  if (excluded.has(file)) continue;
  if (!modules.has(file.split("/")[1])) continue;
  let source = await readFile(file, "utf8");
  const original = source;
  let edits = [];
  const concatenation = node => node.type === "BinaryExpression" && node.operator === "+" && contains(node, child => child.type === "StringLiteral");
  walk(inspect(source, file).ast, node => {
    if (!concatenation(node) || !contains(node, child => child.type === "StringLiteral" && hasChinese(child.value))) return;
    const parts = [];
    function flatten(child) {
      if (concatenation(child)) { flatten(child.left); flatten(child.right); }
      else parts.push(child.type === "StringLiteral" ? quote(child.value) : "${" + source.slice(child.start, child.end) + "}");
    }
    flatten(node);
    edits.push({ start: node.start, end: node.end, text: "`" + parts.join("") + "`" });
  });
  source = apply(source, edits); edits = [];
  walk(inspect(source, file).ast, node => {
    if (!/^(JSXElement|JSXFragment)$/.test(node.type)) return;
    let run = [];
    function flush() {
      if (run.some(child => child.type === "JSXText" && hasChinese(child.value)) && run.some(child => child.type === "JSXExpressionContainer")) {
        const parts = run.map(child => child.type === "JSXText" ? quote(jsxText(child.value)) : child.expression.type === "StringLiteral" ? quote(child.expression.value) : "${" + source.slice(child.expression.start, child.expression.end) + "}");
        const text = parts.join("").trim();
        edits.push({ start: run[0].start, end: run.at(-1).end, text: "{`" + text + "`}" });
      }
      run = [];
    }
    for (const child of node.children) {
      const safe = child.type === "JSXExpressionContainer" && child.expression.type !== "JSXEmptyExpression"
        && !contains(child.expression, value => /^(JSXElement|JSXFragment|ObjectExpression)$/.test(value.type))
        && (!contains(child.expression, value => value.type === "ArrowFunctionExpression") || child.expression.callee?.property?.name === "join"
          || ["size", "length"].includes(child.expression.property?.name))
        && !(child.expression.type === "Identifier" && /^(children|icon|content|body|prefix|suffix)$/.test(child.expression.name));
      if (child.type === "JSXText" || safe) run.push(child); else flush();
    }
    flush();
  });
  source = apply(source, edits);
  if (source !== original) { inspect(source, file); await writeFile(file, source); console.log(file); }
}

import { parse } from "@babel/parser";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const hasChinese = value => /\p{Script=Han}/u.test(value);
export const hash = value => createHash("sha256").update(value).digest("hex").slice(0, 10);
const runtimeTs = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSInstantiationExpression", "TSParameterProperty", "TSEnumDeclaration", "TSEnumMember"]);
export async function sourceFiles(root = "src") {
  const paths = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (/^(?:testing|tests|__tests__|fixtures|locales)$/.test(entry.name)) continue;
    const path = join(root, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) paths.push(...await sourceFiles(path));
    else if (/\.[cm]?[jt]sx?$/.test(path) && !/\.(?:test|spec|case|fixtures)\.[^.]+$|\.d\.ts$|\/fixtures\.[^.]+$/.test(path)) paths.push(path);
  }
  return paths.sort();
}
export function walk(node, visit, parents = []) {
  if (!node || typeof node !== "object" || typeof node.type !== "string") return;
  if (node.type.startsWith("TS") && !runtimeTs.has(node.type)) return;
  if (visit(node, parents) === false) return;
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "extra", "comments", "leadingComments", "trailingComments", "innerComments", "typeAnnotation", "typeParameters", "typeArguments"].includes(key)) continue;
    if (Array.isArray(value)) for (const child of value) walk(child, visit, [...parents, node]);
    else if (value && typeof value === "object") walk(value, visit, [...parents, node]);
  }
}
export function jsxText(value) {
  const lines = value.split(/\r\n|\n|\r/);
  const last = lines.findLastIndex(line => /[^ \t]/.test(line));
  return lines.map((line, index) => {
    let text = line.replace(/\t/g, " ");
    if (index !== 0) text = text.replace(/^ +/, "");
    if (index !== lines.length - 1) text = text.replace(/ +$/, "");
    return text ? text + (index !== last ? " " : "") : "";
  }).join("");
}
export function inspect(source, file) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const records = [];
  walk(ast, (node, parents) => {
    let text;
    const params = [];
    if (node.type === "StringLiteral") text = node.value;
    else if (node.type === "JSXText") text = jsxText(node.value);
    else if (node.type === "TemplateLiteral") {
      text = node.quasis.map((part, index) => {
        if (!node.expressions[index]) return part.value.cooked ?? part.value.raw;
        const expression = node.expressions[index];
        let name = expression.type === "Identifier" ? expression.name : expression.type === "MemberExpression" && !expression.computed && expression.property.type === "Identifier" ? expression.property.name : `value${index + 1}`;
        if (params.some(param => param.name === name)) name += index + 1;
        params.push({ name, node: expression });
        return (part.value.cooked ?? part.value.raw) + `{{${name}}}`;
      }).join("");
    }
    if (typeof text === "string" && hasChinese(text)) {
      records.push({ file, text, node, parents, params, id: `${file}:${hash(text)}`, line: node.loc.start.line });
    }
  });
  return { ast, records };
}
export async function inventory() {
  return (await Promise.all((await sourceFiles()).map(async file => inspect(await readFile(file, "utf8"), file).records))).flat();
}

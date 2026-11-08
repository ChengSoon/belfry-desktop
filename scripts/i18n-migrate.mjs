// One-time, syntax-aware migration helper. Review the diff and translate the emitted catalogs.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, relative } from "node:path";
import { sourceFiles, inspect, walk, hash } from "./i18n-source.mjs";

const shellModules = new Set(["about", "background", "backup", "settings", "theme", "typography", "updater"]);
const shellFiles = new Set(["src/components/WindowTitlebar.tsx", "src/components/WorkbenchToolbar.tsx", "src/workspace/components/Sidebar.tsx"]);
const shellOnly = process.argv.includes("--shell");
const modulesArg = process.argv.find(arg => arg.startsWith("--modules="));
const modules = modulesArg ? new Set(modulesArg.slice(10).split(",")) : null;
const excluded = new Set((process.argv.find(arg => arg.startsWith("--exclude=")) ?? "--exclude=").slice(10).split(","));
const dictionary = JSON.parse(await readFile("/tmp/belfry-i18n-translations.json", "utf8").catch(() => "{}"));
const catalogs = new Map();
async function catalog(locale, module) {
  const path = `src/i18n/locales/${locale}/${module}.json`;
  if (!catalogs.has(path)) catalogs.set(path, JSON.parse(await readFile(path, "utf8").catch(() => "{}")));
  return catalogs.get(path);
}
let total = 0;
function paramName(node, index) {
  if (node.type === "Identifier") return node.name;
  if (/MemberExpression$/.test(node.type) && !node.computed) return node.property.name === "length" ? "count" : node.property.name;
  if (/CallExpression$/.test(node.type)) {
    const name = node.callee.name ?? node.callee.property?.name ?? "";
    if (/^String$/.test(name) && node.arguments[0]) return paramName(node.arguments[0], index);
    if (/error|failure/i.test(name)) return "error";
    if (/shortcut|chord/i.test(name)) return "shortcut";
    if (/byte|size/i.test(name)) return "size";
    if (/token/i.test(name)) return "tokens";
    if (/date|time|moment|relative/i.test(name)) return "time";
    if (/path/i.test(name)) return "path";
    if (/label|name/i.test(name)) return "name";
    if (name === "join") return "names";
    if (/count|number|floor|ceil|round|min|max/i.test(name)) return "count";
    return "details";
  }
  if (node.type === "BinaryExpression" && /^[*/%-]$/.test(node.operator)) return "count";
  if (/^(ConditionalExpression|LogicalExpression)$/.test(node.type)) return "status";
  return "details";
}
for (const file of await sourceFiles()) {
  if (excluded.has(file)) continue;
  if (modules && !modules.has(file.split("/")[1])) continue;
  if (file.startsWith("src/i18n/") || shellOnly && !shellModules.has(file.split("/")[1]) && !shellFiles.has(file)
    && !file.startsWith("src/components/") && !file.startsWith("src/workspace/components/")
    && !/^src\/workspace\/named\/.*\.tsx$/.test(file) && file !== "src/plugins/ThemePicker.tsx") continue;
  const source = await readFile(file, "utf8"), { ast, records } = inspect(source, file);
  if (!records.length) continue;
  const module = file.split("/")[1].replace(/\.[^.]+$/, "shell"), name = basename(file).replace(/\.[^.]+$/, "");
  const zh = await catalog("zh-CN", module), en = await catalog("en", module);
  const imports = new Set(["t"]), edits = [], wrap = new Set();
  for (const record of records) {
    const parent = record.parents.at(-1);
    if (parent?.type === "ObjectProperty" && parent.key === record.node && !parent.computed) throw new Error(`Translate the object key explicitly: ${file}:${record.line}`);
    const original = record.text, names = new Set(), renamed = new Map();
    for (const [index, param] of record.params.entries()) {
      const old = param.name; let next = paramName(param.node, index);
      if (names.has(next)) next += index + 1;
      names.add(next); param.name = next;
      renamed.set(old, next);
    }
    record.text = original.replace(/\{\{(\w+)\}\}/g, (match, name) => `{{${renamed.get(name) ?? name}}}`).trim();
    record.key = `${name}.text_${hash(record.text)}`;
    zh[record.key] = record.text;
    const translation = dictionary[original] ?? dictionary[original.trim()];
    if (translation !== undefined) {
      const rename = text => {
        return text.replace(/\{\{(\w+)\}\}/g, (match, name) => `{{${renamed.get(name) ?? name}}}`).trim();
      };
      en[record.key] = typeof translation === "string" ? rename(translation) : Object.fromEntries(Object.entries(translation).map(([key, value]) => [key, rename(value)]));
    }
    if (!record.parents.some(node => /Function|Method/.test(node.type))) {
      const declaration = record.parents.find(node => node.type === "VariableDeclarator");
      if (declaration) {
        if (declaration.init === record.node) throw new Error(`Move the module-level scalar into a function: ${file}:${record.line}`);
        let initializer = declaration.init;
        while (/^(TSAsExpression|TSSatisfiesExpression)$/.test(initializer.type)) initializer = initializer.expression;
        if (!["ObjectExpression", "ArrayExpression"].includes(initializer.type)) throw new Error(`Review the module-level factory: ${file}:${record.line}`);
        wrap.add(declaration.init);
      }
    }
  }
  const renderRange = (start, end, except) => {
    const children = records.filter(record => record !== except && record.node.start >= start && record.node.end <= end);
    const top = children.filter(record => !children.some(other => other !== record && other.node.start <= record.node.start && other.node.end >= record.node.end));
    let output = source.slice(start, end);
    for (const record of top.sort((a, b) => b.node.start - a.node.start)) output = output.slice(0, record.node.start - start) + render(record) + output.slice(record.node.end - start);
    return output;
  };
  const render = record => {
    const values = record.params.map(({ name, node }) => `${name}: ${renderRange(node.start, node.end, record)}`);
    const expression = `t(${JSON.stringify(`${module}.${record.key}`)}${values.length ? `, { ${values.join(", ")} }` : ""})`;
    const parent = record.parents.at(-1);
    return record.node.type === "JSXText" || parent?.type === "JSXAttribute" ? `{${expression}}` : expression;
  };
  for (const record of records.filter(record => !records.some(other => other !== record && other.node.start <= record.node.start && other.node.end >= record.node.end))) {
    edits.push({ start: record.node.start, end: record.node.end, text: render(record) });
  }
  for (const node of wrap) {
    imports.add("localized");
    edits.push({ start: node.start, end: node.start, text: "localized(() => (" }, { start: node.end, end: node.end, text: "))" });
  }
  walk(ast, (node, parents) => {
    if (!/^(FunctionDeclaration|ArrowFunctionExpression|FunctionExpression)$/.test(node.type)) return;
    const direct = parents.at(-1), owner = parents.at(-2);
    const declaration = direct?.type === "VariableDeclarator" ? direct : direct?.type === "CallExpression" && direct.arguments[0] === node && /^(memo|forwardRef)$/.test(direct.callee?.name ?? "") && owner?.type === "VariableDeclarator" ? owner : undefined;
    const name = node.id?.name ?? declaration?.id?.name ?? "";
    if (!/^([A-Z]|use[A-Z])/.test(name)) return;
    // Class methods and ordinary render callbacks must not acquire hooks.
    if (parents.some(parent => /Function|Method/.test(parent.type))) return;
    if (node.async) return;
    if (node.body.type === "BlockStatement" && node.body.body.some(statement => statement.type === "ExpressionStatement" && statement.expression.callee?.name === "useTranslation"
      || statement.type === "VariableDeclaration" && statement.declarations.some(declaration => declaration.init?.callee?.name === "useTranslation"))) return;
    imports.add("useTranslation");
    if (node.body.type === "BlockStatement") edits.push({ start: node.body.start + 1, end: node.body.start + 1, text: "\n  useTranslation();" });
    else edits.push({ start: node.body.start, end: node.body.start, text: "{ useTranslation(); return (" }, { start: node.body.end, end: node.body.end, text: "); }" });
  });
  // Memoized view models must refresh with the language, but effects keep their lifecycle.
  walk(ast, node => {
    if (node.type !== "CallExpression" || node.callee.type !== "Identifier" || node.callee.name !== "useMemo" || node.arguments[1]?.type !== "ArrayExpression") return;
    const factory = node.arguments[0];
    if (!factory?.body || /FunctionExpression$/.test(factory.body.type)) return;
    let runtime = false;
    walk(factory.body, child => { if (child.type === "NewExpression" || child.type === "CallExpression" && /^create/.test(child.callee?.name ?? "")) runtime = true; });
    if (runtime || node.arguments[1].elements.some(element => element?.callee?.name === "getLocale")) return;
    imports.add("getLocale");
    const deps = node.arguments[1];
    edits.push({ start: deps.end - 1, end: deps.end - 1, text: `${deps.elements.length ? ", " : ""}getLocale()` });
  });
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  const existing = ast.program.body.filter(node => node.type === "ImportDeclaration");
  for (const imported of existing) for (const specifier of imported.specifiers) imports.delete(specifier.local.name);
  if (imports.size) {
    let path = relative(dirname(file), "src/i18n").replaceAll("\\", "/"); if (!path.startsWith(".")) path = `./${path}`;
    output = `import { ${[...imports].sort().join(", ")} } from ${JSON.stringify(path)};\n${output}`;
  }
  await writeFile(file, output);
  total += records.length;
}
for (const [path, value] of catalogs) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + "\n"); }
console.log(`Migrated ${total} strings. Review catalog translations and rerun check:i18n.`);

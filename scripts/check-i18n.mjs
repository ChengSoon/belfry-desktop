import { readFile, readdir, writeFile } from "node:fs/promises";
import { inventory, sourceFiles, inspect, walk, hasChinese } from "./i18n-source.mjs";
import { missingParameters, translationProblems } from "./i18n-validation.mjs";

const baselinePath = "scripts/i18n-baseline.json";
const records = await inventory(), counts = new Map();
for (const record of records) counts.set(record.id, (counts.get(record.id) ?? 0) + 1);
if (process.argv.includes("--write-baseline")) {
  await writeFile(baselinePath, JSON.stringify(Object.fromEntries([...counts].sort()), null, 2) + "\n");
  console.log(`Recorded ${records.length} legacy strings. Remove entries as modules migrate.`);
  process.exit(0);
}
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const errors = [];
if (Object.keys(baseline).length) errors.push("T9 migration is complete: the hardcoded-text baseline must remain empty.");
for (const [id, count] of counts) if (count > (baseline[id] ?? 0)) {
  const record = records.find(record => record.id === id);
  errors.push(`${record.file}:${record.line}: hardcoded text ${JSON.stringify(record.text)}`);
}
for (const [id, count] of Object.entries(baseline)) if ((counts.get(id) ?? 0) < count) errors.push(`Remove stale baseline entry: ${id}`);

const pluralKeys = new Set();
function flatten(value, prefix, target) {
  if (typeof value === "string") { target[prefix] = [value]; return; }
  if (!value || typeof value !== "object") { errors.push(`Invalid translation: ${prefix}`); return; }
  if (typeof value.other === "string" && Object.keys(value).every(key => /^(zero|one|two|few|many|other)$/.test(key))) {
    pluralKeys.add(prefix);
    target[prefix] = Object.values(value); return;
  }
  for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, target);
}
const catalogs = {};
for (const locale of ["zh-CN", "en"]) {
  catalogs[locale] = {};
  for (const file of await readdir(`src/i18n/locales/${locale}`)) if (file.endsWith(".json")) {
    flatten(JSON.parse(await readFile(`src/i18n/locales/${locale}/${file}`, "utf8")), file.slice(0, -5), catalogs[locale]);
  }
}
const placeholders = text => [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]))].sort().join(",");
for (const key of new Set([...Object.keys(catalogs["zh-CN"]), ...Object.keys(catalogs.en)])) {
  const zh = catalogs["zh-CN"][key], en = catalogs.en[key];
  if (!zh || !en) { errors.push(`Missing ${zh ? "en" : "zh-CN"} translation: ${key}`); continue; }
  const expected = placeholders(zh[0]);
  for (const text of [...zh, ...en]) {
    if (placeholders(text) !== expected) errors.push(`Interpolation mismatch: ${key}`);
    for (const problem of translationProblems(text)) errors.push(`${key}: ${problem}`);
  }
  if (key !== "common.languageChinese" && en.some(hasChinese)) errors.push(`Untranslated English entry: ${key}`);
}
const literalKeys = node => node?.type === "StringLiteral" ? [node.value]
  : node?.type === "ConditionalExpression" ? [...literalKeys(node.consequent), ...literalKeys(node.alternate)] : [];
for (const file of await sourceFiles()) {
  const { ast } = inspect(await readFile(file, "utf8"), file);
  walk(ast, node => {
    if (node.callee?.type !== "Identifier" || !((node.type === "CallExpression" && node.callee.name === "t")
      || (node.type === "NewExpression" && node.callee.name === "TranslationError"))) return;
    const values = node.arguments[1];
    const provided = !values ? [] : values.type === "ObjectExpression" && !values.properties.some(property => property.type === "SpreadElement")
      ? values.properties.map(property => property.key?.name ?? property.key?.value) : null;
    for (const key of literalKeys(node.arguments[0])) {
      if (!(key in catalogs["zh-CN"])) { errors.push(`${file}:${node.loc.start.line}: unknown translation ${key}`); continue; }
      if (provided) for (const parameter of missingParameters(catalogs["zh-CN"][key], provided, pluralKeys.has(key)))
        errors.push(`${file}:${node.loc.start.line}: ${key} requires parameter ${parameter}`);
    }
    if (values?.type === "ObjectExpression" && values.properties.some(property => /^value\d+$/.test(property.key?.name ?? property.key?.value ?? "")))
      errors.push(`${file}:${node.loc.start.line}: unnamed valueN parameter`);
  });
}
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log(`i18n OK: ${Object.keys(catalogs.en).length} entries per language; ${records.length} legacy strings remaining.`);

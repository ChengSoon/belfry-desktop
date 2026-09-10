import { validateManifest } from "./validation";
export function parseRawManifest(raw: string, appVersion: string) {
  if (new TextEncoder().encode(raw).length > 1_048_576) throw new Error("插件文件超过 1MiB");
  rejectDuplicateKeys(raw);
  const value: unknown = JSON.parse(raw);
  return validateManifest(value, appVersion);
}

function rejectDuplicateKeys(raw: string) {
  let index = 0;
  const parseValue = () => {
    skip();
    if (raw[index] === "{") return parseObject();
    if (raw[index] === "[") { index++; while (true) { skip(); if (raw[index] === "]") { index++; return; } parseValue(); skip(); if (raw[index] === ",") { index++; continue; } if (raw[index++] === "]") return; throw new Error("JSON 数组无效"); } }
    if (raw[index] === '"') { parseString(); return; }
    const end = raw.slice(index).search(/[\s,}\]]/u); index += end < 0 ? raw.length - index : end;
  };
  const parseObject = () => { index++; const keys = new Set<string>(); while (true) { skip(); if (raw[index] === "}") { index++; return; } if (raw[index] !== '"') throw new Error("JSON 对象键无效"); const key = parseString(); if (keys.has(key)) throw new Error("JSON 包含重复对象键"); keys.add(key); skip(); if (raw[index++] !== ":") throw new Error("JSON 对象无效"); parseValue(); skip(); if (raw[index] === ",") { index++; continue; } if (raw[index++] === "}") return; throw new Error("JSON 对象无效"); } };
  const parseString = () => { const start = index; index++; while (index < raw.length) { if (raw[index] === "\\") { index += 2; continue; } if (raw[index++] === '"') return JSON.parse(raw.slice(start, index)) as string; } throw new Error("JSON 字符串未闭合"); };
  const skip = () => { while (/\s/u.test(raw[index] ?? "")) index++; };
  parseValue(); skip(); if (index !== raw.length) throw new Error("JSON 尾部存在多余内容");
}

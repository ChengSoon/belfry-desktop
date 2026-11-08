import { TranslationError } from "../i18n";
import { validateManifest } from "./validation";
export function parseRawManifest(raw: string, appVersion: string) {
  if (new TextEncoder().encode(raw).length > 1_048_576) throw new TranslationError("plugins.raw.text_33ec1ebc96");
  rejectDuplicateKeys(raw);
  const value: unknown = JSON.parse(raw);
  return validateManifest(value, appVersion);
}

function rejectDuplicateKeys(raw: string) {
  let index = 0;
  const parseValue = () => {
    skip();
    if (raw[index] === "{") return parseObject();
    if (raw[index] === "[") { index++; while (true) { skip(); if (raw[index] === "]") { index++; return; } parseValue(); skip(); if (raw[index] === ",") { index++; continue; } if (raw[index++] === "]") return; throw new TranslationError("plugins.raw.text_7c7a63e349"); } }
    if (raw[index] === '"') { parseString(); return; }
    const end = raw.slice(index).search(/[\s,}\]]/u); index += end < 0 ? raw.length - index : end;
  };
  const parseObject = () => { index++; const keys = new Set<string>(); while (true) { skip(); if (raw[index] === "}") { index++; return; } if (raw[index] !== '"') throw new TranslationError("plugins.raw.text_9c6548aa8e"); const key = parseString(); if (keys.has(key)) throw new TranslationError("plugins.raw.text_ab19c416ea"); keys.add(key); skip(); if (raw[index++] !== ":") throw new TranslationError("plugins.raw.text_b7545b09d3"); parseValue(); skip(); if (raw[index] === ",") { index++; continue; } if (raw[index++] === "}") return; throw new TranslationError("plugins.raw.text_b7545b09d3"); } };
  const parseString = () => { const start = index; index++; while (index < raw.length) { if (raw[index] === "\\") { index += 2; continue; } if (raw[index++] === '"') return JSON.parse(raw.slice(start, index)) as string; } throw new TranslationError("plugins.raw.text_3bf874d1c9"); };
  const skip = () => { while (/\s/u.test(raw[index] ?? "")) index++; };
  parseValue(); skip(); if (index !== raw.length) throw new TranslationError("plugins.raw.text_f69beef16c");
}

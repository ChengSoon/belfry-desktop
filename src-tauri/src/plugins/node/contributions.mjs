import { basename } from "node:path";
import { createHash } from "node:crypto";
import { resourcePath } from "./manifest.mjs";
import { apiError } from "./errors.mjs";

function frontmatter(text) {
  const result = {};
  const header = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? "";
  for (const line of header.split(/\r?\n/)) {
    const match = line.match(/^(name|description):\s*(.*?)\s*$/);
    if (match) result[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return result;
}
export function staticContributions(entry, files) {
  const identity = { pluginId: entry.manifest.id, pluginName: entry.manifest.name };
  const contributes = entry.manifest.contributes ?? {};
  const skills = (contributes.skills ?? []).map((input) => {
    const item = typeof input === "string" ? { path: input } : input;
    const path = resourcePath(item.path);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(files.get(path));
    if (Buffer.byteLength(text) > 64 * 1024) throw apiError("LIMIT_EXCEEDED", "Skill 内容超额");
    return { ...identity, id: item.id ?? path, ...frontmatter(text), ...item, path,
      name: item.name ?? frontmatter(text).name ?? basename(path).replace(/\.md$/i, ""), content: text };
  });
  const themes = (contributes.themes ?? []).map((item) => {
    const bytes = files.get(resourcePath(item.path));
    return { ...identity, ...item, cssDigest: createHash("sha256").update(bytes).digest("hex"),
      css: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
  });
  const views = (contributes.views ?? []).map((item) => ({ ...identity, ...item }));
  return { skills, themes, views };
}

export const MAX_ENTRIES = 400;
export const MAX_BYTES = 1_000_000;
export const MAX_BODY = 16_000;
export const MAX_COPY_BYTES = 256 * 1024;

export function projectKey(workspace) {
  if (!workspace?.path) return null;
  const path = workspace.path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  return /^[a-z]:/i.test(path) || path.startsWith("//") ? path.toLocaleLowerCase("en-US") : path;
}

export function renderTemplate(body, workspace) {
  return body.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, key) => {
    if (!["project.name", "project.path", "project.path.posix", "project.path.powershell"].includes(key)) throw new Error(`未知变量：${key}`);
    if (!workspace?.path) throw new Error("这个模板需要先打开一个项目");
    if (key === "project.name") return workspace.name || workspace.path.split(/[\\/]/).filter(Boolean).at(-1) || workspace.path;
    if (key === "project.path.posix") return `'${workspace.path.replace(/'/g, "'\"'\"'")}'`;
    if (key === "project.path.powershell") return `'${workspace.path.replace(/'/g, "''")}'`;
    return workspace.path;
  });
}

export function parseLibrary(raw) {
  if (typeof raw !== "string" || raw.length > MAX_BYTES) throw new Error("收藏库存档超过大小上限");
  const value = JSON.parse(raw);
  if (!record(value) || value.version !== 1) throw new Error("收藏库存档版本不受支持");
  if (!Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) throw new Error("收藏库条目过多或格式损坏");
  const entries = value.entries.map(cleanEntry), ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error("收藏库存档包含重复身份");
    ids.add(entry.id);
  }
  return { version: 1, entries };
}

export function cleanEntry(value) {
  if (!record(value) || !["prompt", "command"].includes(value.kind) || !["global", "project"].includes(value.scope)) throw new Error("收藏分类无效");
  const entry = { id: text(value.id, 100), title: text(value.title, 100), category: value.category ? text(value.category, 60) : "",
    kind: value.kind, scope: value.scope, projectPath: value.scope === "project" ? pathText(value.projectPath) : null,
    body: bodyText(value.body), archived: value.archived === true, updatedAt: value.updatedAt };
  if (!Number.isSafeInteger(entry.updatedAt) || entry.updatedAt < 0) throw new Error("收藏更新时间无效");
  return entry;
}

export function visible(entry, workspace) { return entry.scope === "global" || projectKey({ path: entry.projectPath }) === projectKey(workspace); }
export function assertContext(expected, workspace) {
  if (expected !== projectKey(workspace)) throw new Error("项目已切换，请重新读取收藏库并预览");
}
export function bodyText(value) {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_BODY || value.includes("\0")) throw new Error("内容不能为空、包含空字符或超过 16,000 字符");
  return value;
}
function text(value, limit) {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("收藏字段为空、过长或包含控制字符");
  return value.trim();
}
function record(value) { return value && typeof value === "object" && !Array.isArray(value); }
function pathText(value) { text(value, 4_096); return value; }

import { array, isObject, required, resourcePath, strings, validId } from "./manifest-values.mjs";
import { validateFields } from "./manifest-fields.mjs";
import { validateVersion } from "./engine-version.mjs";
export { array, isObject, required, resourcePath, validId } from "./manifest-values.mjs";

export const PERMISSIONS = new Set([
  "ui.panel", "ui.view", "ui.theme", "notify", "clipboard.read", "clipboard.write",
  "fs.read", "fs.write", "fs.delete", "fs.read.workspace", "fs.write.workspace", "fs.delete.workspace",
  "shell.openExternal", "net.fetch", "agent.tool.register", "agent.prompt.inject", "agent.complete",
  "models.list", "session.read", "mcp.server.local", "mcp.server.remote", "background.service",
  "bus.publish", "bus.subscribe", "browser.cdp", "browser.control", "browser.read", "browser.interact", "browser.evaluate",
]);
function contributions(m) {
  const c = m.contributes ?? {};
  if (!isObject(c)) throw new Error("contributes 必须为对象");
  for (const [kind, field] of Object.entries({ commands: "id", agentTools: "name", settings: "key",
    views: "id", themes: "id", services: "id", mcpServers: "id" })) {
    const entries = array(c[kind], kind);
    if (entries.length > 100) throw new Error(`${kind} 贡献数量超额`);
    strings(entries.map((item) => required(item?.[field], `${kind}.${field}`)), kind);
  }
  if (array(c.skills, "skills").length > 100) throw new Error("Skill 数量超额");
  contributionPermissions(m, c);
}
function contributionPermissions(m, c) {
  for (const [kind, permission] of Object.entries({ agentTools: "agent.tool.register", skills: "agent.prompt.inject",
    views: "ui.view", themes: "ui.theme", services: "background.service" })) {
    if (c[kind]?.length && !m.permissions?.includes(permission)) throw new Error(`${kind} 缺少权限 ${permission}`);
  }
  if (m.ui?.panel && !m.permissions?.includes("ui.panel")) throw new Error("panel 缺少 ui.panel 权限");
  if (c.harnesses?.length) throw new Error("Harness 功能已移除");
}
function policies(m) {
  for (const mode of ["read", "write", "delete"]) filePolicy(m, mode);
  for (const domain of strings(m.net?.domains, "net.domains")) {
    if (!domain.replace(/^\*\./, "") || /[/:@*\s]/.test(domain.replace(/^\*\./, ""))) throw new Error("net.domains 必须为域名列表");
  }
}
function filePolicy(m, mode) {
  const rule = m.fs?.[mode];
  if (rule === undefined) return;
  if (!isObject(rule) || !m.permissions?.includes(`fs.${mode}`)) throw new Error(`fs.${mode} 范围无效或缺少权限`);
  if (rule.root && !["workspace", "userSelected"].includes(rule.root)) throw new Error("文件范围 root 无效");
  for (const pattern of strings(rule.scope, "scope")) {
    resourcePath(pattern);
    if (mode !== "read" && ["**", "**/*", "*"].includes(pattern)) throw new Error("写入和删除范围不能覆盖整个工作区");
  }
}
export function validateManifest(m) {
  if (!isObject(m) || m.schemaVersion !== 1 || !validId(m.id)) throw new Error("PI manifest 版本或 ID 无效");
  required(m.name, "name");
  validateVersion(m.version);
  // 与上游一致：保留市场 / 本地化元数据，仅校验宿主实际使用的字段。
  resourcePath(m.main);
  for (const permission of strings(m.permissions, "permissions")) {
    if (!PERMISSIONS.has(permission)) throw new Error(`未知 PI 插件权限：${permission}`);
  }
  strings(m.activationEvents, "activationEvents");
  contributions(m); policies(m); validateFields(m);
  return m;
}
export function resources(m) {
  const paths = [m.main, ...(!m.main ? [m.icon] : []), m.ui?.panel].filter(Boolean);
  for (const [kind, field] of [["views", "entry"], ["themes", "path"], ["skills", "path"]]) {
    for (const entry of m.contributes?.[kind] ?? []) paths.push(typeof entry === "string" ? entry : entry[field]);
  }
  return paths.map(resourcePath);
}

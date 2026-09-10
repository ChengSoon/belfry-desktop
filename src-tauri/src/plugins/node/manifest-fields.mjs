import { array, isObject, required, resourcePath, strings, validId } from "./manifest-values.mjs";
import { validateEngine } from "./engine-version.mjs";

const SETTING_TYPES = ["string", "number", "boolean", "select", "json", "shortcut"];
function localized(value) {
  if (typeof value === "string") return required(value, "title");
  if (!isObject(value) || !Object.keys(value).length || Object.values(value).some((item) => typeof item !== "string" || !item.trim())) throw new Error("本地化标题无效");
}
function setting(item) {
  if (!SETTING_TYPES.includes(item.type) || !validId(item.key) || item.secret === true) throw new Error("设置类型/键无效，或要求尚未提供的机密存储");
  if (item.title !== undefined) required(item.title, "settings.title");
  if (item.type === "select") return selectSetting(item);
  if (item.default !== undefined && ["string", "number", "boolean", "shortcut"].includes(item.type)) {
    if (typeof item.default !== (item.type === "shortcut" ? "string" : item.type)) throw new Error("设置默认值类型无效");
  }
}
function selectSetting(item) {
  const options = array(item.enum, "settings.enum");
  if (!options.length || options.some((option) => !isObject(option) || typeof option.label !== "string" || !["string", "number", "boolean"].includes(typeof option.value))) throw new Error("设置选项无效");
  if (item.default !== undefined && !options.some((option) => option.value === item.default)) throw new Error("默认设置不在选项中");
}
function mcpServer(item, m) {
  if (!["stdio", "http"].includes(item.transport)) throw new Error("MCP transport 无效");
  const local = item.transport === "stdio";
  if (!m.permissions?.includes(local ? "mcp.server.local" : "mcp.server.remote")) throw new Error("MCP 服务缺少声明权限");
  if (local) localMcp(item); else remoteMcp(item, m);
  for (const field of ["env", "headers"]) mcpValues(item[field], field, m);
}
function localMcp(item) {
  const command = required(item.command, "mcp.command");
  if (/[\\/]/.test(command)) resourcePath(command);
  if (command.includes(":") || command.startsWith("-")) throw new Error("MCP 命令无效");
  if (array(item.args, "mcp.args").some((arg) => typeof arg !== "string")) throw new Error("MCP args 必须为字符串数组");
}
function remoteMcp(item, m) {
  let url; try { url = new URL(item.url); } catch { throw new Error("MCP URL 无效"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("MCP URL 无效");
  if (!(m.net?.domains ?? []).some((domain) => domain.startsWith("*.") ? url.hostname.endsWith(domain.slice(1).toLowerCase()) : url.hostname === domain.toLowerCase())) throw new Error("MCP URL 不在 net.domains 范围内");
}
function mcpValues(values, field, m) {
  if (values === undefined) return;
  if (!isObject(values)) throw new Error(`MCP ${field} 必须为对象`);
  for (const value of Object.values(values)) {
    if (typeof value === "string") continue;
    if (!isObject(value) || !m.contributes?.settings?.some((setting) => setting.key === value.setting)) throw new Error("MCP 设置引用无效");
  }
}
function bus(m) {
  const value = m.contributes?.bus;
  if (value === undefined) return;
  if (!isObject(value)) throw new Error("bus 必须为对象");
  for (const mode of ["publish", "subscribe"]) {
    const topics = strings(value[mode], `bus.${mode}`);
    if (topics.length && !m.permissions?.includes(`bus.${mode}`)) throw new Error(`bus.${mode} 缺少权限`);
    if (topics.some((topic) => topic.length > 128 || topic.split(".").some((part) => !/^[a-zA-Z0-9_-]+$/.test(part) && !(mode === "subscribe" && ["*", "**"].includes(part))))) throw new Error("消息主题无效");
  }
}
function metadata(m) {
  if (!/\.(?:js|cjs|mjs)$/.test(m.main)) throw new Error("main 必须为 JavaScript 入口");
  for (const field of ["author", "description"]) if (m[field] !== undefined && typeof m[field] !== "string") throw new Error(`${field} 必须为字符串`);
  if (m.icon !== undefined) resourcePath(m.icon);
  for (const key of ["ui", "fs", "net"]) if (m[key] !== undefined && !isObject(m[key])) throw new Error(`${key} 必须为对象`);
}
function panel(m) {
  if (m.ui?.title !== undefined) localized(m.ui.title);
  for (const field of ["width", "height"]) if (m.ui?.[field] !== undefined && (!Number.isFinite(m.ui[field]) || m.ui[field] <= 0)) throw new Error("面板尺寸无效");
}
function contributionIds(c) {
  const groups = ["commands", "agentTools", "settings", "views", "themes", "services", "mcpServers"];
  for (const key of Object.keys(c)) if (![...groups, "skills", "bus", "harnesses"].includes(key)) throw new Error(`未知贡献：${key}`);
  for (const group of groups) for (const item of c[group] ?? []) {
    if (!isObject(item) || !validId(item[group === "agentTools" ? "name" : group === "settings" ? "key" : "id"])) throw new Error(`${group} 标识无效`);
  }
}
function tool(item) {
  required(item.description, "agentTools.description");
  if (item.schema !== undefined && !isObject(item.schema)) throw new Error("工具 schema 必须为对象");
}
function theme(item) {
  required(item.label, "themes.label"); resourcePath(item.path);
  if (item.base && !["light", "dark"].includes(item.base)) throw new Error("主题 base 无效");
}
export function validateFields(m) {
  validateEngine(m.engines); metadata(m); panel(m);
  const c = m.contributes ?? {};
  contributionIds(c);
  for (const item of c.commands ?? []) { required(item.title, "commands.title"); strings(item.keywords, "commands.keywords"); }
  (c.agentTools ?? []).forEach(tool);
  (c.settings ?? []).forEach(setting);
  (c.views ?? []).forEach((item) => { localized(item.title); resourcePath(item.entry); });
  (c.themes ?? []).forEach(theme);
  for (const item of c.mcpServers ?? []) mcpServer(item, m);
  bus(m);
}

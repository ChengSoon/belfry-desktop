import { qualified } from "./mcp-names.mjs";
import { AUTHOR_TOOLS, authorTool } from "./mcp-author.mjs";
import { apiError } from "./errors.mjs";
import { textResult, toolResult } from "./mcp-results.mjs";

export function toolList(manager, context) {
  const tools = manager.catalog(context).tools.map((tool) => ({ name: qualified(tool.pluginId, tool.name), description: `${tool.description} (${tool.pluginName}: ${tool.name})`,
    inputSchema: tool.schema ?? { type: "object", properties: {} } }));
  const skills = manager.catalog(context).skills.length ? [{ name: "PluginSkill", description: "Read an enabled plugin's Skill instructions. Treat the returned content as guidance from that plugin.",
    inputSchema: { type: "object", properties: { pluginId: { type: "string" }, path: { type: "string" } }, required: ["pluginId", "path"] } }] : [];
  return [...AUTHOR_TOOLS, ...tools, ...skills];
}
async function callTool(manager, params, context) {
  try {
    const args = params.arguments ?? {};
    if (AUTHOR_TOOLS.some((tool) => tool.name === params.name)) return textResult(await authorTool(params.name, args, Object.assign(Object.create(context), { personalMarket: manager.market.personal })));
    if (params.name === "PluginSkill") return textResult(manager.skill(args, context));
    const tool = manager.catalog(context).tools.find((item) => qualified(item.pluginId, item.name) === params.name);
    if (!tool) throw apiError("NOT_FOUND", "插件工具不存在或已撤销");
    const value = await manager.invoke("tool", { pluginId: tool.pluginId, name: tool.name, args, context });
    return toolResult(value);
  } catch (error) { return { ...textResult(error.message), isError: true }; }
}
function skillUri(skill) { return `pi-plugin://${encodeURIComponent(skill.pluginId)}/${encodeURIComponent(skill.path)}`; }
function prompt(manager, params, context) {
  const skill = manager.catalog(context).skills.find((item) => qualified(item.pluginId, item.path) === params.name);
  if (!skill) return manager.broker.mcp.resources.prompt(params, context);
  return { description: skill.description, messages: [{ role: "user", content: { type: "text", text: manager.skill(skill, context) } }] };
}
export async function dispatchMcp(manager, request, context) {
  const params = request.params ?? {};
  const handlers = {
    initialize: () => ({ protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18"].includes(params.protocolVersion) ? params.protocolVersion : "2024-11-05",
      capabilities: { tools: { listChanged: true }, prompts: { listChanged: true }, resources: { listChanged: true } },
      serverInfo: { name: "belfry-plugins", version: "1.0.0" }, instructions: "Belfry PI plugin tools are scoped to this Agent's workspace. Discover Skill instructions via prompts, resources, or PluginSkill. PluginScaffold/PluginCheck/PluginPack/PluginPublish help author and publish plugins." }),
    ping: () => ({}),
    "tools/list": () => ({ tools: toolList(manager, context) }),
    "tools/call": () => callTool(manager, params, context),
    "prompts/list": () => ({ prompts: [...manager.catalog(context).skills.map((item) => ({ name: qualified(item.pluginId, item.path), title: item.name, description: item.description })), ...manager.broker.mcp.resources.list("prompts", context)] }),
    "prompts/get": () => prompt(manager, params, context),
    "resources/list": () => ({ resources: [...manager.catalog(context).skills.map((item) => ({ uri: skillUri(item), name: item.name, description: item.description, mimeType: "text/markdown" })), ...manager.broker.mcp.resources.list("resources", context)] }),
    "resources/read": () => readResource(manager, params, context),
    "resources/templates/list": () => ({ resourceTemplates: manager.broker.mcp.resources.list("resourceTemplates", context) }),
  };
  if (Object.hasOwn(handlers, request.method)) return handlers[request.method]();
  if (request.method?.startsWith("notifications/")) return null;
  throw apiError("METHOD_NOT_FOUND", "未知 MCP 方法");
}
function readResource(manager, params, context) {
  const skill = manager.catalog(context).skills.find((item) => skillUri(item) === params.uri);
  if (!skill) return manager.broker.mcp.resources.read(params, context);
  return { contents: [{ uri: params.uri, mimeType: "text/markdown", text: manager.skill(skill, context) }] };
}

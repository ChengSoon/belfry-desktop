import { apiError } from "./errors.mjs";
import { isObject } from "./manifest-values.mjs";
import { qualified } from "./mcp-names.mjs";
import { textResult, toolResult } from "./mcp-results.mjs";

const MAX_QUERY_LENGTH = 200;
export const AGENT_INSTRUCTIONS = "Belfry PI plugins are scoped to this Agent's workspace. For plugin tasks, use PluginTools to discover the live tools and their input schemas, then PluginCall with pluginId, name and arguments. Refresh with PluginTools when a plugin is installed, enabled or missing from your cached tool list. Prefer these tools before opening plugin UI. Discover Skill instructions via prompts, resources or PluginSkill. PluginScaffold/PluginCheck/PluginPack/PluginPublish help author and publish plugins.";

export const AGENT_TOOLS = [
  { name: "PluginTools", description: "Discover the current enabled plugin tools and input schemas in this Agent workspace. Use for plugin tasks and newly installed plugins even when your cached tool list has not refreshed. Optionally search by plugin name, ID or tool name.",
    inputSchema: { type: "object", properties: { query: { type: "string", maxLength: MAX_QUERY_LENGTH } }, additionalProperties: false },
    annotations: { readOnlyHint: true } },
  { name: "PluginCall", description: "Call an enabled plugin tool using the pluginId, name and input schema returned by PluginTools. Works for plugins installed during this session and enforces the current workspace scope and plugin permissions.",
    inputSchema: { type: "object", properties: { pluginId: { type: "string" }, name: { type: "string" }, arguments: { type: "object" } },
      required: ["pluginId", "name"], additionalProperties: false } },
];

function discover(manager, args, context) {
  const query = args.query ?? "";
  if (typeof query !== "string" || query.length > MAX_QUERY_LENGTH) throw apiError("INVALID_ARGUMENT", "工具搜索词无效");
  const normalized = query.trim().toLowerCase();
  const tools = manager.catalog(context).tools
    .filter((tool) => [tool.pluginId, tool.pluginName, tool.name, tool.description].some((value) => String(value ?? "").toLowerCase().includes(normalized)))
    .map((tool) => ({ pluginId: tool.pluginId, pluginName: tool.pluginName, name: tool.name, mcpName: qualified(tool.pluginId, tool.name),
      description: tool.description, inputSchema: tool.schema ?? { type: "object", properties: {} } }));
  return textResult({ tools });
}

export async function agentTool(manager, request, context) {
  const args = request.arguments ?? {};
  if (!isObject(args)) throw apiError("INVALID_ARGUMENT", "插件工具参数必须为对象");
  if (request.name === "PluginTools") return discover(manager, args, context);
  if (typeof args.pluginId !== "string" || typeof args.name !== "string" || !isObject(args.arguments ?? {})) {
    throw apiError("INVALID_ARGUMENT", "需要 PluginTools 返回的 pluginId、name 和对象参数 arguments");
  }
  const tool = manager.catalog(context).tools.find((item) => item.pluginId === args.pluginId && item.name === args.name);
  if (!tool) throw apiError("NOT_FOUND", "插件工具已撤销或不在当前项目生效，请用 PluginTools 刷新");
  return toolResult(await manager.invoke("tool", { pluginId: tool.pluginId, name: tool.name, args: args.arguments ?? {}, context }));
}

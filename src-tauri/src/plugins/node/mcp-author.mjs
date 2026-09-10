import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { scaffold, check, pack } from "./author.mjs";
import { apiError } from "./errors.mjs";
import { cleanPath } from "./fs-policy.mjs";

const directory = { type: "string", description: "Directory relative to this Agent session's workspace" };
export const AUTHOR_TOOLS = [
  { name: "PluginScaffold", description: "Create a PI plugin from a template in an empty workspace directory. Generates manifest.json, main.js and resources. Review and install in Belfry's plugin center.",
    inputSchema: { type: "object", properties: { directory, template: { type: "string", enum: ["panel-basic", "agent-tool-basic", "skill-pack", "full-demo"] }, id: { type: "string" }, name: { type: "string" }, author: { type: "string" } }, required: ["directory", "template"], additionalProperties: false } },
  { name: "PluginCheck", description: "Validate a PI plugin manifest, permissions and resources without executing the plugin.",
    inputSchema: { type: "object", properties: { directory }, required: ["directory"], additionalProperties: false } },
  { name: "PluginPack", description: "Validate and export a shareable .piplug archive to the plugin's dist directory.",
    inputSchema: { type: "object", properties: { directory }, required: ["directory"], additionalProperties: false } },
  { name: "PluginPublish", description: "Publish a checked workspace plugin to the user's local personal marketplace. Never uploads to an external service. Use the digest returned by PluginCheck so changed files cannot be published accidentally.",
    inputSchema: { type: "object", properties: { directory, expectedDigest: { type: "string" }, changelog: { type: "string" } }, required: ["directory", "expectedDigest"], additionalProperties: false } },
];
async function scopedDirectory(workspace, input) {
  if (!workspace || typeof input !== "string") throw apiError("NO_WORKSPACE", "需要 Agent 项目目录");
  const root = await realpath(workspace), target = resolve(root, input), path = relative(root, target);
  if (isAbsolute(path)) throw apiError("PERMISSION_DENIED", "作者工具只能操作本会话的工作区");
  cleanPath(path.replaceAll("\\", "/"), true);
  let existing = target;
  while (!(await lstat(existing).catch((error) => { if (error.code !== "ENOENT") throw error; return null; }))) {
    const parent = dirname(existing);
    if (parent === existing) throw apiError("INVALID_ARGUMENT", "目录无效");
    existing = parent;
  }
  const resolved = relative(root, await realpath(existing));
  if (isAbsolute(resolved) || resolved === ".." || resolved.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw apiError("PERMISSION_DENIED", "作者工具目录越界");
  return target;
}
export async function authorTool(name, args, context) {
  const directory = await scopedDirectory(context.workspace, args.directory);
  if (context.expired) throw apiError("SESSION_EXPIRED", "Agent 会话已失效");
  if (name === "PluginScaffold") return scaffold({ directory, template: args.template, id: args.id, name: args.name, author: args.author });
  if (name === "PluginCheck") return check(directory);
  if (name === "PluginPublish") {
    if (!context.personalMarket || typeof args.expectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(args.expectedDigest)) throw apiError("INVALID_ARGUMENT", "请先校验插件并提供内容摘要");
    return context.personalMarket.publish({ directory, changelog: args.changelog, expectedDigest: args.expectedDigest });
  }
  return pack({ directory });
}

import { panelHtml } from "./template-panel.mjs";
export const TEMPLATES = ["panel-basic", "agent-tool-basic", "skill-pack", "full-demo"];
export function templateFiles({ template, id, name, author }) {
  if (!TEMPLATES.includes(template)) throw new Error(`未知模板：${template}`);
  const panel = ["panel-basic", "full-demo"].includes(template);
  const tool = ["agent-tool-basic", "full-demo"].includes(template);
  const skill = ["skill-pack", "full-demo"].includes(template);
  const contributes = {}, permissions = [];
  if (panel) { contributes.commands = [{ id: `${id}.open`, title: `打开 ${name}` }]; permissions.push("ui.panel"); }
  if (tool) {
    contributes.agentTools = [{ name: "echo_text", description: "返回输入的文本", risk: "low",
      schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }];
    permissions.push("agent.tool.register");
  }
  if (skill) { contributes.skills = ["skills/guide.md"]; permissions.push("agent.prompt.inject"); }
  if (template === "full-demo") contributes.settings = [{ key: "greeting", title: "欢迎语", type: "string", default: `你好，${name}` }];
  const manifest = { schemaVersion: 1, id, name, version: "0.1.0", description: "使用 Belfry 插件模板创建。",
    ...(author?.trim() ? { author: author.trim() } : {}),
    main: "main.js", ...(panel ? { ui: { panel: "renderer/index.html", title: name } } : {}),
    contributes, permissions, engines: { piDesktop: ">=0.1.0" }, activationEvents: ["onStartup"] };
  const files = new Map([["manifest.json", JSON.stringify(manifest, null, 2) + "\n"],
    ["main.js", mainCode({ id, name, panel, tool })], ["README.md", readme(name)]]);
  if (panel) files.set("renderer/index.html", panelHtml(name));
  if (skill) files.set("skills/guide.md", `---\nname: ${id}.guide\ndescription: 审查当前工作区的修改\n---\n\n先读取相关代码，再报告可复现的问题及验证方式。\n`);
  return { manifest, files };
}
function mainCode({ id, name, panel, tool }) {
  const load = [], unload = [];
  if (panel) {
    load.push(`  await pi.commands.register({ id: ${JSON.stringify(`${id}.open`)}, title: ${JSON.stringify(`打开 ${name}`)},\n    run: async () => { await pi.ui.openPanel(); } });`);
    unload.push(`  await pi.commands.unregister(${JSON.stringify(`${id}.open`)});`);
  }
  if (tool) {
    load.push(`  await pi.agent.registerTool({ name: "echo_text", description: "返回输入的文本", risk: "low",\n    schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },\n    execute: async (args) => ({ content: [{ type: "text", text: String(args.text) }] }) });`);
    unload.push('  await pi.agent.unregisterTool("echo_text");');
  }
  return `// pi 由插件宿主提供。\nasync function onLoad() {\n${load.join("\n")}\n}\nasync function onUnload() {\n${unload.join("\n")}\n}\nmodule.exports = { onLoad, onUnload };\n`;
}
function readme(name) {
  return `# ${name}\n\n在 Belfry 的插件中心加载此开发目录。编辑 main.js 或资源后自动重载。\n\n使用“校验”和“打包”生成可分享的 .piplug，安装者直接选择插件包即可。\nCLI：在 Belfry 仓库运行 node scripts/plugin-devkit.mjs check <插件目录> 或 pack <插件目录>。\n\nmanifest.json 声明身份、入口、贡献和权限；main.js 导出 onLoad/onUnload，通过 pi 调用宿主。\n添加权限或扩大文件/网络范围后需要重新安装确认。\n`;
}

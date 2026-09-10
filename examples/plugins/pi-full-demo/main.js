// pi 由插件宿主提供。
async function onLoad() {
  await pi.commands.register({ id: "belfry.pi-demo.open", title: "打开 PI 插件示例",
    run: async () => { await pi.ui.openPanel(); } });
  await pi.agent.registerTool({ name: "echo_text", description: "返回输入的文本", risk: "low",
    schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    execute: async (args) => ({ content: [{ type: "text", text: String(args.text) }] }) });
}
async function onUnload() {
  await pi.commands.unregister("belfry.pi-demo.open");
  await pi.agent.unregisterTool("echo_text");
}
module.exports = { onLoad, onUnload };

import { createController, errorResult, EXTENSION_URL } from "./controller.mjs";
import { readFile } from "node:fs/promises";

const COMMAND = "belfry.playwriter.open", SERVICE = "belfry.playwriter.relay";
let controller;
const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));
const result = value => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

export async function onLoad() {
  controller = createController({ dataPath: () => pi.plugin.getDataPath() });
  await pi.commands.register({ id: COMMAND, title: "打开 Playwriter 浏览器助手", run: () => pi.ui.openPanel() });
  for (const descriptor of manifest.contributes.agentTools) {
    await pi.agent.registerTool({ ...descriptor, execute: async (args, context) => {
      try {
        if (descriptor.name === "playwriter_status") return result(await controller.status());
        if (descriptor.name === "playwriter_help") return await controller.help();
        const workspace = (await pi.workspace.get())?.path;
        const scope = { ...context, workspace };
        return descriptor.name === "playwriter_reset" ? await controller.reset(scope) : await controller.execute(args, scope);
      } catch (error) { return errorResult(error); }
    } });
  }
  await pi.services.register({ id: SERVICE,
    start: () => {
      controller ??= createController({ dataPath: () => pi.plugin.getDataPath() });
      void controller.start().catch(() => {});
    },
    stop: async () => { const previous = controller; controller = null; await previous?.stop(); } });
}

export async function onPanelInvoke(channel) {
  if (!controller) throw new Error("插件尚未就绪");
  if (channel === "playwriter.status") return controller.status();
  if (channel === "playwriter.connect") { void controller.start().catch(() => {}); return controller.status(); }
  if (channel === "playwriter.installExtension") { await pi.shell.openExternal(EXTENSION_URL); return null; }
  if (channel === "playwriter.openDocs") { await pi.shell.openExternal("https://github.com/remorses/playwriter"); return null; }
  if (channel === "playwriter.test") {
    const workspace = (await pi.workspace.get())?.path;
    if (!workspace) throw new Error("请先在 Belfry 中打开一个项目，再测试连接。");
    return controller.testConnection(workspace);
  }
  throw new Error("不支持的浏览器助手操作");
}

export async function onUnload() {
  const previous = controller; controller = null; await previous?.stop();
  for (const descriptor of manifest.contributes.agentTools) await pi.agent.unregisterTool(descriptor.name);
  await pi.services.unregister(SERVICE); await pi.commands.unregister(COMMAND);
  controller = null;
}

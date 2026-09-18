import { createLibrary } from "./library.mjs";

const COMMAND = "belfry.command-library.open";
let library;

export async function onLoad() {
  library = createLibrary({ dataPath: () => pi.plugin.getDataPath(), workspace: () => pi.workspace.get(), copy: (text) => pi.clipboard.writeText(text) });
  await pi.commands.register({ id: COMMAND, title: "打开命令与 Prompt 收藏库", run: () => pi.ui.openPanel() });
}
export async function onUnload() { library = null; await pi.commands.unregister(COMMAND); }
export async function onPanelInvoke(channel, payload = {}) {
  if (!library) throw new Error("插件尚未就绪");
  const action = { "library.list": "list", "library.save": "save", "library.preview": "preview", "library.copy": "copy" }[channel];
  if (!action) throw new Error("不支持的收藏库操作");
  return library[action](payload);
}

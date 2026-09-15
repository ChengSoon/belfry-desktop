import { randomUUID } from "node:crypto";
import { assertContext, cleanEntry, MAX_COPY_BYTES, projectKey, renderTemplate, visible } from "./model.mjs";
import { createStore } from "./store.mjs";

export function createLibrary(bridge) {
  const store = createStore(bridge.dataPath);
  const list = async () => snapshot(await store.read(), await bridge.workspace());
  const save = async (input) => {
    const workspace = await bridge.workspace(); assertContext(input.projectKey, workspace);
    const state = await store.change(input.revision, async (document) => {
      const old = document.entries.find((entry) => entry.id === input.entry?.id);
      if (old && !visible(old, workspace)) throw new Error("此收藏不属于当前项目");
      const entry = draft(input.entry, workspace);
      const entries = old ? document.entries.map((item) => item.id === entry.id ? entry : item) : [entry, ...document.entries];
      assertContext(input.projectKey, await bridge.workspace());
      return { version: 1, entries };
    });
    return snapshot(state, workspace);
  };
  const preview = async (input) => {
    const workspace = await bridge.workspace(); assertContext(input.projectKey, workspace);
    const entry = input.entry ? draft(input.entry, workspace) : (await store.read()).document.entries.find((entry) => entry.id === input.id);
    if (!entry || !visible(entry, workspace)) throw new Error("此收藏不属于当前项目");
    return { text: renderTemplate(entry.body, workspace), projectKey: projectKey(workspace) };
  };
  const copy = async (input) => {
    assertContext(input.projectKey, await bridge.workspace());
    if (typeof input.text !== "string" || !input.text.trim() || Buffer.byteLength(input.text) > MAX_COPY_BYTES || input.text.includes("\0")) throw new Error("复制内容为空或过大");
    await bridge.copy(input.text); return { copied: true };
  };
  return { list, save, preview, copy };
}

function draft(value, workspace) {
  if (value?.scope === "project" && !workspace?.path) throw new Error("请先打开一个项目");
  return cleanEntry({ ...value, id: value?.id || randomUUID(), projectPath: value?.scope === "project" ? workspace.path : null, updatedAt: Date.now() });
}
function snapshot(state, workspace) {
  return { revision: state.revision, projectKey: projectKey(workspace), workspace,
    entries: state.document.entries.filter((entry) => visible(entry, workspace)) };
}

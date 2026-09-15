import { agentDescriptor } from "../../agent/contracts";
import type { ProjectWorkspace } from "../contracts";
import { WORKSPACE_STATE_KEY } from "../storage";

export const project = (path: string): ProjectWorkspace => ({ id: path, name: path.split("/").at(-1)!,
  rootPath: path, rootUri: `file://${path}` });
const delayed = new Set<string>();
const pending = new Map<string, () => void>();
const params = new URLSearchParams(location.search);
if (params.has("holdDefault")) delayed.add("/qa/default");
let releaseAgents = () => {};
const agentGate = params.has("holdAgents") ? new Promise<void>((resolve) => { releaseAgents = resolve; }) : Promise.resolve();
export const qa = { delayed, pending, releaseAgents, calls: [] as Array<{ command: string; path?: string | null }>,
  workspaceWrites: [] as string[], failPersistence: false, failClose: false,
  release: (path: string) => { delayed.delete(path); pending.get(path)?.(); pending.delete(path); } };
const originalWrite = Storage.prototype.setItem;
Storage.prototype.setItem = function (key, value) {
  if (key === WORKSPACE_STATE_KEY) {
    if (qa.failPersistence) throw new Error("QA storage full");
    qa.workspaceWrites.push(value);
  }
  originalWrite.call(this, key, value);
};

Object.assign(window, { qa, __TAURI_INTERNALS__: {
  invoke: async (command: string, args?: { path?: string | null }) => {
    qa.calls.push({ command, path: args?.path });
    if (command === "project_open") {
      const path = args?.path ?? "/qa/default";
      if (delayed.has(path)) await new Promise<void>((resolve) => { pending.set(path, resolve); });
      if (path === "/qa/missing") throw new Error("QA missing directory");
      return project(path);
    }
    if (command === "agent_detect") {
      await agentGate;
      return (["codex", "claude"] as const).map((kind) => ({ kind, descriptor: agentDescriptor(kind),
        available: true, executable: `/qa/${kind}`, version: "1", reason: null }));
    }
    if (command === "terminal_shell_profiles") return [{ id: "system-default", available: true, executable: "/bin/sh", isDefault: true, reason: null }];
    if (command === "terminal_close_tab") {
      if (qa.failClose) throw new Error("QA close failed");
      return null;
    }
    throw new Error(`QA 未提供原生命令：${command}`);
  },
} });

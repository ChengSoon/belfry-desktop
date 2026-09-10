import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrokerClient } from "./brokerClient";
import { CommandClient } from "./commandClient";
import { PatchClient } from "./patchClient";
import { HarnessRegistryClient, type HarnessPlugin } from "./registryClient";
import { HarnessSessionRuntime, type RuntimeState } from "./sessionRuntime";
import { TauriWorkerTransport } from "./tauriTransport";
import { useApprovalQueue, type ApprovalQueue } from "./approvalState";

export interface HarnessTabState { plugin: HarnessPlugin; grants: string[]; runtime: RuntimeState; cancelled: boolean; resumable: boolean; error?: string }
interface LaunchInput { agentId: string; plugin: HarnessPlugin; projectRoot: string; createTab: () => Promise<string | null> }

export function runnablePlugins(plugins: HarnessPlugin[]) {
  return plugins.filter((item) => item.trusted && item.enabled && item.harnessApi === 1 && versionAtLeast("0.19.0", item.minAppVersion));
}

export class HarnessSessionCoordinator {
  readonly sessions = new Map<string, { runtime: HarnessSessionRuntime; state: HarnessTabState; sessionId: string }>();
  constructor(private readonly createRuntime: (input: LaunchInput & { sessionId: string; workerId: string; grants: string[] }) => HarnessSessionRuntime, private readonly authorize: (sessionId: string, plugin: HarnessPlugin) => Promise<boolean> = async () => true, private readonly invalidate: (sessionId: string) => void = () => {}) {}
  async launch(input: LaunchInput) {
    const sessionId = crypto.randomUUID();
    const allowed = input.plugin.capabilities.length === 0 || await this.authorize(sessionId, input.plugin);
    if (!allowed) throw new Error("Harness capabilities were denied");
    const grants = [...input.plugin.capabilities];
    const runtime = this.createRuntime({ ...input, sessionId, workerId: crypto.randomUUID(), grants });
    try {
      await runtime.start();
      const tabId = await input.createTab();
      if (!tabId) throw new Error("Agent tab was not created");
      this.sessions.set(tabId, { runtime, sessionId, state: { plugin: input.plugin, grants, runtime: runtime.state, cancelled: false, resumable: true } });
      return tabId;
    } catch (error) { await runtime.close(); throw error; }
  }
  async close(tabId: string) { const item = this.sessions.get(tabId); if (!item) return; this.sessions.delete(tabId); this.invalidate(item.sessionId); await item.runtime.close(); }
  async retain(tabIds: ReadonlySet<string>) { await Promise.all([...this.sessions.keys()].filter((id) => !tabIds.has(id)).map((id) => this.close(id))); }
  async revoke(tabId: string) { const item = this.sessions.get(tabId); if (!item) return; this.invalidate(item.sessionId); try { await item.runtime.authorize([]); item.state = { ...item.state, grants: [], runtime: item.runtime.state }; } catch { item.state = { ...item.state, runtime: "reconcile-required", error: "授权同步失败，需要重新协调" }; } }
}

export function useHarnessSessions() {
  const [plugins, setPlugins] = useState<HarnessPlugin[]>([]);
  const [states, setStates] = useState<Map<string, HarnessTabState>>(new Map());
  const registry = useMemo(() => new HarnessRegistryClient(), []);
  const approval = useApprovalQueue();
  const coordinator = useRef<HarnessSessionCoordinator | null>(null);
  if (!coordinator.current) coordinator.current = new HarnessSessionCoordinator((input) => runtime(input, registry, approval.queue), (sessionId, plugin) => approval.queue.capability(sessionId, plugin), (sessionId) => approval.queue.rejectSession(sessionId));
  useEffect(() => { let live = true; void registry.list().then((state) => { if (live) setPlugins(runnablePlugins(state.plugins)); }).catch(() => { if (live) setPlugins([]); }); return () => { live = false; approval.queue.rejectAll(); void coordinator.current?.retain(new Set()); }; }, [approval.queue, registry]);
  const launch = useCallback(async (input: LaunchInput) => { const id = await coordinator.current!.launch(input); setStates(new Map([...coordinator.current!.sessions].map(([key, value]) => [key, value.state]))); return id; }, []);
  const close = useCallback(async (id: string) => { await coordinator.current!.close(id); setStates(new Map([...coordinator.current!.sessions].map(([key, value]) => [key, value.state]))); }, []);
  const retain = useCallback((ids: ReadonlySet<string>) => { void coordinator.current!.retain(ids).then(() => setStates(new Map([...coordinator.current!.sessions].map(([key, value]) => [key, value.state])))); }, []);
  const revoke = useCallback(async (id: string) => { await coordinator.current!.revoke(id); setStates(new Map([...coordinator.current!.sessions].map(([key, value]) => [key, value.state]))); }, []);
  return { plugins, states, launch, close, retain, revoke, approval };
}

function runtime(input: LaunchInput & { sessionId: string; workerId: string; grants: string[] }, registry: HarnessRegistryClient, approval: ApprovalQueue) {
  const bridge = { invoke: (command: string, args?: Record<string, unknown>) => invoke(command, args) };
  const broker = new BrokerClient(bridge); const patch = new PatchClient(bridge, (preview, request) => approval.patch(input.plugin.pluginId, preview, request)); const command = new CommandClient(bridge, (item, request) => approval.command(input.plugin.pluginId, item.expiresAt, request));
  return new HarnessSessionRuntime({ sessionId: input.sessionId, workerId: input.workerId, agentId: input.agentId, pluginId: input.plugin.pluginId, projectRoot: input.projectRoot, grants: input.grants }, { registry, broker, patch, command, cancelCommand: (sessionId) => bridge.invoke("harness_command_cancel", { sessionId }), startWorker: (sessionId, onMessage, onFailure) => TauriWorkerTransport.startSession(sessionId, onMessage, (failure) => { approval.rejectSession(sessionId); onFailure(failure); }) }, () => {});
}
function versionAtLeast(host: string, minimum: string) { const parse = (v: string) => v.split(".").map(Number); const a = parse(host); const b = parse(minimum); return [0, 1, 2].every((i) => Number.isInteger(b[i])) && (a[0] > b[0] || a[0] === b[0] && (a[1] > b[1] || a[1] === b[1] && a[2] >= b[2])); }

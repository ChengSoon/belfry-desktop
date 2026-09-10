import { invoke } from "@tauri-apps/api/core";

export interface HarnessPlugin {
  pluginId: string;
  version: string;
  manifestDigest: string;
  harnessApi: number;
  minAppVersion: string;
  trusted: boolean;
  enabled: boolean;
  source: string;
  tools: string[];
  capabilities: string[];
}

export interface HarnessSessionSnapshot {
  sessionId: string;
  agentId: string;
  plugin: HarnessPlugin;
  workerId: string;
  projectRoot: string;
  grants: string[];
  cancelled: boolean;
  resumable: boolean;
}

export interface HarnessRegistryState {
  schemaVersion: number;
  revision: string;
  plugins: HarnessPlugin[];
  history: HarnessPlugin[];
  sessions: HarnessSessionSnapshot[];
}
export interface HarnessInstallPreview {
  previewId: string; expectedRevision: string; pluginId: string; version: string;
  capabilities: string[]; workerDigest: string; trust: "local-user-approved/integrity-checked"; signed: false;
}

interface Bridge { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> }
const defaultBridge: Bridge = { invoke: (command, args) => invoke(command, args) };

export class HarnessRegistryClient {
  constructor(private readonly bridge: Bridge = defaultBridge) {}

  async list() {
    return registryState(await this.bridge.invoke("harness_registry_list"));
  }

  async install(expectedRevision: string, plugin: HarnessPlugin) {
    return registryState(await this.bridge.invoke("harness_registry_install", { expectedRevision, plugin }));
  }

  async update(expectedRevision: string, plugin: HarnessPlugin) {
    return registryState(await this.bridge.invoke("harness_registry_update", { expectedRevision, plugin }));
  }

  async disable(expectedRevision: string, pluginId: string) {
    return registryState(await this.bridge.invoke("harness_registry_disable", { expectedRevision, pluginId }));
  }

  async uninstall(expectedRevision: string, pluginId: string) {
    return registryState(await this.bridge.invoke("harness_registry_uninstall", { expectedRevision, pluginId }));
  }

  async snapshot(input: Omit<HarnessSessionSnapshot, "plugin" | "grants" | "cancelled" | "resumable"> & { pluginId: string }) {
    return sessionSnapshot(await this.bridge.invoke("harness_session_snapshot", input));
  }

  async authorize(sessionId: string, grants: string[]) {
    return sessionSnapshot(await this.bridge.invoke("harness_session_authorize", { sessionId, grants }));
  }

  async startSessionWorker(sessionId: string) {
    const workerId = await this.bridge.invoke("harness_session_worker_start", { sessionId });
    if (typeof workerId !== "string" || !workerId) throw new Error("Invalid Harness worker ID");
    return workerId;
  }

  async previewInstall(manifestPath: string, workerPath: string) {
    return installPreview(await this.bridge.invoke("harness_registry_install_preview", { manifestPath, workerPath }));
  }
  async commitInstall(previewId: string) {
    return registryState(await this.bridge.invoke("harness_registry_install_commit", { previewId }));
  }
  async cancelInstall(previewId: string) {
    await this.bridge.invoke("harness_registry_install_cancel", { previewId });
  }
}

function installPreview(value: unknown): HarnessInstallPreview {
  if (!isRecord(value) || typeof value.previewId !== "string" || typeof value.pluginId !== "string" ||
      typeof value.version !== "string" || typeof value.workerDigest !== "string" || !Array.isArray(value.capabilities) ||
      value.trust !== "local-user-approved/integrity-checked" || value.signed !== false) throw new Error("Invalid Harness install preview");
  return value as unknown as HarnessInstallPreview;
}

function registryState(value: unknown): HarnessRegistryState {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.revision !== "string") throw new Error("Invalid Harness registry state");
  if (!Array.isArray(value.plugins) || !Array.isArray(value.history) || !Array.isArray(value.sessions)) throw new Error("Invalid Harness registry state");
  return value as unknown as HarnessRegistryState;
}

function sessionSnapshot(value: unknown): HarnessSessionSnapshot {
  if (!isRecord(value) || typeof value.sessionId !== "string" || typeof value.workerId !== "string") throw new Error("Invalid Harness session snapshot");
  if (!isRecord(value.plugin) || !Array.isArray(value.grants) || typeof value.cancelled !== "boolean") throw new Error("Invalid Harness session snapshot");
  return value as unknown as HarnessSessionSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

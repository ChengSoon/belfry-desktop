import type { HarnessEvent, RpcResponse } from "./protocol";
import type { HarnessPlugin, HarnessSessionSnapshot } from "./registryClient";
import { HarnessSupervisor, type WorkerTransport } from "./supervisor";

export type RuntimeState = "starting" | "running" | "reconcile-required" | "closed";
interface RegistryClient {
  snapshot(input: { sessionId: string; agentId: string; pluginId: string; workerId: string; projectRoot: string }): Promise<HarnessSessionSnapshot>;
  authorize(sessionId: string, grants: string[]): Promise<HarnessSessionSnapshot>;
}
interface BrokerClient {
  register(registration: Record<string, unknown>): Promise<unknown>;
  updateGrants(sessionId: string, grants: string[]): Promise<unknown>;
  cancel(sessionId: string): Promise<unknown>;
  route(workerId: string, value: unknown, transport: WorkerTransport): Promise<boolean>;
}
interface ToolRouter { route(workerId: string, value: unknown, transport: WorkerTransport): Promise<boolean> }
interface RuntimeDeps {
  registry: RegistryClient;
  broker: BrokerClient;
  patch: ToolRouter;
  command: ToolRouter;
  startWorker(sessionId: string, onMessage: (value: unknown) => void, onFailure: (failure: { code: string; message?: string }) => void): Promise<WorkerTransport & { workerId: string }>;
  cancelCommand(sessionId: string): Promise<unknown>;
}
export interface SessionConfig { sessionId: string; agentId: string; pluginId: string; projectRoot: string; grants: string[]; workerId?: string }

export class HarnessSessionRuntime {
  private stateValue: RuntimeState = "starting";
  private transport?: WorkerTransport & { workerId: string };
  private supervisor?: HarnessSupervisor;
  private snapshot?: HarnessSessionSnapshot;
  private readonly terminal = new Set<string>();
  private readonly inbox: unknown[] = [];

  constructor(private readonly config: SessionConfig, private readonly deps: RuntimeDeps, private readonly emit: (event: HarnessEvent) => void) {}
  get state() { return this.stateValue; }

  async start() {
    try {
      const workerId = this.config.workerId ?? crypto.randomUUID();
      this.snapshot = await this.deps.registry.snapshot({ ...this.config, workerId });
      this.assertStarting();
      this.snapshot = await this.deps.registry.authorize(this.config.sessionId, this.config.grants);
      this.assertStarting();
      await this.deps.broker.register(registration(this.snapshot));
      await this.syncGrants(this.snapshot.grants);
      this.transport = await this.deps.startWorker(this.config.sessionId, (value) => this.receive(value), (failure) => void this.crash(failure));
      if (this.transport.workerId !== workerId) throw new Error("Harness worker ID does not match snapshot");
      this.assertStarting();
      this.supervisor = new HarnessSupervisor(this.transport, this.emit);
      this.stateValue = "running";
      this.supervisor.initialize();
      this.supervisor.start(this.config.sessionId);
      for (const value of this.inbox.splice(0)) await this.handle(value);
    } catch (error) {
      if (this.stateValue === "reconcile-required") await this.cleanupForReconcile();
      else await this.close();
      throw error;
    }
  }

  async authorize(grants: string[]) {
    this.assertRunning();
    const snapshot = await this.deps.registry.authorize(this.config.sessionId, grants);
    this.snapshot = snapshot;
    try { await this.syncGrants(snapshot.grants); }
    catch (error) { await this.cleanupForReconcile(); throw error; }
    return snapshot;
  }

  async handle(value: unknown) {
    if (this.stateValue !== "running" || !this.transport) return false;
    const request = toolRequest(value);
    if (!request) return this.supervisor?.handle(value) ?? false;
    const key = `${request.sessionId}\0${request.id}\0${request.toolId}`;
    if (this.terminal.has(key)) return true;
    if (request.sessionId !== this.config.sessionId) return this.failTool(request, "SESSION_MISMATCH", "tool request session mismatch", key);
    const routers = [this.deps.broker, this.deps.patch, this.deps.command];
    for (const router of routers) {
      if (await router.route(this.transport.workerId, value, this.transport)) { this.terminal.add(key); return true; }
    }
    return this.failTool(request, "TOOL_UNDECLARED", "tool is not supported", key);
  }

  async cancel() { await this.finish(true, { code: "SESSION_CANCELLED" }); }
  async crash(failure: { code: string; message?: string }) { await this.finish(false, failure); }
  async close() { await this.finish(true, { code: "WORKER_CLOSED" }); }

  private async syncGrants(grants: string[]) {
    try { await this.deps.broker.updateGrants(this.config.sessionId, grants); }
    catch (error) { this.stateValue = "reconcile-required"; throw error; }
  }

  private async finish(graceful: boolean, failure: { code: string; message?: string }) {
    if (this.stateValue === "closed") return;
    this.stateValue = "closed";
    await Promise.allSettled([this.deps.broker.cancel(this.config.sessionId), this.deps.cancelCommand(this.config.sessionId)]);
    if (this.supervisor) graceful ? this.supervisor.close() : this.supervisor.crashed(failure);
    else this.transport?.close();
  }

  private async cleanupForReconcile() {
    await Promise.allSettled([this.deps.broker.cancel(this.config.sessionId), this.deps.cancelCommand(this.config.sessionId)]);
    this.transport?.close();
  }
  private receive(value: unknown) {
    if (this.stateValue === "starting") this.inbox.push(value);
    else void this.handle(value);
  }

  private failTool(request: ToolShape, code: string, message: string, key: string) {
    const response: RpcResponse = { jsonrpc: "2.0", id: request.id, sessionId: request.sessionId, error: { code, message } };
    this.transport!.send(response); this.terminal.add(key); return true;
  }
  private assertRunning() { if (this.stateValue !== "running") throw new Error(`Harness session is ${this.stateValue}`); }
  private assertStarting() { if (this.stateValue !== "starting") throw new Error(`Harness session is ${this.stateValue}`); }
}

interface ToolShape { id: string; sessionId: string; toolId: string }
function toolRequest(value: unknown): ToolShape | undefined {
  if (!record(value) || value.method !== "tool/request" || typeof value.id !== "string" || typeof value.sessionId !== "string" || !record(value.params) || typeof value.params.toolId !== "string") return;
  return { id: value.id, sessionId: value.sessionId, toolId: value.params.toolId };
}
function registration(snapshot: HarnessSessionSnapshot) {
  const plugin: HarnessPlugin = snapshot.plugin;
  return { sessionId: snapshot.sessionId, workerId: snapshot.workerId, projectRoot: snapshot.projectRoot, harnessId: plugin.pluginId, harnessVersion: plugin.version, declaredTools: plugin.tools, grantedCapabilities: snapshot.grants };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }

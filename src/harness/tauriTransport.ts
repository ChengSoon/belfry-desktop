import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RpcRequest, RpcResponse } from "./protocol";
import type { WorkerTransport } from "./supervisor";

export interface WorkerEnvelope {
  workerId: string;
  kind: "message" | "lifecycle" | "diagnostic";
  message?: unknown;
  lifecycle?: "running" | "shutdown" | "cancelled" | "unexpected-exit" | "protocol-failed" | "force-terminated";
  detail?: string;
}

interface TauriBridge {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  listen(event: string, handler: (event: { payload: WorkerEnvelope }) => void): Promise<UnlistenFn>;
}

const defaultBridge: TauriBridge = {
  invoke: (command, args) => invoke(command, args),
  listen,
};

export class TauriWorkerTransport implements WorkerTransport {
  private closed = false;

  private constructor(
    readonly workerId: string,
    private readonly unlisten: UnlistenFn,
    private readonly onFailure: (failure: { code: string; message?: string }) => void,
    private readonly bridge: TauriBridge,
  ) {}

  static async start(
    entry: string,
    args: string[],
    onMessage: (message: unknown) => void,
    onFailure: (failure: { code: string; message?: string }) => void,
    bridge: TauriBridge = defaultBridge,
  ) {
    return this.open(() => bridge.invoke("harness_worker_start", { entry, args }), onMessage, onFailure, bridge);
  }

  static async startSession(
    sessionId: string,
    onMessage: (message: unknown) => void,
    onFailure: (failure: { code: string; message?: string }) => void,
    bridge: TauriBridge = defaultBridge,
  ) {
    return this.open(() => bridge.invoke("harness_session_worker_start", { sessionId }), onMessage, onFailure, bridge);
  }

  private static async open(
    start: () => Promise<unknown>,
    onMessage: (message: unknown) => void,
    onFailure: (failure: { code: string; message?: string }) => void,
    bridge: TauriBridge,
  ) {
    let workerId: string | undefined;
    const queued: WorkerEnvelope[] = [];
    const dispatch = (payload: WorkerEnvelope) => {
      if (!workerId) { queued.push(payload); return; }
      if (payload.workerId !== workerId) return;
      if (payload.kind === "message") onMessage(payload.message);
      if (payload.kind === "lifecycle" && ["unexpected-exit", "protocol-failed", "force-terminated"].includes(payload.lifecycle ?? "")) {
        onFailure({ code: lifecycleCode(payload.lifecycle), message: payload.detail });
      }
    };
    const unlisten = await bridge.listen("harness-worker", (event) => dispatch(event.payload));
    try {
      const started = await start();
      if (typeof started !== "string") throw new Error("Invalid worker ID returned by host");
      workerId = started;
      queued.splice(0).forEach(dispatch);
      return new TauriWorkerTransport(workerId, unlisten, onFailure, bridge);
    } catch (error) {
      unlisten();
      throw error;
    }
  }

  send(request: RpcRequest | RpcResponse) {
    if (this.closed) throw new Error("Harness worker transport is closed");
    void this.bridge.invoke("harness_worker_send", { workerId: this.workerId, request })
      .catch((error) => this.onFailure({ code: "WORKER_SEND_FAILED", message: String(error) }));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.unlisten();
    void this.bridge.invoke("harness_worker_stop", { workerId: this.workerId })
      .catch((error) => this.onFailure({ code: "WORKER_STOP_FAILED", message: String(error) }));
  }
}

function lifecycleCode(lifecycle: WorkerEnvelope["lifecycle"]) {
  if (lifecycle === "protocol-failed") return "WORKER_PROTOCOL_FAILED";
  if (lifecycle === "force-terminated") return "WORKER_FORCE_TERMINATED";
  return "WORKER_EXITED";
}

import { invoke } from "@tauri-apps/api/core";
import type { ConnectionDraft, ConnectionInfo, Discovery, LocalDiscovery, ProtocolTaskSnapshot } from "./contracts";

export const listConnections = (rootPath: string) =>
  invoke<ConnectionInfo[]>("a2a_list_connections", { rootPath });
export const listLocalAgents = (rootPath: string) =>
  invoke<LocalDiscovery>("a2a_list_local_agents", { rootPath });
export const localTaskSnapshot = (rootPath: string) =>
  invoke<ProtocolTaskSnapshot>("a2a_local_task_snapshot", { rootPath });
export const saveConnection = (rootPath: string, draft: ConnectionDraft) =>
  invoke<ConnectionInfo>("a2a_save_connection", { rootPath, draft });
export const removeConnection = (rootPath: string, connectionId: string) =>
  invoke<null>("a2a_remove_connection", { rootPath, connectionId });
export const cancelRequest = (rootPath: string, requestId: string) =>
  invoke<boolean>("a2a_cancel_request", { rootPath, requestId });

export function isProbeCancelled(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

/** Native IPC has no AbortSignal. Cancel the host HTTP request and settle locally
 * so a late native reply cannot update a different project or newer editor. */
export function probeConnection(rootPath: string, draft: ConnectionDraft, signal?: AbortSignal): Promise<Discovery> {
  const aborted = () => new DOMException("A2A connection check cancelled", "AbortError");
  if (signal?.aborted) return Promise.reject(aborted());
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = () => finish(() => {
      void cancelRequest(rootPath, requestId).catch(() => {});
      reject(aborted());
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    try {
      invoke<Discovery>("a2a_probe_connection", { rootPath, draft, requestId }).then(
        value => finish(() => resolve(value)), error => finish(() => reject(error)),
      );
    } catch (error) { finish(() => reject(error)); }
  });
}

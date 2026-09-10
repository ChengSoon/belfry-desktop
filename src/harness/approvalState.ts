import { useMemo, useSyncExternalStore } from "react";
import type { CommandToolRequest, PatchPreview, PatchToolRequest } from "./protocol";
import type { HarnessPlugin } from "./registryClient";

interface BaseItem { id: string; sessionId: string; pluginId: string; tool: string; expiresAt: number }
export type ApprovalItem =
  | BaseItem & { kind: "capability"; capabilities: string[] }
  | BaseItem & { kind: "patch"; path: string; oldLines: number; newLines: number; finalBytes: number; digest: string; diff: PatchPreview["diff"] }
  | BaseItem & { kind: "command"; executable: string; argv: string[]; cwd: string; timeoutMs: number; envKeys: string[] };
interface Pending { view: ApprovalItem; settle: (allowed: boolean) => void; timer?: ReturnType<typeof setTimeout> }

export class ApprovalQueue {
  private readonly pending: Pending[] = [];
  private readonly listeners = new Set<() => void>();
  private snapshotValue: ApprovalItem[] = [];
  snapshot = () => this.snapshotValue;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  decide(id: string, allowed: boolean) { const item = this.remove(id); item?.settle(allowed); }
  rejectSession(sessionId: string) { for (const item of this.pending.filter((x) => x.view.sessionId === sessionId)) this.decide(item.view.id, false); }
  rejectAll() { for (const item of [...this.pending]) this.decide(item.view.id, false); }

  capability(sessionId: string, plugin: HarnessPlugin) {
    return this.enqueue({ kind: "capability", id: crypto.randomUUID(), sessionId, pluginId: plugin.pluginId, tool: "session.authorize", expiresAt: Date.now() + 60_000, capabilities: [...plugin.capabilities] });
  }
  patch(pluginId: string, preview: PatchPreview, request: PatchToolRequest) {
    return this.enqueue({ kind: "patch", id: crypto.randomUUID(), sessionId: request.sessionId, pluginId, tool: "project.patch.propose", expiresAt: preview.expiresAt, path: preview.relativePath, oldLines: preview.oldLines, newLines: preview.newLines, finalBytes: preview.finalBytes, digest: preview.replacementDigest.slice(0, 20), diff: preview.diff });
  }
  command(pluginId: string, expiresAt: number, request: CommandToolRequest) {
    const p = request.params;
    return this.enqueue({ kind: "command", id: crypto.randomUUID(), sessionId: request.sessionId, pluginId, tool: "command.exec", expiresAt, executable: p.executable, argv: [...(p.argv ?? [])], cwd: p.cwd ?? ".", timeoutMs: p.timeoutMs ?? 30_000, envKeys: Object.keys(p.env ?? {}).sort() });
  }

  private enqueue(view: ApprovalItem) {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const pending: Pending = { view, settle: (allowed) => { if (settled) return; settled = true; if (pending.timer) clearTimeout(pending.timer); resolve(allowed); } };
      const delay = Math.max(0, Math.min(view.expiresAt - Date.now(), 10 * 60_000));
      pending.timer = setTimeout(() => this.decide(view.id, false), delay);
      this.pending.push(pending); this.emit();
    });
  }
  private remove(id: string) { const index = this.pending.findIndex((item) => item.view.id === id); if (index < 0) return; const [item] = this.pending.splice(index, 1); this.emit(); return item; }
  private emit() { this.snapshotValue = this.pending.map((item) => item.view); for (const listener of this.listeners) listener(); }
}

export function useApprovalQueue() {
  const queue = useMemo(() => new ApprovalQueue(), []);
  const items = useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot);
  return { queue, items, active: items[0], decide: (allowed: boolean) => { if (items[0]) queue.decide(items[0].id, allowed); } };
}

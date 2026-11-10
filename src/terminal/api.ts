import { invoke, type Channel } from "@tauri-apps/api/core";
import type {
  CreateTerminalRequest,
  ShellProfile,
  SshTarget,
  TerminalEvent,
  TerminalPalette,
  TerminalSession,
  OutputReceipt,
} from "./contracts";

export function listShellProfiles() {
  return invoke<ShellProfile[]>("terminal_shell_profiles");
}

export function createTerminal(
  request: CreateTerminalRequest,
  onEvent: Channel<TerminalEvent>,
  attachment?: string | null,
  recoverExited = false,
) {
  return invoke<TerminalSession>("terminal_create", { request, onEvent, attachment: attachment ?? null, recoverExited, flowControl: true });
}

export function acknowledgeTerminalOutput(receipt: OutputReceipt) {
  return invoke<boolean>("terminal_ack_output", { ...receipt });
}

/** 收件箱批次的原生写入许可：一批的每次程序化写入都带同一 guard，writeSequence 从 1 连续递增。 */
export interface TerminalWriteGuard { guard: import("../inbox/contracts").WriteGuard; sequence: number }

export function writeTerminal(sessionId: string, bytes: Uint8Array, guarded?: TerminalWriteGuard) {
  return invoke<void>("terminal_write", {
    sessionId,
    bytes: Array.from(bytes),
    // 用户输入不带 guard：Rust 在仲裁锁下推进 inputRevision 并撤销旧 offer。
    ...(guarded ? { inboxGuard: guarded.guard, writeSequence: guarded.sequence } : {}),
  });
}

export function resizeTerminal(sessionId: string, cols: number, rows: number) {
  return invoke<void>("terminal_resize", { sessionId, cols, rows });
}

export function setTerminalPalette(sessionId: string, palette: TerminalPalette) {
  return invoke<void>("terminal_set_palette", { sessionId, palette });
}

export function closeTerminal(sessionId: string) {
  return invoke<void>("terminal_close", { sessionId });
}

export function closeTerminalTab(tabId: string) { return invoke<void>("terminal_close_tab", { tabId }); }

export function detachTerminal(session: Pick<TerminalSession, "id" | "connectionId">) {
  return session.connectionId
    ? invoke<void>("terminal_detach", { sessionId: session.id, connectionId: session.connectionId })
    : closeTerminal(session.id);
}

export function removeSshCredentials(target: SshTarget) {
  return invoke<void>("ssh_credentials_remove", { target });
}

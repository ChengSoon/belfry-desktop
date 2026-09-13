import { invoke, type Channel } from "@tauri-apps/api/core";
import type {
  CreateTerminalRequest,
  ShellProfile,
  SshTarget,
  TerminalEvent,
  TerminalPalette,
  TerminalSession,
} from "./contracts";

export function listShellProfiles() {
  return invoke<ShellProfile[]>("terminal_shell_profiles");
}

export function createTerminal(
  request: CreateTerminalRequest,
  onEvent: Channel<TerminalEvent>,
  attachment?: string | null,
) {
  return invoke<TerminalSession>("terminal_create", { request, onEvent, attachment: attachment ?? null });
}

export function writeTerminal(sessionId: string, bytes: Uint8Array) {
  return invoke<void>("terminal_write", {
    sessionId,
    bytes: Array.from(bytes),
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

export function detachTerminal(session: TerminalSession) {
  return session.connectionId
    ? invoke<void>("terminal_detach", { sessionId: session.id, connectionId: session.connectionId })
    : closeTerminal(session.id);
}

export function removeSshCredentials(target: SshTarget) {
  return invoke<void>("ssh_credentials_remove", { target });
}

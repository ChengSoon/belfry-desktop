import { invoke, type Channel } from "@tauri-apps/api/core";
import type {
  CreateTerminalRequest,
  SshTarget,
  TerminalEvent,
  TerminalPalette,
  TerminalSession,
} from "./contracts";

export function createTerminal(
  request: CreateTerminalRequest,
  onEvent: Channel<TerminalEvent>,
) {
  return invoke<TerminalSession>("terminal_create", { request, onEvent });
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

export function removeSshCredentials(target: SshTarget) {
  return invoke<void>("ssh_credentials_remove", { target });
}

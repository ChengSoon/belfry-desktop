export type Platform = "macos" | "windows";
export type TerminalPhase = "idle" | "creating" | "running" | "exited" | "error";
export type LaunchProfileId = "system-default" | "agent:codex" | "agent:claude";

export interface TerminalLaunch {
  profileId: LaunchProfileId;
  cwd: string | null;
}

export interface CreateTerminalRequest {
  platform: Platform;
  profileId: LaunchProfileId;
  cwd: string | null;
  command: null;
  env: Record<string, string>;
  cols: number;
  rows: number;
  elevation: "normal";
}

export interface TerminalSession {
  id: string;
  platform: Platform;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  status: "starting" | "running" | "exited" | "failed";
  exitCode: number | null;
}

export type TerminalEvent =
  | {
      kind: "output";
      sessionId: string;
      sequence: number;
      bytes: number[];
      eof: boolean;
    }
  | {
      kind: "exit";
      sessionId: string;
      exitCode: number;
      reason: "normal" | "terminated" | "spawn_failed" | "io_failed";
    };

export function createTerminalRequest(
  cols: number,
  rows: number,
  launch: TerminalLaunch,
  userAgent = navigator.userAgent,
): CreateTerminalRequest {
  return {
    platform: userAgent.includes("Windows") ? "windows" : "macos",
    profileId: launch.profileId,
    cwd: launch.cwd,
    command: null,
    env: {},
    cols,
    rows,
    elevation: "normal",
  };
}

export function createDefaultRequest(cols: number, rows: number, userAgent = navigator.userAgent) {
  return createTerminalRequest(
    cols,
    rows,
    { profileId: "system-default", cwd: null },
    userAgent,
  );
}

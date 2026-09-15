import { invoke } from "@tauri-apps/api/core";
import type { DiffRequest, GitDiff, GitStatus } from "./contracts";

export function readGitStatus(rootPath: string) {
  return invoke<GitStatus>("git_status", { rootPath });
}

export function readGitDiff(request: DiffRequest) {
  return invoke<GitDiff>("git_diff", { request });
}

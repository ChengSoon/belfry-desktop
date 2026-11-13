import { invoke } from "@tauri-apps/api/core";
import type { DiffRequest, GitBranch, GitDiff, GitStatus } from "./contracts";

export function readGitStatus(rootPath: string) {
  return invoke<GitStatus>("git_status", { rootPath });
}

export function readGitDiff(request: DiffRequest) {
  return invoke<GitDiff>("git_diff", { request });
}

/** 只读分支名（不扫描工作区），给顶栏面包屑用。 */
export function readGitBranch(rootPath: string) {
  return invoke<GitBranch>("git_branch", { rootPath });
}

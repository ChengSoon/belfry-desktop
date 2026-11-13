export type DiffStage = "staged" | "unstaged" | "untracked";

export interface GitEntry {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  untracked: boolean;
  conflicted: boolean;
  submodule: boolean;
}

export interface GitStatus {
  repository: boolean;
  rootPath: string;
  branch: string | null;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  entries: GitEntry[];
  truncated: boolean;
}

export interface GitDiff { text: string; binary: boolean; truncated: boolean }
export interface DiffRequest { rootPath: string; path: string; stage: DiffStage }
export interface GitFileTarget { rootPath: string; path: string }

/** `git_branch` 的结果：非仓库时 repository=false；分离 HEAD 时 branch=null、detached 为短提交号。 */
export interface GitBranch {
  repository: boolean;
  branch: string | null;
  detached: string | null;
}

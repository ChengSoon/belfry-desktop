export interface ManagedWorktree {
  id: string; name: string; rootPath: string; repositoryPath: string; commonDir: string;
  branch: string; baseBranch: string; baseHead: string; state: "creating" | "ready" | "incomplete" | "removed";
}
export interface ExistingWorktree { rootPath: string; branch: string | null; head: string; locked: boolean }
export interface WorktreeReport { rootPath: string; branch: string; branches: string[]; worktrees: ExistingWorktree[]; managed: ManagedWorktree[] }
export interface CreateInput { rootPath: string; name: string; branch: string; baseBranch: string }
export type WorktreeAction = "commit" | "merge" | "cleanup";
export interface ActionInput { id: string; action: WorktreeAction; message?: string; targetPath?: string }
export interface WorktreePreview { token: string; title: string; rootPath: string; branch: string; targetPath: string | null; files: string[]; diff: string; notes: string[] }
export interface ActionResult { message: string; worktree: ManagedWorktree | null; conflicts: string[] }

import { invoke } from "@tauri-apps/api/core";
import type { ActionInput, ActionResult, CreateInput, WorktreePreview, WorktreeReport } from "./contracts";

export const listWorktrees = (rootPath: string) => invoke<WorktreeReport>("worktree_list", { rootPath });
export const previewCreate = (input: CreateInput) => invoke<WorktreePreview>("worktree_preview_create", { input });
export const previewAction = (input: ActionInput) => invoke<WorktreePreview>("worktree_preview_action", { input });
export const executeWorktree = (token: string) => invoke<ActionResult>("worktree_execute", { token });

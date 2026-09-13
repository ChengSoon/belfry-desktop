import { invoke } from "@tauri-apps/api/core";
import type { AgentKind } from "../contracts";
import type { AgentHookReport, HookInstallPreview } from "./contracts";

export const readHooks = () => invoke<AgentHookReport[]>("agent_hooks_report");
export const previewHooks = (kind: AgentKind, enabled: boolean) => invoke<HookInstallPreview>("agent_hooks_preview", { kind, enabled });
export const applyHooks = (previewId: string) => invoke<void>("agent_hooks_apply", { previewId });
export const cancelHookPreview = (previewId: string) => invoke<void>("agent_hooks_cancel", { previewId });

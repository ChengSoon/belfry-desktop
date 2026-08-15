import { invoke } from "@tauri-apps/api/core";
import type { AgentKind } from "../workspace/contracts";
import type { ProviderCatalog, ProviderDraft, SwitchOutcome } from "./contracts";

export function listProviders() {
  return invoke<ProviderCatalog>("provider_list");
}

export function saveProvider(kind: AgentKind, draft: ProviderDraft) {
  return invoke<ProviderCatalog>("provider_save", { kind, draft });
}

export function removeProvider(kind: AgentKind, id: string) {
  return invoke<ProviderCatalog>("provider_remove", { kind, id });
}

/** `id` 传 null 表示切回官方。 */
export function switchProvider(kind: AgentKind, id: string | null) {
  return invoke<SwitchOutcome>("provider_switch", { kind, id });
}

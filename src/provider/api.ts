import { invoke } from "@tauri-apps/api/core";
import type { AgentKind } from "../workspace/contracts";
import type { ConfigFilePreview, ProviderCatalog, ProviderDraft, SwitchOutcome } from "./contracts";

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

/** 读取配置预览；传入草稿时会先在内存中套用 Provider，不写入磁盘。 */
export function configPreview(kind: AgentKind, draft?: ProviderDraft) {
  if (draft) {
    return invoke<ConfigFilePreview[]>("provider_config_preview_for_draft", { kind, draft });
  }
  return invoke<ConfigFilePreview[]>("provider_config_preview", { kind });
}

/** 保存编辑后的配置文件全文。服务端先校验格式，失败时原文件不动。 */
export function configSave(kind: AgentKind, path: string, content: string) {
  return invoke<void>("provider_config_save", { kind, path, content });
}

/** 配置文件被手动编辑后，把当前生效的 live 配置同步进库并返回新目录。 */
export function syncLiveProvider(kind: AgentKind) {
  return invoke<ProviderCatalog>("provider_sync_live", { kind });
}

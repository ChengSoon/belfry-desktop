import { Plus, RefreshCcw } from "lucide-react";
import { SettingsHeader } from "../../settings/SettingsHeader";
import { ICON } from "../../theme/sizing";

export function ProviderSettingsHeader({ busy, editing, onAdd, onReload }: {
  busy: boolean;
  editing: boolean;
  onAdd: () => void;
  onReload: () => void;
}) {
  return <SettingsHeader
    title="全局 Provider"
    description="管理 Claude Code 与 Codex 的默认模型服务。"
    actions={<>
      <button className="provider-add" disabled={busy || editing} onClick={onAdd} type="button">
        <Plus aria-hidden="true" size={ICON.sm} />新增 Provider
      </button>
      <button className="icon-button" disabled={busy || editing} onClick={onReload}
        aria-label="重新读取 Provider 列表" title="重新读取 Provider 列表" type="button">
        <RefreshCcw aria-hidden="true" size={ICON.sm} />
      </button>
    </>}
  />;
}

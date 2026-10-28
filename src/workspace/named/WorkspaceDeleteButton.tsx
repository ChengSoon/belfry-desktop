import { Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ICON } from "../../theme/sizing";
import type { NamedWorkspaces } from "./useNamedWorkspaces";

export function WorkspaceDeleteButton({ model, onDeleted }: { model: NamedWorkspaces; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const destination = model.collection.workspaces.find((item) => item.id !== model.current.id);
  const count = model.current.tabIds.length;
  const body = `删除「${model.current.name}」后将切换到「${destination?.name}」。`
    + (count ? `其中的 ${count} 个会话将迁入该工作区并继续运行。` : "此工作区中没有会话。")
    + "此工作区的名称与分屏布局将被移除。";
  return <div className="named-workspaces__delete">
    <button type="button" disabled={!destination} aria-describedby={!destination ? "workspace-delete-hint" : undefined}
      onClick={(event) => { event.currentTarget.focus(); setConfirming(true); }}>
      <Trash2 aria-hidden="true" size={ICON.xs} />删除工作区
    </button>
    {!destination ? <p id="workspace-delete-hint">至少保留一个工作区</p> : null}
    {confirming && destination ? <ConfirmDialog title="删除工作区？" body={body} confirmLabel="删除工作区"
      onCancel={() => setConfirming(false)} onConfirm={() => {
        const error = model.remove(destination.id);
        setConfirming(false);
        if (!error) onDeleted();
      }} /> : null}
  </div>;
}

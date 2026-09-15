import { Disclosure } from "../../components/controls/Disclosure";
import { Check, ChevronDown, CircleAlert, Layers2, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useFlyout } from "../../components/useFlyout";
import { ICON } from "../../theme/sizing";
import type { WorkspaceTab } from "../contracts";
import { MAX_WORKSPACES } from "./contracts";
import type { NamedWorkspaces } from "./useNamedWorkspaces";
import { WorkspaceNameForm } from "./WorkspaceNameForm";
import { WorkspaceSessionTools } from "./WorkspaceSessionTools";
import "./namedWorkspaces.css";

export interface WorkspaceControlsProps {
  model: NamedWorkspaces;
  activeTab: WorkspaceTab | null;
  onRepair: (id: string, path: string | null) => Promise<string | null>;
  persistenceError: string | null;
  onRetryPersistence: () => void;
}

export function NamedWorkspaceControls(props: WorkspaceControlsProps) {
  const { model } = props;
  const flyout = useFlyout();
  const issue = model.error || model.actionError || props.persistenceError;
  return (
    <div className="named-workspaces" aria-label="命名工作区" ref={flyout.root}>
      <button className="named-workspaces__trigger" ref={flyout.trigger} aria-label={`当前工作区：${model.current.name}`}
        aria-expanded={flyout.open} aria-haspopup="dialog" aria-controls={flyout.id} title={model.current.name} type="button" onClick={flyout.toggle}>
        <Layers2 aria-hidden="true" size={ICON.sm} /><span>{model.current.name}</span>
        {issue ? <CircleAlert className="named-workspaces__issue" aria-label="工作区需要处理" size={ICON.xs} /> : <ChevronDown aria-hidden="true" size={ICON.xs} />}
      </button>
      {issue ? <button className="named-workspaces__notice" type="button" onClick={flyout.toggle}>工作区需要处理</button> : null}
      {flyout.open ? <div className="named-workspaces__popover" id={flyout.id} role="dialog" aria-label="管理工作区">
        <WorkspaceMenu key={model.current.id} {...props} onSelect={flyout.close} />
      </div> : null}
    </div>
  );
}

export function WorkspaceMenu(props: WorkspaceControlsProps & { onSelect: () => void }) {
  const { model, activeTab, onRepair, onSelect } = props;
  const [form, setForm] = useState<"create" | "rename" | null>(null);
  if (form) return <WorkspaceNameForm key={form} mode={form} initial={form === "rename" ? model.current.name : ""}
    onSave={(name) => { const error = (form === "rename" ? model.rename : model.create)(name); if (!error) onSelect(); return error; }}
    onCancel={() => setForm(null)} />;
  return <>
    <div className="named-workspaces__list" aria-label="工作区列表">
      {model.collection.workspaces.map((item) => <button className="named-workspaces__item" key={item.id} type="button"
        aria-current={item.id === model.current.id || undefined} data-flyout-focus={item.id === model.current.id || undefined}
        onClick={() => { model.select(item.id); onSelect(); }}>
        <Check aria-hidden="true" size={ICON.sm} /><span>{item.name}</span><small>{item.tabIds.length} 个会话</small>
      </button>)}
    </div>
    <div className="named-workspaces__actions">
      <button type="button" disabled={model.collection.workspaces.length >= MAX_WORKSPACES} onClick={() => setForm("create")}><Plus size={ICON.sm} />新建工作区</button>
      <button type="button" onClick={() => setForm("rename")}><Pencil size={ICON.sm} />重命名</button>
    </div>
    {activeTab ? <WorkspaceSessionTools key={activeTab.id} model={model} tab={activeTab} onRepair={onRepair} /> : null}
    <WorkspaceSaveStatus {...props} />
    {model.actionError ? <p role="alert" className="named-workspaces__error">{model.actionError}</p> : null}
  </>;
}

function WorkspaceSaveStatus({ model, persistenceError, onRetryPersistence }: WorkspaceControlsProps) {
  return <>
    {model.error ? <Disclosure className="named-workspaces__status" defaultOpen title={<>工作区尚未保存</>}><p role="alert">{model.error}</p>
      <p>当前会话继续运行。重新读取会替换本次未保存的分组与布局。</p>
      <button type="button" onClick={model.reload}>重新读取工作区存档</button>
      <button type="button" onClick={model.retrySave}>备份原存档并保存当前布局</button>
    </Disclosure> : null}
    {persistenceError ? <div className="named-workspaces__status"><p role="alert">会话参数尚未保存：{persistenceError}</p>
      <button type="button" onClick={onRetryPersistence}>重试保存会话</button></div> : null}
    {model.notices.length ? <Disclosure className="named-workspaces__status" title={<>工作区恢复提示</>}>{model.notices.map((text) => <p key={text}>{text}</p>)}
      <button type="button" onClick={model.dismissNotices}>知道了</button>
    </Disclosure> : null}
  </>;
}

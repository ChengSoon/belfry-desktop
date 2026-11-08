import { formatNumber } from "../../i18n";
import { t, useTranslation } from "../../i18n";
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
import { WorkspaceDeleteButton } from "./WorkspaceDeleteButton";
import "./namedWorkspaces.css";

export interface WorkspaceControlsProps {
  model: NamedWorkspaces;
  activeTab: WorkspaceTab | null;
  onRepair: (id: string, path: string | null) => Promise<string | null>;
  persistenceError: string | null;
  onRetryPersistence: () => void;
}

export function NamedWorkspaceControls(props: WorkspaceControlsProps) {
  useTranslation();
  const { model } = props;
  const flyout = useFlyout();
  const issue = model.error || model.actionError || props.persistenceError;
  return (
    <div className="named-workspaces" aria-label={t("workspace.NamedWorkspaceControls.text_26724b1c4c")} ref={flyout.root}>
      <button className="named-workspaces__trigger" ref={flyout.trigger} aria-label={t("workspace.NamedWorkspaceControls.text_8d79f47e7f", { name: model.current.name })}
        aria-expanded={flyout.open} aria-haspopup="dialog" aria-controls={flyout.id} title={model.current.name} type="button" onClick={flyout.toggle}>
        <Layers2 aria-hidden="true" size={ICON.sm} /><span>{model.current.name}</span>
        {issue ? <CircleAlert className="named-workspaces__issue" aria-label={t("workspace.NamedWorkspaceControls.text_e17158dceb")} size={ICON.xs} /> : <ChevronDown aria-hidden="true" size={ICON.xs} />}
      </button>
      {issue ? <button className="named-workspaces__notice" type="button" onClick={flyout.toggle}>{t("workspace.NamedWorkspaceControls.text_e17158dceb")}</button> : null}
      {flyout.open ? <div className="named-workspaces__popover" id={flyout.id} role="dialog" aria-label={t("workspace.NamedWorkspaceControls.text_2b1a57de1c")}>
        <WorkspaceMenu key={model.current.id} {...props} onSelect={flyout.close} />
      </div> : null}
    </div>
  );
}

export function WorkspaceMenu(props: WorkspaceControlsProps & { onSelect: () => void }) {
  useTranslation();
  const { model, activeTab, onRepair, onSelect } = props;
  const [form, setForm] = useState<"create" | "rename" | null>(null);
  if (form) return <WorkspaceNameForm key={form} mode={form} initial={form === "rename" ? model.current.name : ""}
    onSave={(name) => { const error = (form === "rename" ? model.rename : model.create)(name); if (!error) onSelect(); return error; }}
    onCancel={() => setForm(null)} />;
  return <>
    <header className="named-workspaces__heading"><span>{t("workspace.NamedWorkspaceControls.text_3797982942")}</span><small>{formatNumber(model.collection.workspaces.length)} / {MAX_WORKSPACES}</small></header>
    <div className="named-workspaces__list" aria-label={t("workspace.NamedWorkspaceControls.text_b4ce05a345")}>
      {model.collection.workspaces.map((item) => <button className="named-workspaces__item" key={item.id} type="button"
        aria-current={item.id === model.current.id || undefined} data-flyout-focus={item.id === model.current.id || undefined}
        onClick={() => { model.select(item.id); onSelect(); }}>
        <span className="named-workspaces__icon"><Layers2 aria-hidden="true" size={ICON.sm} /></span>
        <span className="named-workspaces__identity"><span title={item.name}>{item.name}</span><small>{t("workspace.NamedWorkspaceControls.sessionCount", { count: item.tabIds.length })}</small></span>
        <Check className="named-workspaces__check" aria-hidden="true" size={ICON.sm} />
      </button>)}
    </div>
    <button className="named-workspaces__create" type="button" disabled={model.collection.workspaces.length >= MAX_WORKSPACES}
      onClick={() => setForm("create")}><Plus aria-hidden="true" size={ICON.sm} />{t("workspace.NamedWorkspaceControls.text_946897d107")}</button>
    <div className="named-workspaces__actions">
      <span>{t("workspace.NamedWorkspaceControls.text_150dd0cecd")}</span>
      <button type="button" onClick={() => setForm("rename")}><Pencil aria-hidden="true" size={ICON.xs} />{t("workspace.NamedWorkspaceControls.text_0d0cbac2ee")}</button>
    </div>
    {activeTab ? <WorkspaceSessionTools key={activeTab.id} model={model} tab={activeTab} onRepair={onRepair} /> : null}
    <WorkspaceDeleteButton model={model} onDeleted={onSelect} />
    <WorkspaceSaveStatus {...props} />
    {model.actionError ? <p role="alert" className="named-workspaces__error">{model.actionError}</p> : null}
  </>;
}

function WorkspaceSaveStatus({ model, persistenceError, onRetryPersistence }: WorkspaceControlsProps) {
  useTranslation();
  return <>
    {model.error ? <Disclosure className="named-workspaces__status" defaultOpen title={<>{t("workspace.NamedWorkspaceControls.text_b6a80c2726")}</>}><p role="alert">{model.error}</p>
      <p>{t("workspace.NamedWorkspaceControls.text_c8f786598f")}</p>
      <button type="button" onClick={model.reload}>{t("workspace.NamedWorkspaceControls.text_d4b609a483")}</button>
      <button type="button" onClick={model.retrySave}>{t("workspace.NamedWorkspaceControls.text_e4dd98d274")}</button>
    </Disclosure> : null}
    {persistenceError ? <div className="named-workspaces__status"><p role="alert">{t("workspace.NamedWorkspaceControls.unsavedParameters", { error: persistenceError })}</p>
      <button type="button" onClick={onRetryPersistence}>{t("workspace.NamedWorkspaceControls.text_9171573c22")}</button></div> : null}
    {model.notices.length ? <Disclosure className="named-workspaces__status" title={<>{t("workspace.NamedWorkspaceControls.text_186ae20471")}</>}>{model.notices.map((text) => <p key={text}>{text}</p>)}
      <button type="button" onClick={model.dismissNotices}>{t("workspace.NamedWorkspaceControls.text_de32e20193")}</button>
    </Disclosure> : null}
  </>;
}

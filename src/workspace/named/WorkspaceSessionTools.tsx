import { useFeedback, t, useTranslation } from "../../i18n";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import type { WorkspaceTab } from "../contracts";
import { normalizePath } from "../path";
import { canRepairProject } from "./repair";
import { message } from "./storage";
import type { NamedWorkspaces } from "./useNamedWorkspaces";
import { Select } from "../../components/controls/Select";
import { Disclosure } from "../../components/controls/Disclosure";

interface Props {
  model: NamedWorkspaces;
  tab: WorkspaceTab;
  onRepair: (id: string, path: string | null) => Promise<string | null>;
}

export function WorkspaceSessionTools({ model, tab, onRepair }: Props) {
  useTranslation();
  const destinations = model.collection.workspaces.filter((item) => item.id !== model.current.id);
  const [destination, setDestination] = useState(destinations[0]?.id ?? "");
  const target = destinations.some((item) => item.id === destination) ? destination : destinations[0]?.id ?? "";
  return (
    <Disclosure className="named-workspaces__session" title={t("workspace.WorkspaceSessionTools.text_fbbc7df58a")}>
      <p title={tab.title}>{t("workspace.WorkspaceSessionTools.currentSession", { name: tab.agentName || tab.title })}</p>
      {destinations.length ? (
        <form onSubmit={(event) => { event.preventDefault(); model.move(tab.id, target); }}>
          <label>{t("workspace.WorkspaceSessionTools.text_f3d717f559")}<Select ariaLabel={t("workspace.WorkspaceSessionTools.text_24a665ab34")} value={target} onChange={setDestination}
            options={destinations.map((item) => ({ value: item.id, label: item.name }))} /></label>
          <p>{t("workspace.WorkspaceSessionTools.text_3eb95ddda3")}</p>
          <button type="submit">{t("workspace.WorkspaceSessionTools.text_3cf78d9d5b")}</button>
        </form>
      ) : <p>{t("workspace.WorkspaceSessionTools.text_64bb764ab3")}</p>}
      {canRepairProject(tab) ? <RepairProjectButton tab={tab} onRepair={onRepair} /> : null}
    </Disclosure>
  );
}

function RepairProjectButton({ tab, onRepair }: Pick<Props, "tab" | "onRepair">) {
  useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedback<string | null>(null);
  const browse = async () => {
    setBusy(true); setError(null);
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: t("workspace.WorkspaceSessionTools.text_2a67ee0621"),
        defaultPath: normalizePath(tab.project.rootPath) });
      if (typeof selected === "string") setError(await onRepair(tab.id, selected));
    } catch (failure) { setError(() => message(failure)); }
    finally { setBusy(false); }
  };
  return (
    <div className="named-workspaces__repair">
      <p>{t("workspace.WorkspaceSessionTools.text_a50e60c486")}</p>
      <code>{normalizePath(tab.project.rootPath)}</code>
      <button type="button" disabled={busy} onClick={() => void browse()}>{t("workspace.WorkspaceSessionTools.text_3b7181f0d2")}</button>
      {error ? <p className="named-workspaces__error" role="alert">{error}</p> : null}
    </div>
  );
}

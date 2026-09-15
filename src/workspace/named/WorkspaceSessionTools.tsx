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
  const destinations = model.collection.workspaces.filter((item) => item.id !== model.current.id);
  const [destination, setDestination] = useState(destinations[0]?.id ?? "");
  const target = destinations.some((item) => item.id === destination) ? destination : destinations[0]?.id ?? "";
  return (
    <Disclosure className="named-workspaces__session" title="管理当前会话">
      <p title={tab.title}>当前：{tab.agentName || tab.title}</p>
      {destinations.length ? (
        <form onSubmit={(event) => { event.preventDefault(); model.move(tab.id, target); }}>
          <label>移动到<Select ariaLabel="移动会话到工作区" value={target} onChange={setDestination}
            options={destinations.map((item) => ({ value: item.id, label: item.name }))} /></label>
          <p>移动后打开目标工作区，会话继续运行。</p>
          <button type="submit">移动当前会话</button>
        </form>
      ) : <p>新建其他工作区后可迁移会话。</p>}
      {canRepairProject(tab) ? <RepairProjectButton tab={tab} onRepair={onRepair} /> : null}
    </Disclosure>
  );
}

function RepairProjectButton({ tab, onRepair }: Pick<Props, "tab" | "onRepair">) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const browse = async () => {
    setBusy(true); setError(null);
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: "修复会话目录并重新启动",
        defaultPath: normalizePath(tab.project.rootPath) });
      if (typeof selected === "string") setError(await onRepair(tab.id, selected));
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  };
  return (
    <div className="named-workspaces__repair">
      <p>会话已停止。原目录失效时可选择新目录，保留会话身份并重新启动。</p>
      <code>{normalizePath(tab.project.rootPath)}</code>
      <button type="button" disabled={busy} onClick={() => void browse()}>选择目录并重新启动</button>
      {error ? <p className="named-workspaces__error" role="alert">{error}</p> : null}
    </div>
  );
}

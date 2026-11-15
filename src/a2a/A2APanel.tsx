import { FolderGit2, Waypoints, X } from "lucide-react";
import { useState } from "react";
import { useDialog } from "../components/controls/useDialog";
import { t, useTranslation } from "../i18n";
import type { ProjectWorkspace } from "../workspace/contracts";
import { A2ASection } from "./A2ASection";
import { A2AButton } from "./kit";
import "./a2a.css";

/** The opening project is held by App for the lifetime of this dialog. */
export function A2APanel({ project, onClose }: { project: ProjectWorkspace; onClose: () => void }) {
  useTranslation();
  const [guarded, setGuarded] = useState(false);
  const ref = useDialog(onClose, guarded);
  return <div className="a2a-scrim" onMouseDown={event => {
    if (event.target === event.currentTarget && !guarded) onClose();
  }}>
    <div className="a2a-panel" ref={ref} role="dialog" aria-modal="true" aria-labelledby="a2a-title">
      <header className="a2a-panel__header">
        <div className="a2a-panel__identity">
          <span className="a2a-panel__icon"><Waypoints size={16} aria-hidden="true" /></span>
          <div><div className="a2a-panel__title"><h2 id="a2a-title">{t("a2a.title")}</h2>
            <span className="a2a-panel__moniker">{t("a2a.workspace.fieldLabel")}</span>
            <span className="a2a-panel__scope">{t("a2a.workspace.projectOnly")}</span></div>
            <div className="a2a-project"><FolderGit2 size={12} aria-hidden="true" /><strong>{project.name}</strong><span title={project.rootPath}>{project.rootPath}</span></div>
          </div>
        </div>
        <A2AButton icon className="a2a-panel__close" aria-label={t("a2a.workspace.close")} disabled={guarded}
          title={t(guarded ? "a2a.workspace.guarded" : "a2a.workspace.close")} onClick={onClose}><X size={18} aria-hidden="true" /></A2AButton>
      </header>
      <div className="a2a-panel__body"><A2ASection project={project} onGuardChange={setGuarded} onBackToProject={onClose} /></div>
      {guarded ? <p className="a2a-panel__guard" role="status">{t("a2a.workspace.guarded")}</p> : null}
    </div>
  </div>;
}

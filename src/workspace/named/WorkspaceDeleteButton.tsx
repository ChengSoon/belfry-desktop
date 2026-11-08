import { t, useTranslation } from "../../i18n";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ICON } from "../../theme/sizing";
import type { NamedWorkspaces } from "./useNamedWorkspaces";

export function WorkspaceDeleteButton({ model, onDeleted }: { model: NamedWorkspaces; onDeleted: () => void }) {
  useTranslation();
  const [confirming, setConfirming] = useState(false);
  const destination = model.collection.workspaces.find((item) => item.id !== model.current.id);
  const count = model.current.tabIds.length;
  const body = t("workspace.WorkspaceDeleteButton.text_f09855bd2f", { name: model.current.name, destination: destination?.name })
    + (count ? t("workspace.WorkspaceDeleteButton.text_e5865c05f1", { count: count }) : t("workspace.WorkspaceDeleteButton.text_52c9d7a02e"))
    + t("workspace.WorkspaceDeleteButton.text_e5ce93ae69");
  return <div className="named-workspaces__delete">
    <button type="button" disabled={!destination} aria-describedby={!destination ? "workspace-delete-hint" : undefined}
      onClick={(event) => { event.currentTarget.focus(); setConfirming(true); }}>
      <Trash2 aria-hidden="true" size={ICON.xs} />{t("workspace.WorkspaceDeleteButton.text_1bca7ef1a8")}</button>
    {!destination ? <p id="workspace-delete-hint">{t("workspace.WorkspaceDeleteButton.text_319240731d")}</p> : null}
    {confirming && destination ? <ConfirmDialog title={t("workspace.WorkspaceDeleteButton.text_46ea8ac507")} body={body} confirmLabel={t("workspace.WorkspaceDeleteButton.text_1bca7ef1a8")}
      onCancel={() => setConfirming(false)} onConfirm={() => {
        const error = model.remove(destination.id);
        setConfirming(false);
        if (!error) onDeleted();
      }} /> : null}
  </div>;
}

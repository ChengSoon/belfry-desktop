import { t, useTranslation } from "../../i18n";
import { useState } from "react";
import { Select } from "../../components/controls/Select";
import type { CreateInput, WorktreeReport } from "./contracts";
import { suggestBranch } from "./model";
import { guardComposingEnter } from "../../utils/keyboard";

export function CreateWorktree({ report, busy, onPreview }: { report: WorktreeReport; busy: boolean; onPreview: (input: CreateInput) => Promise<void> }) {
  useTranslation();
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [customBranch, setCustomBranch] = useState(false);
  const [baseBranch, setBaseBranch] = useState(report.branch);
  const changeName = (value: string) => { setName(value); if (!customBranch) setBranch(suggestBranch(value)); };
  return <form onKeyDown={guardComposingEnter} className="worktree-form" onSubmit={(event) => { event.preventDefault(); void onPreview({ rootPath: report.rootPath, name, branch, baseBranch }); }}>
    <div><h3>{t("git.CreateWorktree.text_9be28d7fcb")}</h3><p>{t("git.CreateWorktree.text_ee1f5503e5")}</p></div>
    <label>{t("git.CreateWorktree.text_2479560deb")}<input autoFocus value={name} maxLength={60} placeholder={t("git.CreateWorktree.text_8bdf54ee87")} disabled={busy} onChange={(event) => changeName(event.target.value)} /></label>
    <label>{t("git.CreateWorktree.text_10326232c8")}<input value={branch} maxLength={160} placeholder="belfry/settings" disabled={busy} onChange={(event) => { setBranch(event.target.value); setCustomBranch(true); }} /></label>
    <div className="worktree-field"><span>{t("git.CreateWorktree.text_e60a0c3b75")}</span><Select ariaLabel={t("git.CreateWorktree.text_c7e4ac59e4")} value={baseBranch} onChange={setBaseBranch} disabled={busy}
      options={report.branches.map((branch) => ({ value: branch, label: branch }))} /></div>
    <p>{t("git.CreateWorktree.text_6e3b7cf714")}</p>
    <footer><button className="is-primary" type="submit" disabled={busy || !name.trim() || !branch.trim()}>{t("git.CreateWorktree.text_806fa5210a")}</button></footer>
  </form>;
}

import { useFeedback, localized, t, useTranslation } from "../../i18n";
import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { Select } from "../../components/controls/Select";
import { mergeTargets } from "./model";
import type { ActionInput, ManagedWorktree, WorktreeAction, WorktreeReport } from "./contracts";

const STEPS: { id: WorktreeAction; name: string }[] = localized(() => ([
  { id: "commit", name: t("git.WorktreeTask.text_a5eb9da1e7") }, { id: "merge", name: t("git.WorktreeTask.text_f80af0d2f0") }, { id: "cleanup", name: t("git.WorktreeTask.text_e3e5a4d16a") },
]));
interface Props { tree: ManagedWorktree; report: WorktreeReport; busy: boolean; onOpen: (path: string) => Promise<void>; onPreview: (input: ActionInput) => Promise<void> }

export function WorktreeTask({ tree, report, busy, onOpen, onPreview }: Props) {
  useTranslation();
  const [step, setStep] = useState<WorktreeAction>("commit");
  const [message, setMessage] = useFeedback("");
  const targets = mergeTargets(tree, report.worktrees);
  const [targetPath, setTargetPath] = useState(() => targets.find((target) => target.branch === tree.baseBranch)?.rootPath ?? targets[0]?.rootPath ?? "");
  const validTarget = targets.some((target) => target.rootPath === targetPath);
  return <div className="worktree-task"><header><h3>{tree.name}</h3><code>{tree.branch}</code></header>
    <p className="worktree-path">{tree.rootPath}</p>
    {tree.state !== "ready" ? <p role="status">{t("git.WorktreeTask.text_df9b2f8d4b")}</p> : null}
    <button type="button" disabled={busy} onClick={() => void onOpen(tree.rootPath)}><FolderOpen size={15} />{t("git.WorktreeTask.text_bcb77624e8")}</button>
    <div className="worktree-steps" role="group" aria-label={t("git.WorktreeTask.text_e94cb9db9e")}>{STEPS.map((item) =>
      <button type="button" key={item.id} aria-pressed={item.id === step} disabled={busy} onClick={() => setStep(item.id)}>{item.name}</button>)}</div>
    {step === "commit" ? <label className="worktree-field">{t("git.WorktreeTask.text_600b315f23")}<input value={message} maxLength={300} disabled={busy} onChange={(event) => setMessage(event.target.value)} placeholder={t("git.WorktreeTask.text_fb66177859")} /></label>
      : <div className="worktree-field"><span>{step === "merge" ? t("git.WorktreeTask.text_b2d6f12272") : t("git.WorktreeTask.text_13a06bfc56")}</span><Select ariaLabel={t("git.WorktreeTask.text_5448e1833f")} value={targetPath} onChange={setTargetPath} disabled={busy}
        options={targets.map((target) => ({ value: target.rootPath, label: target.branch!, description: target.rootPath }))} /></div>}
    <p>{step === "commit" ? t("git.WorktreeTask.text_4c717be29d")
      : step === "merge" ? t("git.WorktreeTask.text_a5dcfbc241")
        : t("git.WorktreeTask.text_46795b6452")}</p>
    <footer><button className="is-primary" type="button" disabled={busy || (step === "commit" ? !message.trim() : !validTarget)}
      onClick={() => void onPreview({ id: tree.id, action: step, message, targetPath })}>{t(`git.WorktreeTask.preview.${step}`)}</button></footer>
  </div>;
}

import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { Select } from "../../components/controls/Select";
import { mergeTargets } from "./model";
import type { ActionInput, ManagedWorktree, WorktreeAction, WorktreeReport } from "./contracts";

const STEPS: { id: WorktreeAction; name: string }[] = [
  { id: "commit", name: "1. 提交" }, { id: "merge", name: "2. 合并" }, { id: "cleanup", name: "3. 清理" },
];
interface Props { tree: ManagedWorktree; report: WorktreeReport; busy: boolean; onOpen: (path: string) => Promise<void>; onPreview: (input: ActionInput) => Promise<void> }

export function WorktreeTask({ tree, report, busy, onOpen, onPreview }: Props) {
  const [step, setStep] = useState<WorktreeAction>("commit");
  const [message, setMessage] = useState("");
  const targets = mergeTargets(tree, report.worktrees);
  const [targetPath, setTargetPath] = useState(() => targets.find((target) => target.branch === tree.baseBranch)?.rootPath ?? targets[0]?.rootPath ?? "");
  const validTarget = targets.some((target) => target.rootPath === targetPath);
  return <div className="worktree-task"><header><h3>{tree.name}</h3><code>{tree.branch}</code></header>
    <p className="worktree-path">{tree.rootPath}</p>
    {tree.state !== "ready" ? <p role="status">创建记录尚未完成。可刷新核对或在终端检查目录与分支，现有成果会保留。</p> : null}
    <button type="button" disabled={busy} onClick={() => void onOpen(tree.rootPath)}><FolderOpen size={15} />打开为新会话</button>
    <div className="worktree-steps" role="group" aria-label="任务收尾步骤">{STEPS.map((item) =>
      <button type="button" key={item.id} aria-pressed={item.id === step} disabled={busy} onClick={() => setStep(item.id)}>{item.name}</button>)}</div>
    {step === "commit" ? <label className="worktree-field">提交说明<input value={message} maxLength={300} disabled={busy} onChange={(event) => setMessage(event.target.value)} placeholder="feat: 完成设置界面优化" /></label>
      : <div className="worktree-field"><span>{step === "merge" ? "合并到" : "检查已合并到"}</span><Select ariaLabel="Worktree 目标分支" value={targetPath} onChange={setTargetPath} disabled={busy}
        options={targets.map((target) => ({ value: target.rootPath, label: target.branch!, description: target.rootPath }))} /></div>}
    <p>{step === "commit" ? "先审查全部变更，再确认提交。空差异不会生成提交。"
      : step === "merge" ? "源与目标都需干净。目标仍在运行会话时会暂停合并。"
        : "仅清理已合并且空闲的任务目录；分支保留，忽略文件需先自行处理。"}</p>
    <footer><button className="is-primary" type="button" disabled={busy || (step === "commit" ? !message.trim() : !validTarget)}
      onClick={() => void onPreview({ id: tree.id, action: step, message, targetPath })}>预览{step === "commit" ? "提交" : step === "merge" ? "合并" : "清理"}</button></footer>
  </div>;
}

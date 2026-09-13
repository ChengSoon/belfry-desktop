import { useState } from "react";
import { Select } from "../../components/controls/Select";
import type { CreateInput, WorktreeReport } from "./contracts";
import { suggestBranch } from "./model";

export function CreateWorktree({ report, busy, onPreview }: { report: WorktreeReport; busy: boolean; onPreview: (input: CreateInput) => Promise<void> }) {
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [customBranch, setCustomBranch] = useState(false);
  const [baseBranch, setBaseBranch] = useState(report.branch);
  const changeName = (value: string) => { setName(value); if (!customBranch) setBranch(suggestBranch(value)); };
  return <form className="worktree-form" onSubmit={(event) => { event.preventDefault(); void onPreview({ rootPath: report.rootPath, name, branch, baseBranch }); }}>
    <div><h3>新建独立任务</h3><p>使用自己的目录和分支，让多条任务各自工作。</p></div>
    <label>任务名称<input autoFocus value={name} maxLength={60} placeholder="例如：优化设置界面" disabled={busy} onChange={(event) => changeName(event.target.value)} /></label>
    <label>新分支<input value={branch} maxLength={160} placeholder="belfry/settings" disabled={busy} onChange={(event) => { setBranch(event.target.value); setCustomBranch(true); }} /></label>
    <div className="worktree-field"><span>基础分支</span><Select ariaLabel="Worktree 基础分支" value={baseBranch} onChange={setBaseBranch} disabled={busy}
      options={report.branches.map((branch) => ({ value: branch, label: branch }))} /></div>
    <p>仅复制基础分支的已提交内容。依赖可在新任务终端中按项目文档初始化。</p>
    <footer><button className="is-primary" type="submit" disabled={busy || !name.trim() || !branch.trim()}>预览创建</button></footer>
  </form>;
}

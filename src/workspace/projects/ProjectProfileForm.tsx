import { useEffect, useState } from "react";
import { Checkbox } from "../../components/controls/Checkbox";
import { Combobox } from "../../components/controls/Combobox";
import { Disclosure } from "../../components/controls/Disclosure";
import { Select } from "../../components/controls/Select";
import { listShellProfiles } from "../../terminal/api";
import { shellProfileLabel, type ShellProfile } from "../../terminal/contracts";
import { normalizePath } from "../path";
import { MAX_COMMAND_LENGTH, type ProjectProfile } from "./contracts";
import { useDirectoryHealth, useProfileDraft } from "./useProfileDraft";

interface Props {
  profile: ProjectProfile; groups: string[]; onGuard: (guarded: boolean) => void;
  onSave: (profile: ProjectProfile) => ProjectProfile;
}
type Draft = ReturnType<typeof useProfileDraft>;

export function ProjectProfileForm(props: Props) {
  const state = useProfileDraft(props);
  const directory = useDirectoryHealth(state.draft.project.rootPath);
  return <form className="project-profile" noValidate onSubmit={(event) => { event.preventDefault(); state.save(); }}>
    <header><strong>{state.draft.project.name}</strong><Checkbox checked={state.draft.favorite} ariaLabel="长期收藏此项目"
      onChange={(favorite) => state.setDraft({ ...state.draft, favorite })} disabled={state.busy}>收藏</Checkbox></header>
    <p className="project-profile__path">{normalizePath(state.draft.project.rootPath)}</p>
    <div className="project-profile__directory"><span className={directory.health ? "is-error" : ""}>
      {directory.health === undefined ? "检查目录中…" : directory.health ? "目录不可用，请重新选择" : "目录可用"}</span>
      <button type="button" onClick={directory.check} disabled={state.busy}>重新检查</button>
      <button type="button" onClick={() => void state.repair()} disabled={state.busy}>更换目录…</button></div>
    {directory.health ? <p className="project-library__error" role="status">{directory.health}</p> : null}
    <label className="project-profile__field"><span>分组</span><Combobox ariaLabel="项目分组" value={state.draft.group}
      options={props.groups.map((value) => ({ value, label: value }))} maxLength={80} placeholder="不分组"
      onChange={(group) => state.setDraft({ ...state.draft, group })} disabled={state.busy} /></label>
    <LaunchFields state={state} />
    {state.error ? <p className="project-library__error" role="alert">{state.error}</p> : null}
    {state.notice ? <p className="project-library__note" role="status">{state.notice}</p> : null}
    <footer><span>{state.dirty ? "有未保存的修改" : "配置仅用于此项目"}</span>
      <button type="button" onClick={state.reset} disabled={state.busy || !state.dirty}>取消修改</button>
      <button type="submit" className="is-primary" disabled={state.busy}>保存项目</button></footer>
  </form>;
}

function LaunchFields({ state }: { state: Draft }) {
  const [shells, setShells] = useState<ShellProfile[]>([]);
  useEffect(() => { let active = true; void listShellProfiles().then((value) => { if (active) setShells(value); }).catch(() => undefined);
    return () => { active = false; }; }, []);
  const options = shells.map((shell) => ({ value: shell.id, label: shellProfileLabel(shell.id), disabled: !shell.available && !shell.isDefault,
    description: shell.available ? undefined : shell.reason ?? "不可用" }));
  if (!options.some((option) => option.value === state.draft.shell)) options.unshift({ value: state.draft.shell,
    label: shellProfileLabel(state.draft.shell), disabled: false, description: "保存的选择；启动时检查可用性" });
  return <Disclosure title={<><strong>启动配置</strong><small>{state.draft.command ? "已设置命令" : shellProfileLabel(state.draft.shell)}</small></>} className="project-profile__launch">
    <label className="project-profile__field"><span>默认 Shell</span><Select ariaLabel="项目默认 Shell" options={options}
      value={state.draft.shell} onChange={(shell) => state.setDraft({ ...state.draft, shell })} disabled={state.busy} /></label>
    <label className="project-profile__field"><span>启动命令</span><input aria-label="项目启动命令" placeholder="例如 pnpm dev" autoComplete="off"
      value={state.draft.command} maxLength={MAX_COMMAND_LENGTH} onChange={(event) => state.setDraft({ ...state.draft, command: event.target.value })} disabled={state.busy} /></label>
    <p className="project-library__note">仅在新建 Shell 时运行一次。重新打开应用或恢复会话时不执行。</p>
    <label className="project-profile__field"><span>环境变量</span><textarea aria-label="项目环境变量" value={state.environment} rows={4}
      spellCheck={false} placeholder={"NODE_ENV=development\n每行一个 NAME=value，值按原文传入"}
      onChange={(event) => state.setEnvironment(event.target.value)} disabled={state.busy} /></label>
    <p className="project-library__note">用于本地 Shell 和 Agent。仅填写非敏感值，密码、Token 和私钥请留在凭据库或 CLI 配置中。</p>
  </Disclosure>;
}

import { t, useTranslation } from "../../i18n";
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
import { guardComposingEnter } from "../../utils/keyboard";

interface Props {
  profile: ProjectProfile; groups: string[]; onGuard: (guarded: boolean) => void;
  onSave: (profile: ProjectProfile) => ProjectProfile;
}
type Draft = ReturnType<typeof useProfileDraft>;

export function ProjectProfileForm(props: Props) {
  useTranslation();
  const state = useProfileDraft(props);
  const directory = useDirectoryHealth(state.draft.project.rootPath);
  return <form onKeyDown={guardComposingEnter} className="project-profile" noValidate onSubmit={(event) => { event.preventDefault(); state.save(); }}>
    <header><strong>{state.draft.project.name}</strong><Checkbox checked={state.draft.favorite} ariaLabel={t("workspace.ProjectProfileForm.text_027b216a44")}
      onChange={(favorite) => state.setDraft({ ...state.draft, favorite })} disabled={state.busy}>{t("workspace.ProjectProfileForm.text_60a53514eb")}</Checkbox></header>
    <p className="project-profile__path">{normalizePath(state.draft.project.rootPath)}</p>
    <div className="project-profile__directory"><span className={directory.health ? "is-error" : ""}>
      {directory.health === undefined ? t("workspace.ProjectProfileForm.text_67cd463a7a") : directory.health ? t("workspace.ProjectProfileForm.text_0cd7421ecb") : t("workspace.ProjectProfileForm.text_dc7ff86dd8")}</span>
      <button type="button" onClick={directory.check} disabled={state.busy}>{t("workspace.ProjectProfileForm.text_c25fb86b1e")}</button>
      <button type="button" onClick={() => void state.repair()} disabled={state.busy}>{t("workspace.ProjectProfileForm.text_4cb858a14a")}</button></div>
    {directory.health ? <p className="project-library__error" role="status">{directory.health}</p> : null}
    <label className="project-profile__field"><span>{t("workspace.ProjectProfileForm.text_399ee69347")}</span><Combobox ariaLabel={t("workspace.ProjectProfileForm.text_d03a6f7d0c")} value={state.draft.group}
      options={props.groups.map((value) => ({ value, label: value }))} maxLength={80} placeholder={t("workspace.ProjectProfileForm.text_fcd40ee3f0")}
      onChange={(group) => state.setDraft({ ...state.draft, group })} disabled={state.busy} /></label>
    <LaunchFields state={state} />
    {state.error ? <p className="project-library__error" role="alert">{state.error}</p> : null}
    {state.notice ? <p className="project-library__note" role="status">{state.notice}</p> : null}
    <footer><span>{state.dirty ? t("workspace.ProjectProfileForm.text_c2277872cd") : t("workspace.ProjectProfileForm.text_a561c602ef")}</span>
      <button type="button" onClick={state.reset} disabled={state.busy || !state.dirty}>{t("workspace.ProjectProfileForm.text_fada4dfc38")}</button>
      <button type="submit" className="is-primary" disabled={state.busy}>{t("workspace.ProjectProfileForm.text_a637cf4680")}</button></footer>
  </form>;
}

function LaunchFields({ state }: { state: Draft }) {
  useTranslation();
  const [shells, setShells] = useState<ShellProfile[]>([]);
  useEffect(() => { let active = true; void listShellProfiles().then((value) => { if (active) setShells(value); }).catch(() => undefined);
    return () => { active = false; }; }, []);
  const options = shells.map((shell) => ({ value: shell.id, label: shellProfileLabel(shell.id), disabled: !shell.available && !shell.isDefault,
    description: shell.available ? undefined : shell.reason ?? t("workspace.ProjectProfileForm.text_460b3574e4") }));
  if (!options.some((option) => option.value === state.draft.shell)) options.unshift({ value: state.draft.shell,
    label: shellProfileLabel(state.draft.shell), disabled: false, description: t("workspace.ProjectProfileForm.text_f68bd78108") });
  return <Disclosure title={<><strong>{t("workspace.ProjectProfileForm.text_7e082ab85a")}</strong><small>{state.draft.command ? t("workspace.ProjectProfileForm.text_2e9f004321") : shellProfileLabel(state.draft.shell)}</small></>} className="project-profile__launch">
    <label className="project-profile__field"><span>{t("workspace.ProjectProfileForm.text_7ec5171d6e")}</span><Select ariaLabel={t("workspace.ProjectProfileForm.text_33b972be53")} options={options}
      value={state.draft.shell} onChange={(shell) => state.setDraft({ ...state.draft, shell })} disabled={state.busy} /></label>
    <label className="project-profile__field"><span>{t("workspace.ProjectProfileForm.text_8b76184a7d")}</span><input aria-label={t("workspace.ProjectProfileForm.text_fe6e20e196")} placeholder={t("workspace.ProjectProfileForm.text_6a0a727617")} autoComplete="off"
      value={state.draft.command} maxLength={MAX_COMMAND_LENGTH} onChange={(event) => state.setDraft({ ...state.draft, command: event.target.value })} disabled={state.busy} /></label>
    <p className="project-library__note">{t("workspace.ProjectProfileForm.text_f201fede91")}</p>
    <label className="project-profile__field"><span>{t("workspace.ProjectProfileForm.text_ae27b474ea")}</span><textarea aria-label={t("workspace.ProjectProfileForm.text_f785f25c63")} value={state.environment} rows={4}
      spellCheck={false} placeholder={t("workspace.ProjectProfileForm.text_75bb5ef278")}
      onChange={(event) => state.setEnvironment(event.target.value)} disabled={state.busy} /></label>
    <p className="project-library__note">{t("workspace.ProjectProfileForm.text_af4d6a3547")}</p>
  </Disclosure>;
}

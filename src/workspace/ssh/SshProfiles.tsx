import { useFeedback, getLocale, t, useTranslation } from "../../i18n";
import { useEffect, useRef, useState } from "react";
import { Select } from "../../components/controls/Select";
import { Combobox } from "../../components/controls/Combobox";
import { Disclosure } from "../../components/controls/Disclosure";
import { readAliases } from "./api";
import type { AliasReport } from "./contracts";
import { message } from "./storage";
import type { SshFormState } from "./useSshForm";

export function SshProfiles({ state }: { state: SshFormState }) {
  useTranslation();
  const sorted = [...state.hosts.catalog.entries].sort((a, b) => a.group.localeCompare(b.group, getLocale()) || a.name.localeCompare(b.name, getLocale()));
  return <div className="ssh-profiles">
    <label className="ssh-form__field"><span>{t("workspace.SshProfiles.text_a0e8673971")}</span><Select ariaLabel={t("workspace.SshProfiles.text_e46d759243")} value={state.selected?.id ?? ""}
      options={[{ value: "", label: t("workspace.SshProfiles.text_10c3725e36") }, ...sorted.map((item) => ({ value: item.id, label: item.group ? `${item.group} · ${item.name}` : item.name,
        description: `${item.target.host}${item.target.remotePath ?? ""}` }))]}
      onChange={(id) => state.select(state.hosts.catalog.entries.find((item) => item.id === id) ?? null)} /></label>
    <AliasPicker onSelect={state.alias} />
  </div>;
}

function AliasPicker({ onSelect }: { onSelect: (name: string) => void }) {
  useTranslation();
  const [report, setReport] = useState<AliasReport | null>(null), [error, setError] = useFeedback<string | null>(null);
  const [busy, setBusy] = useState(false); const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const load = async () => {
    setBusy(true); setError(null);
    try { const result = await readAliases(); if (active.current) setReport(result); }
    catch (error) { if (active.current) setError(() => message(error)); }
    finally { if (active.current) setBusy(false); }
  };
  return <div className="ssh-aliases">
    <button type="button" className="ssh-link" disabled={busy} onClick={() => void load()}>{busy ? t("workspace.SshProfiles.text_346ff60e6c") : t("workspace.SshProfiles.text_0e68ca3eb1")}</button>
    {report ? <><Select ariaLabel={t("workspace.SshProfiles.text_ad6e89f4a0")} value="" options={[{ value: "", label: t("workspace.SshProfiles.text_819b0629a5"), disabled: true },
      ...report.aliases.map((alias) => ({ value: alias.name, label: alias.name, description: alias.source }))]} onChange={onSelect} />
      {!report.aliases.length ? <p className="ssh-note">{t("workspace.SshProfiles.text_19553e1f56")}</p> : null}
      {report.warnings.length ? <Disclosure title={t("workspace.SshProfiles.text_bf7369ec02")}>{report.warnings.map((warning) => <p className="ssh-note" key={warning}>{warning}</p>)}</Disclosure> : null}</> : null}
    {error ? <p className="ssh-form__error" role="alert">{error}</p> : null}
  </div>;
}

export function SaveHost({ state }: { state: SshFormState }) {
  useTranslation();
  const groups = [...new Set(state.hosts.catalog.entries.map((item) => item.group).filter(Boolean))];
  return <Disclosure title={state.selected ? t("workspace.SshProfiles.text_80e68e5faf") : t("workspace.SshProfiles.text_fc645b18f1")} className="ssh-section">
    <div className="ssh-form__row"><label className="ssh-form__field"><span>{t("workspace.SshProfiles.text_d44e9b3d3b")}</span><input aria-label={t("workspace.SshProfiles.text_c487d08ef3")}
      value={state.name} maxLength={100} placeholder={state.fields.host || t("workspace.SshProfiles.text_08afb19cc3")} onChange={(event) => state.setName(event.target.value)} /></label>
      <label className="ssh-form__field"><span>{t("workspace.SshProfiles.text_399ee69347")}</span><Combobox ariaLabel={t("workspace.SshProfiles.text_139c626197")} value={state.group} maxLength={80}
        onChange={state.setGroup} options={groups.map((value) => ({ value, label: value }))} placeholder={t("workspace.SshProfiles.text_fcd40ee3f0")} /></label></div>
    <p className="ssh-note">{t("workspace.SshProfiles.text_be3c2cdebe")}</p>
    <button className="ssh-link" type="button" onClick={state.save}>{t("workspace.SshProfiles.text_3500133568")}</button>
  </Disclosure>;
}

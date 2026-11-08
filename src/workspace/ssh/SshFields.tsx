import { t, useTranslation } from "../../i18n";
import { Checkbox } from "../../components/controls/Checkbox";
import { Disclosure } from "../../components/controls/Disclosure";
import type { SshFormState } from "./useSshForm";

export function ConnectionFields({ state }: { state: SshFormState }) {
  useTranslation();
  const { fields, update } = state;
  return <>
    <label className="ssh-form__field"><span>{t("workspace.SshFields.text_e87d9f23a3")}</span><input aria-label={t("workspace.SshFields.text_2290354d1f")} value={fields.host} autoCapitalize="none" autoCorrect="off"
      spellCheck={false} maxLength={255} placeholder={t("workspace.SshFields.text_4b14f086f7")} onChange={(event) => update({ host: event.target.value })} /></label>
    <div className="ssh-form__row"><label className="ssh-form__field"><span>{t("workspace.SshFields.text_e67fea90bd")}</span><input aria-label={t("workspace.SshFields.text_d9068f19ff")}
      value={fields.user} maxLength={255} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={t("workspace.SshFields.text_3bf9db3d8c")}
      onChange={(event) => update({ user: event.target.value })} /></label>
      <label className="ssh-form__field"><span>{t("workspace.SshFields.text_c39898766c")}</span><input aria-label={t("workspace.SshFields.text_1c22cc57ae")} inputMode="numeric" value={fields.port} maxLength={5}
        placeholder="22" onChange={(event) => update({ port: event.target.value })} /></label></div>
  </>;
}

export function Credentials({ state }: { state: SshFormState }) {
  useTranslation();
  return <Disclosure title={t("workspace.SshFields.text_49ae81eff0")} className="ssh-section">
    <p className="ssh-note">{t("workspace.SshFields.text_f2e65d30dc")}</p>
    <label className="ssh-form__field"><span>{t("workspace.SshFields.text_a621ab606d")}</span><input aria-label={t("workspace.SshFields.text_6f0890a1b0")} type="password" value={state.fields.password}
      maxLength={1_024} autoComplete="off" placeholder={t("workspace.SshFields.text_7d0ca07854")} onChange={(event) => state.update({ password: event.target.value })} /></label>
    <div className="ssh-form__foot"><Checkbox checked={state.fields.remember} ariaLabel={t("workspace.SshFields.text_f8fde64bb4")}
      onChange={(remember) => state.update({ remember })}>{t("workspace.SshFields.text_6d1d717a83")}</Checkbox>
      <button type="button" className="ssh-link" disabled={state.clearing} onClick={() => void state.clear()}>
        {state.clearing ? t("workspace.SshFields.text_0571a5f5f8") : t("workspace.SshFields.text_ef14d9d0f1")}</button></div>
  </Disclosure>;
}

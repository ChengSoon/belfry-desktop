import { Checkbox } from "../../components/controls/Checkbox";
import { Disclosure } from "../../components/controls/Disclosure";
import type { SshFormState } from "./useSshForm";

export function ConnectionFields({ state }: { state: SshFormState }) {
  const { fields, update } = state;
  return <>
    <label className="ssh-form__field"><span>主机</span><input aria-label="SSH 主机" value={fields.host} autoCapitalize="none" autoCorrect="off"
      spellCheck={false} maxLength={255} placeholder="example.com 或 ssh 别名" onChange={(event) => update({ host: event.target.value })} /></label>
    <div className="ssh-form__row"><label className="ssh-form__field"><span>用户名（可选）</span><input aria-label="SSH 用户名"
      value={fields.user} maxLength={255} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="使用 SSH 配置"
      onChange={(event) => update({ user: event.target.value })} /></label>
      <label className="ssh-form__field"><span>端口（可选）</span><input aria-label="SSH 端口" inputMode="numeric" value={fields.port} maxLength={5}
        placeholder="22" onChange={(event) => update({ port: event.target.value })} /></label></div>
  </>;
}

export function Credentials({ state }: { state: SshFormState }) {
  return <Disclosure title="认证（可选）" className="ssh-section">
    <p className="ssh-note">默认使用 OpenSSH 配置、现有密钥和 SSH Agent。</p>
    <label className="ssh-form__field"><span>密码</span><input aria-label="SSH 密码" type="password" value={state.fields.password}
      maxLength={1_024} autoComplete="off" placeholder="留空以使用现有认证" onChange={(event) => state.update({ password: event.target.value })} /></label>
    <div className="ssh-form__foot"><Checkbox checked={state.fields.remember} ariaLabel="记住密码，下次自动填入"
      onChange={(remember) => state.update({ remember })}>记住密码</Checkbox>
      <button type="button" className="ssh-link" disabled={state.clearing} onClick={() => void state.clear()}>
        {state.clearing ? "正在清除…" : "清除已保存密码"}</button></div>
  </Disclosure>;
}

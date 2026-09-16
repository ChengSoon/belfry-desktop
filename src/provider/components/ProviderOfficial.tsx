import { Check, Globe2 } from "lucide-react";

export function ProviderOfficial({ active, busy, onSelect }: {
  active: boolean; busy: boolean; onSelect: () => void;
}) {
  return <div className={`provider-official${active ? " is-active" : ""}`}>
    <Globe2 size={20} aria-hidden="true" />
    <div><strong>官方登录</strong><p>使用 CLI 的账号登录与模型设置，无需填写 API Key。</p></div>
    {active ? <span className="provider-card__status"><Check size={14} aria-hidden="true" />已选用</span> :
      <button disabled={busy} onClick={onSelect} type="button">切回官方</button>}
  </div>;
}

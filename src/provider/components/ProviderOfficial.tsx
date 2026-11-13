import { t, useTranslation } from "../../i18n";
import { CheckCircle2, Globe2 } from "lucide-react";

/** 「当前选择」行：官方登录生效时显示 accent 徽标；选用自定义服务时显示其名称并提供「切回官方」。 */
export function ProviderOfficial({ active, current = null, busy, onSelect }: {
  active: boolean; current?: string | null; busy: boolean; onSelect: () => void;
}) {
  useTranslation();
  return <div className={`provider-official${active ? " is-active" : ""}`}>
    <span className="provider-official__icon">{active ? <CheckCircle2 size={16} aria-hidden="true" /> : <Globe2 size={16} aria-hidden="true" />}</span>
    <div><strong>{active || current === null ? t("provider.ProviderOfficial.text_726c9ae341") : current}</strong><p>{t("provider.ProviderOfficial.text_d076bf75dd")}</p></div>
    {active ? <span className="os-tag accent provider-card__status">{t("provider.ProviderOfficial.text_52eb49cfbe")}</span> :
      <button className="os-btn secondary" disabled={busy} onClick={onSelect} type="button">{t("provider.ProviderOfficial.text_b77548117a")}</button>}
  </div>;
}

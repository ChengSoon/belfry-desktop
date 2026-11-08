import { t, useTranslation } from "../../i18n";
import { Check, Globe2 } from "lucide-react";

export function ProviderOfficial({ active, busy, onSelect }: {
  active: boolean; busy: boolean; onSelect: () => void;
}) {
  useTranslation();
  return <div className={`provider-official${active ? " is-active" : ""}`}>
    <Globe2 size={20} aria-hidden="true" />
    <div><strong>{t("provider.ProviderOfficial.text_726c9ae341")}</strong><p>{t("provider.ProviderOfficial.text_d076bf75dd")}</p></div>
    {active ? <span className="provider-card__status"><Check size={14} aria-hidden="true" />{t("provider.ProviderOfficial.text_52eb49cfbe")}</span> :
      <button disabled={busy} onClick={onSelect} type="button">{t("provider.ProviderOfficial.text_b77548117a")}</button>}
  </div>;
}

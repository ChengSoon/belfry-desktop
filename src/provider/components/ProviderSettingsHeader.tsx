import { t, useTranslation } from "../../i18n";
import { Plus, RefreshCcw } from "lucide-react";
import { SettingsHeader } from "../../settings/SettingsHeader";
import { ICON } from "../../theme/sizing";

export function ProviderSettingsHeader({ busy, editing, onAdd, onReload }: {
  busy: boolean;
  editing: boolean;
  onAdd: () => void;
  onReload: () => void;
}) {
  useTranslation();
  return <SettingsHeader
    title={t("provider.ProviderSettingsHeader.text_c5ecb59fd4")}
    description={t("provider.ProviderSettingsHeader.text_d1f1ff14e5")}
    actions={<>
      <button className="os-btn icon" disabled={busy || editing} onClick={onReload}
        aria-label={t("provider.ProviderSettingsHeader.text_3c8dbe73a1")} title={t("provider.ProviderSettingsHeader.text_3c8dbe73a1")} type="button">
        <RefreshCcw aria-hidden="true" size={ICON.sm} />
      </button>
      <button className="os-btn primary provider-add" disabled={busy || editing} onClick={onAdd} type="button">
        <Plus aria-hidden="true" size={ICON.sm} />{t("provider.ProviderSettingsHeader.text_7add78b882")}</button>
    </>}
  />;
}

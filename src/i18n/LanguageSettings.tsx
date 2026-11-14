import { Select } from "../components/controls/Select";
import { useTranslation, type LocalePreference } from "./index";

export function LanguageSettings() {
  const { t } = useTranslation();
  return <div className="appearance__field language-settings">
    <label className="appearance__label" htmlFor="app-language">{t("common.language")}</label>
    <LanguageSelect />
  </div>;
}

/** 只有下拉本身（设置行型里标题在左侧）。 */
export function LanguageSelect() {
  const { t, preference, setLocale } = useTranslation();
  return <Select<LocalePreference> id="app-language" ariaLabel={t("common.language")} value={preference} onChange={setLocale}
    options={[
      { value: "system", label: t("common.languageSystem") },
      { value: "zh-CN", label: t("common.languageChinese") },
      { value: "en", label: t("common.languageEnglish") },
    ]} />;
}

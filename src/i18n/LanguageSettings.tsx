import { Select } from "../components/controls/Select";
import { useTranslation, type LocalePreference } from "./index";

export function LanguageSettings() {
  const { t, preference, setLocale } = useTranslation();
  return <div className="appearance__field language-settings">
    <label className="appearance__label" htmlFor="app-language">{t("common.language")}</label>
    <Select<LocalePreference> id="app-language" ariaLabel={t("common.language")} value={preference} onChange={setLocale}
      options={[
        { value: "system", label: t("common.languageSystem") },
        { value: "zh-CN", label: t("common.languageChinese") },
        { value: "en", label: t("common.languageEnglish") },
      ]} />
  </div>;
}

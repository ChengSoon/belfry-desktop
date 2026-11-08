import { useTranslation } from "../../i18n";
// Adapted from PI-Desktop PluginsPage.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { usePluginsPage } from "./context";
import { IconSparkles } from "./icons";
import { Button } from "./ui";
import { t } from "./i18n";
import { TEMPLATE_IDS } from "./helpers";
import { createFromTemplate } from "./useCenterActions";
import { useModal } from "./useModal";
import { useState } from "react";
import { Input } from "./ui";
import { RadioGroup } from "../../components/controls/RadioGroup";

export function TemplateDialog() {
  useTranslation();
  const { actions, template, setTemplate } = usePluginsPage();
  const [name, setName] = useState(t("plugins.TemplateDialog.text_1b70686b64")), [id, setId] = useState(""), [author, setAuthor] = useState("");
  const ref = useModal(() => setTemplate(null), actions.busy);
  return <div className="plugins-modal-backdrop" role="presentation" ref={ref}><div className="plugins-modal" role="dialog" aria-modal="true" aria-label={t("plugins.newFromTemplateTitle")}>
    <header className="plugins-modal-head"><span className="plugins-modal-icon" aria-hidden><IconSparkles size={17} /></span>
      <div><h2 className="plugins-modal-title">{t("plugins.newFromTemplateTitle")}</h2><p className="plugins-modal-subtitle">{t("plugins.newFromTemplateHint")}</p></div></header>
    <div className="plugins-modal-body"><p className="plugins-modal-lede">{t("plugins.newFromTemplateBody")}</p>
      <div className="plugins-author-fields">
        <label className="plugins-author-field"><span>{t("plugins.TemplateDialog.text_e148916839")}</span><Input value={name} maxLength={100} disabled={actions.busy} onChange={(event) => setName(event.target.value)} /></label>
        <label className="plugins-author-field"><span>{t("plugins.TemplateDialog.text_aa2b9832da")}</span><Input value={id} maxLength={128} disabled={actions.busy} placeholder={t("plugins.TemplateDialog.text_6fc026f51d")} onChange={(event) => setId(event.target.value)} /></label>
        <label className="plugins-author-field"><span>{t("plugins.TemplateDialog.text_7d4146ca08")}</span><Input value={author} maxLength={100} disabled={actions.busy} placeholder={t("plugins.TemplateDialog.text_0782657203")} onChange={(event) => setAuthor(event.target.value)} /></label>
      </div>
      <RadioGroup value={template ?? "panel-basic"} onChange={setTemplate} ariaLabel={t("plugins.newFromTemplateTitle")}
        disabled={actions.busy} options={TEMPLATE_IDS.map((id) => ({ value: id, label: t(`plugins.templateName.${id}`), description: t(`plugins.templateBody.${id}`) }))} />
    </div>{actions.error ? <p className="plugins-settings-error" role="alert">{actions.error}</p> : null}
    <div className="plugins-modal-actions"><Button disabled={actions.busy} onClick={() => setTemplate(null)}>{t("plugins.cancel")}</Button>
      <Button variant="primary" disabled={actions.busy || !name.trim()} onClick={async () => { if (template && await createFromTemplate(actions, template, { name, id, author })) setTemplate(null); }}>
        {t(actions.busy ? "plugins.newFromTemplateCreating" : "plugins.newFromTemplateCreate")}</Button></div>
  </div></div>;
}

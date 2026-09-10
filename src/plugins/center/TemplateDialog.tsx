// Adapted from PI-Desktop PluginsPage.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { usePluginsPage } from "./context";
import { IconCheck, IconSparkles } from "./icons";
import { Button, cx } from "./ui";
import { t } from "./i18n";
import { TEMPLATE_IDS } from "./helpers";
import { createFromTemplate } from "./useCenterActions";
import { useModal } from "./useModal";
import { useState } from "react";
import { Input } from "./ui";

export function TemplateDialog() {
  const { actions, template, setTemplate } = usePluginsPage();
  const [name, setName] = useState("我的插件"), [id, setId] = useState(""), [author, setAuthor] = useState("");
  const ref = useModal(() => setTemplate(null), actions.busy);
  return <div className="plugins-modal-backdrop" role="presentation" ref={ref}><div className="plugins-modal" role="dialog" aria-modal="true" aria-label={t("plugins.newFromTemplateTitle")}>
    <header className="plugins-modal-head"><span className="plugins-modal-icon" aria-hidden><IconSparkles size={17} /></span>
      <div><h2 className="plugins-modal-title">{t("plugins.newFromTemplateTitle")}</h2><p className="plugins-modal-subtitle">{t("plugins.newFromTemplateHint")}</p></div></header>
    <div className="plugins-modal-body"><p className="plugins-modal-lede">{t("plugins.newFromTemplateBody")}</p>
      <div className="plugins-author-fields">
        <label className="plugins-author-field"><span>插件名称</span><Input value={name} maxLength={100} disabled={actions.busy} onChange={(event) => setName(event.target.value)} /></label>
        <label className="plugins-author-field"><span>插件 ID</span><Input value={id} maxLength={128} disabled={actions.busy} placeholder="留空时按目录名生成，如 mine.notes" onChange={(event) => setId(event.target.value)} /></label>
        <label className="plugins-author-field"><span>作者</span><Input value={author} maxLength={100} disabled={actions.busy} placeholder="你的名字或团队名" onChange={(event) => setAuthor(event.target.value)} /></label>
      </div>
      <div className="plugins-template-list" role="radiogroup" aria-label={t("plugins.newFromTemplateTitle")}>
        {TEMPLATE_IDS.map((id) => <button key={id} type="button" role="radio" aria-checked={template === id} className={cx("plugins-template", template === id && "active")}
          disabled={actions.busy} onClick={() => setTemplate(id)}><span className="plugins-template-mark" aria-hidden>{template === id ? <IconCheck size={13} /> : null}</span>
          <span className="plugins-template-copy"><strong className="plugins-template-name">{t(`plugins.templateName.${id}`)}</strong><span className="plugins-template-body">{t(`plugins.templateBody.${id}`)}</span></span>
        </button>)}
      </div>
    </div>{actions.error ? <p className="plugins-settings-error" role="alert">{actions.error}</p> : null}
    <div className="plugins-modal-actions"><Button disabled={actions.busy} onClick={() => setTemplate(null)}>{t("plugins.cancel")}</Button>
      <Button variant="primary" disabled={actions.busy || !name.trim()} onClick={async () => { if (template && await createFromTemplate(actions, template, { name, id, author })) setTemplate(null); }}>
        {t(actions.busy ? "plugins.newFromTemplateCreating" : "plugins.newFromTemplateCreate")}</Button></div>
  </div></div>;
}

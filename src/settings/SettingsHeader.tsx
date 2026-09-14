import type { ReactNode } from "react";

/** 设置分区的统一页头；空间不足时动作区换行，标题和说明保持在一起。 */
export function SettingsHeader({ title, description, actions }: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="settings-head">
      <div className="settings-head__copy">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="settings-head__actions">{actions}</div> : null}
    </header>
  );
}

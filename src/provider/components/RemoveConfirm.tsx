import { t, useTranslation } from "../../i18n";
import type { ProviderConfig } from "../contracts";
import { useDismiss } from "../../workspace/useDismiss";

export function RemoveConfirm({
  config,
  isCurrent,
  onCancel,
  onConfirm,
}: {
  config: ProviderConfig;
  isCurrent: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useTranslation();
  const ref = useDismiss<HTMLDivElement>(true, onCancel);
  return (
    <div className="modal-scrim provider-confirm">
      <div aria-modal="true" className="modal" ref={ref} role="dialog">
        <strong className="modal__title">{t("provider.RemoveConfirm.text_5caa73305f", { name: config.name })}</strong>
        <p className="modal__body">
          {isCurrent
            ? t("provider.RemoveConfirm.text_1fe56f30b9")
            : t("provider.RemoveConfirm.text_43726f8de5")}
        </p>
        <div className="modal__actions">
          <button onClick={onCancel} type="button">{t("provider.RemoveConfirm.text_2cd0f3be87")}</button>
          <button className="modal__danger" onClick={onConfirm} type="button">{t("provider.RemoveConfirm.text_2f9daa8289")}</button>
        </div>
      </div>
    </div>
  );
}

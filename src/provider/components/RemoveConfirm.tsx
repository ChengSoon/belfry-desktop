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
  const ref = useDismiss<HTMLDivElement>(true, onCancel);
  return (
    <div className="modal-scrim provider-confirm">
      <div aria-modal="true" className="modal" ref={ref} role="dialog">
        <strong className="modal__title">删除 {config.name}？</strong>
        <p className="modal__body">
          {isCurrent
            ? "它正在生效，删除后会先切回官方端点。API Key 一并删掉，撤不回来。"
            : "API Key 会一并删掉，撤不回来。"}
        </p>
        <div className="modal__actions">
          <button onClick={onCancel} type="button">取消</button>
          <button className="modal__danger" onClick={onConfirm} type="button">删除</button>
        </div>
      </div>
    </div>
  );
}

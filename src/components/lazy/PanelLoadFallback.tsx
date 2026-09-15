import { AlertTriangle, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import type { PanelWidthSpec } from "../../panel/panelWidth";
import { usePanelWidth } from "../../panel/usePanelWidth";
import { ICON } from "../../theme/sizing";
import { useDialog } from "../controls/useDialog";
import "./optionalPanel.css";

export interface PanelPresentation {
  title: string;
  layout: "settings" | "modal" | "history" | "usage";
  width?: PanelWidthSpec;
}
interface Props extends PanelPresentation {
  failed: boolean; recoveryRequired?: boolean; onClose: () => void; onRetry: () => void; onUnmount: () => void;
}

export function PanelLoadFallback(props: Props) {
  // 加载完成后，尚未自行接管焦点的侧栏把输入交回原终端。
  useEffect(() => props.onUnmount, [props.onUnmount]);
  if (props.layout === "modal") return <ModalFallback {...props} />;
  if (props.width) return <SidePanelFallback {...props} width={props.width} />;
  return <PanelFallback {...props} />;
}

function SidePanelFallback(props: Props & { width: PanelWidthSpec }) {
  const { width } = usePanelWidth(props.width);
  return <PanelFallback {...props} style={{ width }} />;
}

function PanelFallback(props: Props & { style?: CSSProperties }) {
  const close = useRef<HTMLButtonElement>(null);
  const latest = useRef(props.onClose);
  latest.current = props.onClose;
  useEffect(() => {
    close.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  return <section aria-label={props.title} aria-busy={!props.failed} style={props.style}
    className={`${props.layout === "settings" ? "settings-view" : `${props.layout}-panel`} optional-panel-fallback optional-panel-fallback--${props.layout}`}>
    <header className="optional-panel-fallback__head"><h2>{props.title}</h2>
      <button aria-label={`关闭${props.title}`} className="icon-button icon-button--sm" ref={close}
        onClick={props.onClose} type="button"><X aria-hidden="true" size={ICON.md} /></button>
    </header>
    <FallbackMessage {...props} />
  </section>;
}

function ModalFallback(props: Props) {
  const ref = useDialog(props.onClose);
  return <div className="modal-scrim" onPointerDown={(event) => {
    if (event.target === event.currentTarget) props.onClose();
  }}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={props.title} ref={ref}>
      <strong className="modal__title">{props.title}</strong>
      <FallbackMessage {...props} />
      <div className="modal__actions"><button onClick={props.onClose} type="button">关闭</button></div>
    </div>
  </div>;
}

function FallbackMessage({ title, failed, recoveryRequired, onRetry, onClose }: Props) {
  const message = recoveryRequired
    ? `${title}重试后仍未能加载。请先保存终端工作，确认连接正常后手动重新打开 Belfry。当前终端可继续使用。`
    : `${title}未能加载，请重试。`;
  return <div className="optional-panel-fallback__body">
    <p role={failed ? "alert" : "status"}>
      {failed ? <AlertTriangle aria-hidden="true" size={ICON.md} />
        : <LoaderCircle aria-hidden="true" className="optional-panel-fallback__spinner" size={ICON.md} />}
      {failed ? message : `正在加载${title}…`}
    </p>
    {failed ? recoveryRequired
      ? <button className="optional-panel-fallback__return" onClick={onClose} type="button">返回终端</button>
      : <button className="optional-panel-fallback__retry" onClick={onRetry} type="button">重新加载</button> : null}
  </div>;
}

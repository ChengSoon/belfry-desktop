import { t, useTranslation } from "../../i18n";
import { AlertTriangle, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import type { PanelWidthSpec } from "../../panel/panelWidth";
import { usePanelWidth } from "../../panel/usePanelWidth";
import { ICON } from "../../theme/sizing";
import { useDialog } from "../controls/useDialog";
import { composingKey } from "../../utils/keyboard";
import "./optionalPanel.css";

export interface PanelPresentation {
  title: string;
  layout: "settings" | "room" | "modal" | "history" | "usage";
  width?: PanelWidthSpec;
}
interface Props extends PanelPresentation {
  failed: boolean; recoveryRequired?: boolean; onClose: () => void; onRetry: () => void; onUnmount: () => void;
}

export function PanelLoadFallback(props: Props) {
  useTranslation();
  // 加载完成后，尚未自行接管焦点的侧栏把输入交回原终端。
  useEffect(() => props.onUnmount, [props.onUnmount]);
  if (props.layout === "modal") return <ModalFallback {...props} />;
  if (props.width) return <SidePanelFallback {...props} width={props.width} />;
  return <PanelFallback {...props} />;
}

function SidePanelFallback(props: Props & { width: PanelWidthSpec }) {
  useTranslation();
  const { width } = usePanelWidth(props.width);
  return <PanelFallback {...props} style={{ width }} />;
}

function PanelFallback(props: Props & { style?: CSSProperties }) {
  useTranslation();
  const close = useRef<HTMLButtonElement>(null);
  const latest = useRef(props.onClose);
  latest.current = props.onClose;
  useEffect(() => {
    close.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || composingKey(event)) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  return <section aria-label={props.title} aria-busy={!props.failed} style={props.style}
    className={`${props.layout === "settings" ? "settings-view" : `${props.layout}-panel`} optional-panel-fallback optional-panel-fallback--${props.layout}`}>
    <header className="optional-panel-fallback__head"><h2>{props.title}</h2>
      <button aria-label={t("components.PanelLoadFallback.text_bda3b56ecf", { title: props.title })} className="icon-button icon-button--sm" ref={close}
        onClick={props.onClose} type="button"><X aria-hidden="true" size={ICON.md} /></button>
    </header>
    <FallbackMessage {...props} />
  </section>;
}

function ModalFallback(props: Props) {
  useTranslation();
  const ref = useDialog(props.onClose);
  return <div className="modal-scrim" onPointerDown={(event) => {
    if (event.target === event.currentTarget) props.onClose();
  }}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={props.title} ref={ref}>
      <strong className="modal__title">{props.title}</strong>
      <FallbackMessage {...props} />
      <div className="modal__actions"><button onClick={props.onClose} type="button">{t("components.PanelLoadFallback.text_3fd47edce4")}</button></div>
    </div>
  </div>;
}

function FallbackMessage({ title, failed, recoveryRequired, onRetry, onClose }: Props) {
  useTranslation();
  const message = recoveryRequired
    ? t("components.PanelLoadFallback.text_23643797fc", { title: title })
    : t("components.PanelLoadFallback.text_0f1f225256", { title: title });
  return <div className="optional-panel-fallback__body">
    <p role={failed ? "alert" : "status"}>
      {failed ? <AlertTriangle aria-hidden="true" size={ICON.md} />
        : <LoaderCircle aria-hidden="true" className="optional-panel-fallback__spinner" size={ICON.md} />}
      {failed ? message : t("components.PanelLoadFallback.text_4f1cc61349", { title: title })}
    </p>
    {failed ? recoveryRequired
      ? <button className="optional-panel-fallback__return" onClick={onClose} type="button">{t("components.PanelLoadFallback.text_576bad3620")}</button>
      : <button className="optional-panel-fallback__retry" onClick={onRetry} type="button">{t("components.PanelLoadFallback.text_7bdd5ce1e2")}</button> : null}
  </div>;
}

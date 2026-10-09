import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import panelShell from "../../panel/panelShell.css?inline";
import settingsShell from "../../settings/settingsShell.css?inline";
import { createPanelImport, type PanelModule } from "./panelImport";
import { PanelLoadFallback, type PanelPresentation } from "./PanelLoadFallback";
import { PanelRecoveryRequired } from "./panelFailure";

interface PanelOptions<Props> extends PanelPresentation {
  load: () => Promise<PanelModule<Props>>;
  exportName?: string;
}

export function createOptionalPanel<Props extends { onClose: () => void }>(options: PanelOptions<Props>) {
  const load = createPanelImport(options.load, options.exportName);
  // Reuse the resolved lazy payload across close/reopen. A fresh lazy object would
  // suspend again even when import() is cached, flashing the loading shell.
  const freshPanel = () => lazy(async () => {
    try { return await load(); }
    catch (error) {
      // Do not retain a rejected React.lazy payload after a recoverable import
      // failure. Reopen and explicit retry must both be able to load it again.
      CachedPanel = freshPanel();
      throw error;
    }
  });
  let CachedPanel = freshPanel();
  return function OptionalPanel(props: Props) {
    const [attempt, setAttempt] = useState(0);
    const [Panel, setPanel] = useState(() => CachedPanel);
    const retry = () => {
      CachedPanel = freshPanel();
      setPanel(() => CachedPanel);
      setAttempt((value) => value + 1);
    };
    const restoreFocus = usePanelFocusReturn();
    const fallback = (failed = false, error?: unknown) => <PanelLoadFallback {...options} failed={failed}
      recoveryRequired={error instanceof PanelRecoveryRequired}
      onClose={props.onClose} onUnmount={restoreFocus} onRetry={retry} />;
    return <>
      <PanelErrorBoundary key={attempt} fallback={(error) => fallback(true, error)}>
        <Suspense fallback={fallback()}><Panel {...props} /></Suspense>
      </PanelErrorBoundary>
      {/* 异步 CSS 进入 head 后，公共外壳仍最后生效；复用原样式，避免复制规格。 */}
      <style data-optional-panel-shell>{panelShell + settingsShell}</style>
    </>;
  };
}

class PanelErrorBoundary extends Component<{
  children: ReactNode; fallback: (error: unknown) => ReactNode;
}, { failed: boolean; error: unknown }> {
  state = { failed: false, error: null };
  static getDerivedStateFromError(error: unknown) { return { failed: true, error }; }
  render() { return this.state.failed ? this.props.fallback(this.state.error) : this.props.children; }
}

function usePanelFocusReturn() {
  const previous = useRef(typeof document === "undefined" ? null : document.activeElement);
  const restore = useCallback(() => {
    // 等子面板的焦点清理完成，再返回打开面板前的控件或终端。
    queueMicrotask(() => {
      const target = previous.current, active = document.activeElement;
      // 新面板或用户已经选择了焦点时，旧面板的清理不能把它抢走。
      if (active && active !== document.body && active.isConnected) return;
      if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
    });
  }, []);
  useEffect(() => restore, [restore]);
  return restore;
}

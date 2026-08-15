import { Image, Waypoints } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppearanceSection } from "../background/components/AppearanceSection";
import { ProviderSection } from "../provider/components/ProviderSection";
import { ICON } from "../theme/sizing";
import { useDismiss } from "../workspace/useDismiss";
import "./settings.css";

const SECTIONS = [
  { icon: Image, key: "appearance", label: "外观" },
  { icon: Waypoints, key: "provider", label: "Provider" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

/**
 * 设置。所有配置都收在这一个入口里，侧栏就不必为每加一类设置多长一个图标。
 *
 * 各个分区自己决定「现在能不能被关掉」——provider 那边表单填到一半时，
 * 一次误点框外就把输入全丢了。
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState<SectionKey>("appearance");
  const [guarded, setGuarded] = useState(false);
  const panelRef = useDismiss<HTMLDivElement>(!guarded, onClose);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div className="modal-scrim">
      <div
        aria-labelledby="settings-title"
        aria-modal="true"
        className="modal modal--settings"
        ref={panelRef}
        role="dialog"
      >
        <strong className="modal__title" id="settings-title">设置</strong>

        <div className="settings__body">
          <nav aria-label="设置分类" className="settings__nav">
            {SECTIONS.map(({ icon: Icon, key, label }) => (
              <button
                aria-current={active === key}
                className={active === key ? "is-active" : undefined}
                disabled={guarded && active !== key}
                key={key}
                onClick={() => setActive(key)}
                type="button"
              >
                <Icon aria-hidden="true" size={ICON.sm} />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="settings__panel">
            {active === "appearance" ? <AppearanceSection /> : null}
            {active === "provider" ? <ProviderSection onGuardChange={setGuarded} /> : null}
          </div>
        </div>

        <div className="modal__actions">
          <button disabled={guarded} onClick={onClose} ref={closeRef} type="button">完成</button>
        </div>
      </div>
    </div>
  );
}

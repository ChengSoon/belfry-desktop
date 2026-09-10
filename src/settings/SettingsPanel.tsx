import { Boxes, HeartPulse, Image, Waypoints, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppearanceSection } from "../background/components/AppearanceSection";
import { ProviderSection } from "../provider/components/ProviderSection";
import { EnvironmentSection } from "../setup/EnvironmentSection";
import { PluginPanel } from "../plugins/PluginPanel";
import { ICON } from "../theme/sizing";
import "./settings.css";

const SECTIONS = [
  { icon: Image, key: "appearance", label: "外观" },
  { icon: Waypoints, key: "provider", label: "Provider" },
  { icon: HeartPulse, key: "environment", label: "协作环境" },
  { icon: Boxes, key: "plugins", label: "插件" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];
export const settingsSectionKeys = SECTIONS.map((section) => section.key);
export function normalizeSettingsSection(value: string | undefined): SectionKey {
  return value && settingsSectionKeys.includes(value as SectionKey) ? (value as SectionKey) : "appearance";
}

/**
 * 设置视图。整窗铺开，像 Codex 桌面版那样「左侧分类导航，右侧内容」。
 * 打开时主界面整片隐藏（保持挂载，PTY 不断），见 workspace.css 的 is-settings 规则。
 *
 * 各个分区自己决定「现在能不能被关掉」——provider 那边表单填到一半时，
 * 关闭按钮和 Escape 先不响应，防止误触把输入全丢了。
 */
export function SettingsPanel({ onClose, initialSection }: { onClose: () => void; initialSection?: string }) {
  const [active, setActive] = useState<SectionKey>(() => normalizeSettingsSection(initialSection));
  const [guarded, setGuarded] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (guarded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [guarded, onClose]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <section aria-label="设置" className="settings-view">
      <nav aria-label="设置分类" className="settings-nav">
        <div className="settings-nav__head">
          <strong id="settings-title">设置</strong>
          <button
            className="icon-button icon-button--sm"
            disabled={guarded}
            onClick={onClose}
            ref={closeRef}
            title="关闭设置"
            type="button"
          >
            <X aria-hidden="true" size={ICON.md} />
          </button>
        </div>

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

      <div className="settings-content">
        {active === "appearance" ? <AppearanceSection /> : null}
        {active === "provider" ? <ProviderSection onGuardChange={setGuarded} /> : null}
        {active === "environment" ? <EnvironmentSection /> : null}
        {active === "plugins" ? <PluginPanel onGuardChange={setGuarded} /> : null}
      </div>
    </section>
  );
}

import { Activity, Archive, Boxes, FolderGit2, HeartPulse, Image, Keyboard, Waypoints, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppearanceSection } from "../background/components/AppearanceSection";
import { ProviderSection } from "../provider/components/ProviderSection";
import { ProjectProviderSection } from "../provider/project/ProjectProviderSection";
import type { ProjectWorkspace } from "../workspace/contracts";
import { EnvironmentSection } from "../setup/EnvironmentSection";
import { PluginPanel } from "../plugins/PluginPanel";
import { ICON } from "../theme/sizing";
import { HookSettingsSection } from "../agent/hooks/HookSettingsSection";
import { ShortcutSettingsSection } from "../shortcuts/custom/ShortcutSettingsSection";
import { BackupSection } from "../backup/BackupSection";
import { BackgroundSessions } from "../terminal/daemon/BackgroundSessions";
import "./settings.css";

const SECTIONS = [
  { icon: Image, key: "appearance", label: "外观" },
  { icon: Waypoints, key: "provider", label: "全局 Provider" },
  { icon: FolderGit2, key: "project-provider", label: "项目 Provider" },
  { icon: Activity, key: "agent-hooks", label: "会话状态" },
  { icon: Keyboard, key: "shortcuts", label: "快捷键" },
  { icon: Archive, key: "backup", label: "本地备份" },
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
export function SettingsPanel({ onClose, initialSection, project = null }: { onClose: () => void; initialSection?: string; project?: ProjectWorkspace | null }) {
  const [active, setActive] = useState<SectionKey>(() => normalizeSettingsSection(initialSection));
  const [guarded, setGuarded] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (guarded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
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
        {active === "project-provider" ? <ProjectProviderSection project={project} /> : null}
        {active === "agent-hooks" ? <><HookSettingsSection onGuardChange={setGuarded} /><BackgroundSessions /></> : null}
        {active === "shortcuts" ? <ShortcutSettingsSection onGuardChange={setGuarded} /> : null}
        {active === "backup" ? <BackupSection onGuardChange={setGuarded} /> : null}
        {active === "environment" ? <EnvironmentSection /> : null}
        {active === "plugins" ? <PluginPanel onGuardChange={setGuarded} /> : null}
      </div>
    </section>
  );
}

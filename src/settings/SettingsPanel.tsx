import { Activity, Archive, Boxes, FolderGit2, HeartPulse, Image, Info, Keyboard, Search, Waypoints, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppearanceSection } from "../background/components/AppearanceSection";
import { ProviderSection } from "../provider/components/ProviderSection";
import { ProjectProviderSection } from "../provider/project/ProjectProviderSection";
import type { ProjectWorkspace } from "../workspace/contracts";
import type { UpdaterState } from "../updater/contracts";
import { EnvironmentSection } from "../setup/EnvironmentSection";
import { PluginPanel } from "../plugins/PluginPanel";
import { ICON } from "../theme/sizing";
import { HookSettingsSection } from "../agent/hooks/HookSettingsSection";
import { ShortcutSettingsSection } from "../shortcuts/custom/ShortcutSettingsSection";
import { AboutSection } from "../about/AboutSection";
import { BackupSection } from "../backup/BackupSection";
import { BackgroundSessions } from "../terminal/daemon/BackgroundSessions";
import { composingKey } from "../utils/keyboard";
import "./settings.css";

const SECTIONS = [
  { icon: Image, key: "appearance", label: "外观", group: "工作环境", keywords: "主题 字体 字号 壁纸 背景 theme font wallpaper" },
  { icon: Keyboard, key: "shortcuts", label: "快捷键", group: "工作环境", keywords: "键盘 按键 keyboard" },
  { icon: Waypoints, key: "provider", label: "全局 Provider", group: "Agent 与连接", keywords: "claude codex pi 模型 服务 API 密钥" },
  { icon: FolderGit2, key: "project-provider", label: "项目 Provider", group: "Agent 与连接", keywords: "claude codex pi 项目覆盖 模型 服务 API" },
  { icon: Activity, key: "agent-hooks", label: "会话状态", group: "Agent 与连接", keywords: "hooks 后台会话 background session" },
  { icon: Boxes, key: "plugins", label: "插件", group: "扩展", keywords: "安装 市场 plugin" },
  { icon: Archive, key: "backup", label: "本地备份", group: "数据与安全", keywords: "恢复 导入 导出 数据 backup" },
  { icon: HeartPulse, key: "environment", label: "协作环境", group: "帮助与诊断", keywords: "检查 安装 诊断 环境 environment" },
  { icon: Info, key: "about", label: "关于", group: "帮助与诊断", keywords: "版本 更新 CLI 帮助 update" },
] as const;

export const settingsGroups = ["工作环境", "Agent 与连接", "扩展", "数据与安全", "帮助与诊断"] as const;
export function filterSettingsNavigation(query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return settingsGroups.map((label) => ({ label, sections: SECTIONS.filter((section) =>
    section.group === label && words.every((word) =>
      `${section.label} ${section.group} ${section.key} ${section.keywords}`.toLocaleLowerCase().includes(word)))
  })).filter((group) => group.sections.length > 0);
}

type SectionKey = (typeof SECTIONS)[number]["key"];
export const settingsSectionKeys = SECTIONS.map((section) => section.key);
export function normalizeSettingsSection(value: string | undefined): SectionKey {
  return value && settingsSectionKeys.includes(value as SectionKey) ? (value as SectionKey) : "appearance";
}

/** Settings replaces only the visible shell; workspace terminals remain mounted.
 * Search filters navigation, never the current editor or its unsaved guard. */
export function SettingsPanel({ onClose, initialSection, project = null, updaterState, updaterOpen, onOpenUpdater }: {
  onClose: () => void;
  initialSection?: string;
  project?: ProjectWorkspace | null;
  updaterState: UpdaterState;
  updaterOpen: boolean;
  onOpenUpdater: () => void;
}) {
  const [active, setActive] = useState<SectionKey>(() => normalizeSettingsSection(initialSection));
  const [guarded, setGuarded] = useState(false);
  const [query, setQuery] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (guarded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !composingKey(event)) onClose();
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

        <SettingsNavigation active={active} guarded={guarded} query={query} onQuery={setQuery}
          onSelect={(key) => { if (!guarded) setActive(key); }} />
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
        {active === "about" ? (
          <AboutSection
            onGuardChange={setGuarded}
            onOpenUpdater={onOpenUpdater}
            updaterOpen={updaterOpen}
            updaterState={updaterState}
          />
        ) : null}
      </div>
    </section>
  );
}

export function SettingsNavigation({ active, guarded, query, onQuery, onSelect }: {
  active: SectionKey; guarded: boolean; query: string;
  onQuery: (query: string) => void; onSelect: (key: SectionKey) => void;
}) {
  const groups = filterSettingsNavigation(query);
  return <>
    <label className="settings-search">
      <Search aria-hidden="true" size={ICON.sm} />
      <input aria-label="搜索设置分类" type="search" value={query} placeholder="搜索设置…"
        onChange={(event) => onQuery(event.target.value)} />
    </label>
    {groups.map(({ label, sections }) => <div className="settings-nav__group" role="group" aria-label={label} key={label}>
      <h3>{label}</h3>
      {sections.map(({ icon: Icon, key, label: sectionLabel }) => <button
        aria-current={active === key ? "page" : undefined}
        className={active === key ? "is-active" : undefined}
        disabled={guarded && active !== key} key={key}
        onClick={() => { if (!guarded) onSelect(key); }} type="button">
        <Icon aria-hidden="true" size={ICON.sm} /><span>{sectionLabel}</span>
      </button>)}
    </div>)}
    {groups.length === 0 ? <p className="settings-nav__empty" role="status">没有匹配的设置分类。当前内容保持打开。</p> : null}
    {guarded ? <p className="settings-nav__guard" role="status">当前操作尚未完成，请在内容区保存或取消后离开。</p> : null}
  </>;
}

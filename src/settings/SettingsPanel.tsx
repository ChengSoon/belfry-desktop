import { localized, t, useTranslation } from "../i18n";
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

const SECTIONS = localized(() => ([
  { icon: Image, key: "appearance", label: t("settings.SettingsPanel.text_86a63f23a0"), group: t("settings.SettingsPanel.text_7958d84e9a"), keywords: t("settings.SettingsPanel.text_d27d4b755c") },
  { icon: Keyboard, key: "shortcuts", label: t("settings.SettingsPanel.text_ee2638183d"), group: t("settings.SettingsPanel.text_7958d84e9a"), keywords: t("settings.SettingsPanel.text_3556d0b987") },
  { icon: Waypoints, key: "provider", label: t("settings.SettingsPanel.text_c5ecb59fd4"), group: t("settings.SettingsPanel.text_db94a5b8e2"), keywords: t("settings.SettingsPanel.text_f008673667") },
  { icon: FolderGit2, key: "project-provider", label: t("settings.SettingsPanel.text_784caf2b25"), group: t("settings.SettingsPanel.text_db94a5b8e2"), keywords: t("settings.SettingsPanel.text_16e5b1c831") },
  { icon: Activity, key: "agent-hooks", label: t("settings.SettingsPanel.text_ea5e729632"), group: t("settings.SettingsPanel.text_db94a5b8e2"), keywords: t("settings.SettingsPanel.text_fead0c3b1d") },
  { icon: Boxes, key: "plugins", label: t("settings.SettingsPanel.text_e806fbbe8e"), group: t("settings.SettingsPanel.text_99a4e1e597"), keywords: t("settings.SettingsPanel.text_70fc2aa517") },
  { icon: Archive, key: "backup", label: t("settings.SettingsPanel.text_daa0a5cd5b"), group: t("settings.SettingsPanel.text_14b627f5a0"), keywords: t("settings.SettingsPanel.text_090bc38028") },
  { icon: HeartPulse, key: "environment", label: t("settings.SettingsPanel.text_821f9ff1ad"), group: t("settings.SettingsPanel.text_bcb3eed213"), keywords: t("settings.SettingsPanel.text_74c727449a") },
  { icon: Info, key: "about", label: t("settings.SettingsPanel.text_52d25a9e30"), group: t("settings.SettingsPanel.text_bcb3eed213"), keywords: t("settings.SettingsPanel.text_254b2d7fcb") },
] as const));

export const settingsGroups = localized(() => ([t("settings.SettingsPanel.text_7958d84e9a"), t("settings.SettingsPanel.text_db94a5b8e2"), t("settings.SettingsPanel.text_99a4e1e597"), t("settings.SettingsPanel.text_14b627f5a0"), t("settings.SettingsPanel.text_bcb3eed213")] as const));
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
  useTranslation();
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
    <section aria-label={t("settings.SettingsPanel.text_df3d58c7d8")} className="settings-view">
      <nav aria-label={t("settings.SettingsPanel.text_dfb699c543")} className="settings-nav">
        <div className="settings-nav__head">
          <strong id="settings-title">{t("settings.SettingsPanel.text_df3d58c7d8")}</strong>
          <button
            className="icon-button icon-button--sm"
            disabled={guarded}
            onClick={onClose}
            ref={closeRef}
            title={t("settings.SettingsPanel.text_77b17fc4a5")}
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
  useTranslation();
  const groups = filterSettingsNavigation(query);
  return <>
    <label className="settings-search">
      <Search aria-hidden="true" size={ICON.sm} />
      <input aria-label={t("settings.SettingsPanel.text_100530944b")} type="search" value={query} placeholder={t("settings.SettingsPanel.text_f4b3b1bead")}
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
    {groups.length === 0 ? <p className="settings-nav__empty" role="status">{t("settings.SettingsPanel.text_f189f8b260")}</p> : null}
    {guarded ? <p className="settings-nav__guard" role="status">{t("settings.SettingsPanel.text_0f17ab1ea2")}</p> : null}
  </>;
}

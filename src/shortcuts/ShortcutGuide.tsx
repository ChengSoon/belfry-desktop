import { formatNumber, localized, t, useTranslation } from "../i18n";
import { Keyboard, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ICON } from "../theme/sizing";
import { AGENT_ICONS } from "../workspace/components/AgentIcons";
import { AGENT_KINDS, AGENT_METADATA } from "../agent/contracts";
import { useDismiss } from "../workspace/useDismiss";
import { guideFootnote, guideSections, type GuideSection, type GuideTab } from "./catalog";
import type { ShortcutPlatform } from "./resolveShortcut";
import { useShortcutSettings } from "./custom/useShortcutSettings";
import { composingKey } from "../utils/keyboard";
import "./shortcutGuide.css";

interface ShortcutGuideProps {
  onClose: () => void;
  platform: ShortcutPlatform;
}

const GUIDE_TABS: Array<{ key: GuideTab; label: string; icon: ReactNode }> = [
  { key: "belfry", label: "Belfry", icon: <Keyboard aria-hidden="true" size={ICON.sm} /> },
  ...AGENT_KINDS.map((key) => { const Icon = AGENT_ICONS[key]; return {
    key, label: AGENT_METADATA[key].name, icon: <Icon aria-hidden="true" size={ICON.sm} />,
  }; }),
];

const GUIDE_TAB_DESCRIPTIONS: Record<GuideTab, string> = localized(() => ({
  belfry: t("shortcuts.ShortcutGuide.text_423d007c5d"),
  codex: t("shortcuts.ShortcutGuide.text_aedd02d5e3"),
  claude: t("shortcuts.ShortcutGuide.text_e5a6fe5300"),
  pi: t("shortcuts.ShortcutGuide.text_1e47e914d8"),
  antigravity: t("shortcuts.ShortcutGuide.text_dcba5cba5b"),
  opencode: t("shortcuts.ShortcutGuide.text_2b3931746c"),
  kimi: t("shortcuts.ShortcutGuide.text_cf0b10128c"),
}));

export function ShortcutGuide({ onClose, platform }: ShortcutGuideProps) {
  useTranslation();
  useShortcutSettings();
  const [activeTab, setActiveTab] = useState<GuideTab>("belfry");
  const sections = guideSections(activeTab, platform);
  const itemCount = sections.reduce((total, group) => total + group.items.length, 0);
  const panelRef = useDismiss<HTMLDivElement>(true, onClose);
  const closeRef = useRef<HTMLButtonElement>(null);
  useRestoreFocus(closeRef);
  useTopLayerEscape(onClose);

  return (
    <div className="modal-scrim shortcut-guide__scrim">
      <div
        aria-describedby="shortcut-guide-description"
        aria-labelledby="shortcut-guide-title"
        aria-modal="true"
        className="modal modal--shortcut-guide"
        ref={panelRef}
        role="dialog"
      >
        <ShortcutHeader closeRef={closeRef} onClose={onClose} />
        <GuideTabs active={activeTab} onSelect={setActiveTab} />
        <p className="shortcut-guide__context" aria-live="polite">
          <span className="shortcut-guide__context-dot" aria-hidden="true" />
          {GUIDE_TAB_DESCRIPTIONS[activeTab]}
          <span className="shortcut-guide__context-count">{t("shortcuts.ShortcutGuide.text_74dd05e60f", { count: itemCount })}</span>
        </p>
        <div
          aria-labelledby={`shortcut-tab-${activeTab}`}
          className="shortcut-guide__body"
          id={`shortcut-panel-${activeTab}`}
          role="tabpanel"
        >
          <ShortcutGroups groups={sections} key={activeTab} />
        </div>
        <ShortcutFooter copy={guideFootnote(activeTab, platform)} tab={activeTab} />
      </div>
    </div>
  );
}

function useRestoreFocus(closeRef: RefObject<HTMLButtonElement | null>) {
  useTranslation();
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  useEffect(() => {
    closeRef.current?.focus();
    const returnFocus = returnFocusRef.current;
    return () => returnFocus?.focus();
  }, []);
}

function useTopLayerEscape(onClose: () => void) {
  useTranslation();
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || composingKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);
}

function ShortcutHeader({ closeRef, onClose }: {
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  useTranslation();
  return (
    <header className="shortcut-guide__head">
      <span className="shortcut-guide__mark" aria-hidden="true"><Keyboard size={ICON.lg} /></span>
      <div>
        <strong id="shortcut-guide-title">{t("shortcuts.ShortcutGuide.text_c813e695f2")}</strong>
        <p id="shortcut-guide-description">{t("shortcuts.ShortcutGuide.text_d766d2565b")}</p>
      </div>
      <button aria-label={t("shortcuts.ShortcutGuide.text_d9a2987f14")} className="icon-button icon-button--sm" onClick={onClose}
        ref={closeRef} title={t("shortcuts.ShortcutGuide.text_3fd47edce4")} type="button">
        <X aria-hidden="true" size={ICON.md} />
      </button>
    </header>
  );
}

function GuideTabs({ active, onSelect }: { active: GuideTab; onSelect: (tab: GuideTab) => void }) {
  useTranslation();
  return (
    <nav aria-label={t("shortcuts.ShortcutGuide.text_21a30357df")} className="shortcut-guide__tabs" role="tablist">
      {GUIDE_TABS.map((tab) => (
        <button aria-controls={`shortcut-panel-${tab.key}`} aria-selected={active === tab.key}
          data-tab={tab.key}
          id={`shortcut-tab-${tab.key}`} key={tab.key} onClick={() => onSelect(tab.key)}
          onKeyDown={(event) => moveTabFocus(event, tab.key, onSelect)} role="tab"
          tabIndex={active === tab.key ? 0 : -1} type="button">
          {tab.icon}<span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

function moveTabFocus(event: ReactKeyboardEvent, current: GuideTab, select: (tab: GuideTab) => void) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const index = GUIDE_TABS.findIndex((tab) => tab.key === current);
  const offset = event.key === "ArrowRight" ? 1 : -1;
  const next = GUIDE_TABS[(index + offset + GUIDE_TABS.length) % GUIDE_TABS.length].key;
  select(next);
  requestAnimationFrame(() => document.getElementById(`shortcut-tab-${next}`)?.focus());
}

function ShortcutGroups({ groups }: { groups: GuideSection[] }) {
  useTranslation();
  return (
    <div className="shortcut-guide__groups">
      {groups.map((group) => (
        <section className="shortcut-group" key={group.label}>
          <div className="shortcut-group__head">
            <h2>{group.label}</h2>
            <span className="shortcut-group__count">{formatNumber(group.items.length)}</span>
          </div>
          <ul className="shortcut-group__list">
            {group.items.map((item) => (
              <li className="shortcut-row" key={item.command ?? item.label}>
                <span className="shortcut-row__label" title={item.label}>{item.label}</span>
                <span className="shortcut-row__value">
                  {item.command ? <code>{item.command}</code> : <KeyChord keys={item.keys ?? []} />}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ShortcutFooter({ copy, tab }: { copy: string; tab: GuideTab }) {
  useTranslation();
  return (
    <footer className="shortcut-guide__foot">
      <span aria-hidden="true">{tab === "belfry" ? "TIP" : "CLI"}</span>
      <p>{copy}</p>
    </footer>
  );
}

function KeyChord({ keys }: { keys: string[] }) {
  useTranslation();
  return (
    <span aria-label={keys.join(" + ")} className="key-chord">
      {keys.map((key, index) => <kbd key={`${key}-${index}`}>{key}</kbd>)}
    </span>
  );
}

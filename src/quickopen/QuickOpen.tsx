import {
  ArrowDown,
  ArrowUp,
  Bot,
  Command,
  CornerDownLeft,
  FileSearch,
  FolderOpen,
  Gauge,
  History,
  Info,
  Keyboard,
  ListChecks,
  PanelLeft,
  Search,
  SearchX,
  Settings,
  type LucideIcon,
  SquareTerminal,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ICON } from "../theme/sizing";
import { useDialog } from "../components/controls/useDialog";
import { searchQuickOpen, type QuickOpenIcon, type QuickOpenItem, type QuickOpenItemKind } from "./model";
import "./quickOpen.css";
import { useMotionActive, useMotionState } from "../components/motion/Presence";
import { composingKey } from "../utils/keyboard";

interface QuickOpenProps {
  items: readonly QuickOpenItem[];
  shortcutLabel: string;
  onClose: () => void;
  onSelect: (item: QuickOpenItem) => void;
}

export function QuickOpen({ items, shortcutLabel, onClose, onSelect }: QuickOpenProps) {
  const active = useMotionActive();
  const motion = useMotionState();
  const chosen = useRef(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useDialog(onClose);
  const matches = useMemo(() => searchQuickOpen(items, query), [items, query]);
  const enabledIndices = useMemo(() => matches.flatMap(({ item }, index) => item.disabled ? [] : [index]), [matches]);
  const selectedIndex = enabledIndices.includes(activeIndex) ? activeIndex : enabledIndices[0] ?? -1;

  useLayoutEffect(() => {
    if (!active) return;
    chosen.current = false;
    // Presence can reopen before exit finishes, without remounting this instance.
    setQuery("");
    setActiveIndex(0);
    inputRef.current?.focus();
  }, [active]);

  useEffect(() => {
    if (active && selectedIndex >= 0) {
      document.getElementById(`quick-open-option-${selectedIndex}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [active, selectedIndex, matches]);

  const choose = (index: number) => {
    if (!active || chosen.current) return;
    const match = matches[index];
    if (!match || match.item.disabled) return;
    chosen.current = true;
    onSelect(match.item);
  };

  const move = (offset: number) => {
    if (enabledIndices.length === 0) return;
    const current = enabledIndices.indexOf(selectedIndex);
    setActiveIndex(enabledIndices[(current + offset + enabledIndices.length) % enabledIndices.length]);
  };

  return (
    <div
      className="modal-scrim quick-open__scrim"
      {...motion}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        aria-label="Quick Open"
        aria-modal="true"
        className="quick-open"
        onPointerDown={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
      >
        <header className="quick-open__head">
          <div className="quick-open__search-wrap">
            <Search aria-hidden="true" className="quick-open__search-icon" size={ICON.sm} />
            <input
              aria-activedescendant={selectedIndex >= 0 ? `quick-open-option-${selectedIndex}` : undefined}
              aria-controls="quick-open-results"
              aria-expanded="true"
              aria-label="搜索会话、项目或动作"
              autoComplete="off"
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (composingKey(event.nativeEvent)) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  move(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  move(-1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  setActiveIndex(enabledIndices[0] ?? -1);
                } else if (event.key === "End") {
                  event.preventDefault();
                  setActiveIndex(enabledIndices.at(-1) ?? -1);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  choose(selectedIndex);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  onClose();
                }
              }}
              placeholder="搜索会话、项目或动作"
              ref={inputRef}
              role="combobox"
              spellCheck={false}
              value={query}
            />
          </div>
          <button aria-label="关闭 Quick Open" className="icon-button icon-button--sm" onClick={onClose} title="关闭" type="button">
            <X aria-hidden="true" size={ICON.md} />
          </button>
        </header>
        <div className="quick-open__context" role="status" aria-live="polite">
          <span>会话 / 项目 / 动作</span><span>{matches.length} 个结果</span>
        </div>

        <div
          aria-label="Quick Open 结果"
          className="quick-open__results"
          id="quick-open-results"
          role="listbox"
        >
          {matches.length > 0 ? matches.map(({ item }, index) => (
            <button
              aria-selected={index === selectedIndex}
              className={`quick-open__item${index === selectedIndex ? " is-active" : ""}`}
              disabled={item.disabled}
              id={`quick-open-option-${index}`}
              key={item.id}
              onClick={() => choose(index)}
              onMouseEnter={() => { if (!item.disabled) setActiveIndex(index); }}
              onPointerDown={(event) => event.preventDefault()}
              tabIndex={-1}
              role="option"
              type="button"
            >
              <ItemIcon icon={item.icon} kind={item.kind} />
              <span className="quick-open__item-copy">
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </span>
              <span className="quick-open__item-kind">{kindLabel(item.kind)}</span>
            </button>
          )) : (
            <div className="quick-open__empty" role="status">
              <SearchX aria-hidden="true" size={ICON.lg} />
              <span>没有匹配结果</span>
            </div>
          )}
        </div>

        <footer className="quick-open__foot">
          <span><kbd><ArrowUp size={ICON.xs} /><ArrowDown size={ICON.xs} /></kbd> 选择</span>
          <span><kbd><CornerDownLeft size={ICON.xs} /></kbd> 打开</span>
          <span><kbd>Esc</kbd> 关闭</span>
          <span className="quick-open__shortcut"><Keyboard aria-hidden="true" size={ICON.xs} /> {shortcutLabel}</span>
        </footer>
      </div>
    </div>
  );
}

function ItemIcon({ kind, icon }: { kind: QuickOpenItemKind; icon?: QuickOpenIcon }) {
  const Icon = iconComponent(icon, kind);
  return <Icon aria-hidden="true" className="quick-open__item-icon" size={ICON.md} />;
}

function iconComponent(icon: QuickOpenIcon | undefined, kind: QuickOpenItemKind): LucideIcon {
  if (icon === "bot") return Bot;
  if (icon === "settings") return Settings;
  if (icon === "history") return History;
  if (icon === "info") return Info;
  if (icon === "gauge") return Gauge;
  if (icon === "sidebar") return PanelLeft;
  if (icon === "keyboard") return Keyboard;
  if (icon === "list-checks") return ListChecks;
  if (icon === "file-search") return FileSearch;
  if (icon === "folder" || kind === "project") return FolderOpen;
  if (icon === "terminal" || kind === "session") return SquareTerminal;
  return Command;
}

function kindLabel(kind: QuickOpenItemKind) {
  return kind === "session" ? "会话" : kind === "project" ? "项目" : "动作";
}

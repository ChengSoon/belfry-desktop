// Adapted from PI-Desktop ThemeRow.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useTheme } from "../theme/ThemeProvider";
import { selectPluginTheme, usePluginTheme } from "./pluginTheme";
import { usePluginRuntime } from "./usePluginRuntime";
import { usePopover } from "./center/usePopover";
import "./theme-picker.css";

interface Option { id: string; title: string; hint: string; plugin?: boolean }
const BUILTINS: Option[] = [
  { id: "system", title: "跟随系统", hint: "随系统外观自动切换" },
  { id: "light", title: "浅色", hint: "明亮的浅色界面" },
  { id: "dark", title: "深色", hint: "柔和的深色界面" },
];
function useThemePicker() {
  const theme = useTheme(), selectedPlugin = usePluginTheme(), { themes } = usePluginRuntime();
  const menu = usePopover(340), [query, setQuery] = useState(""), [active, setActive] = useState("");
  const options = [...BUILTINS, ...themes.map((item) => ({ id: `${item.pluginId}:${item.id}`, title: item.label, hint: `来自插件 ${item.pluginId}`, plugin: true }))];
  const selected = options.some((item) => item.id === selectedPlugin) ? selectedPlugin : theme.pinned ? theme.mode : "system";
  const visible = options.filter((item) => `${item.title} ${item.hint} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const activeId = visible.some((item) => item.id === active) ? active : visible[0]?.id;
  const close = () => { menu.setOpen(false); setQuery(""); };
  function choose(id: string) {
    const item = themes.find((item) => `${item.pluginId}:${item.id}` === id);
    if (id === "system") theme.followSystem();
    else theme.select(item?.base ?? (id === "light" ? "light" : "dark"));
    selectPluginTheme(item ? id : ""); close();
  }
  function move(delta: number) {
    const index = visible.findIndex((item) => item.id === activeId);
    setActive(visible[(index + delta + visible.length) % visible.length]?.id ?? "");
  }
  return { ...menu, query, setQuery, activeId, setActive, selected, visible, options, choose, close, move };
}
type Picker = ReturnType<typeof useThemePicker>;

export function ThemePicker() {
  const picker = useThemePicker(), trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (picker.open) input.current?.focus(); }, [picker.open]);
  return <div className="pi-plugins plugin-theme-row">
    <div><h2>主题</h2><p>选择应用外观，也可以使用插件提供的主题。</p></div>
    <div className="settings-theme-anchor" ref={picker.ref} onKeyDown={(event) => {
      if (event.key === "Escape" && picker.open) { event.stopPropagation(); picker.close(); trigger.current?.focus(); }
    }}>
      <button ref={trigger} type="button" className="settings-theme-trigger" aria-label="主题" aria-haspopup="listbox" aria-expanded={picker.open}
        onClick={() => { picker.setQuery(""); picker.setActive(picker.selected); picker.setOpen(!picker.open); }}>
        <span className="settings-theme-trigger-label">{picker.options.find((item) => item.id === picker.selected)?.title}</span><ChevronDown size={14} />
      </button>
      {picker.open ? <div className={`settings-theme-menu is-open${picker.up ? " is-up" : ""}`}>
        <div className="settings-theme-search"><Search size={13} /><input ref={input} type="text" role="combobox" aria-label="搜索主题" aria-controls="plugin-theme-options"
          aria-expanded aria-activedescendant={picker.activeId ? `theme-${picker.activeId}` : undefined} placeholder="搜索主题…" value={picker.query}
          onChange={(event) => picker.setQuery(event.target.value)} onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); picker.move(event.key === "ArrowDown" ? 1 : -1); }
            if (event.key === "Enter" && picker.activeId) { event.preventDefault(); picker.choose(picker.activeId); trigger.current?.focus(); }
          }} /></div>
        <ThemeOptions picker={picker} />
      </div> : null}
    </div>
  </div>;
}

function ThemeOptions({ picker }: { picker: Picker }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => { ref.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" }); }, [picker.activeId]);
  return <div className="settings-theme-results"><ul ref={ref} id="plugin-theme-options" className="settings-theme-list" role="listbox" aria-label="主题选项">
    {!picker.visible.length ? <li className="settings-theme-empty">没有匹配的主题</li> : null}
    {picker.visible.map((option, index) => <li key={option.id}>
      <button type="button" id={`theme-${option.id}`} role="option" tabIndex={-1} aria-selected={option.id === picker.selected}
        className={`settings-theme-option${option.id === picker.activeId ? " is-active" : ""}${option.id === picker.selected ? " is-current" : ""}`}
        onMouseEnter={() => picker.setActive(option.id)} onClick={() => picker.choose(option.id)}>
        <span className="settings-theme-option-copy"><span className="settings-theme-option-title">{option.title}</span><span className="settings-theme-option-hint">{option.hint}</span></span>
        {option.id === picker.selected ? <Check size={14} className="settings-theme-check" /> : null}
      </button>
      {!option.plugin && picker.visible[index + 1]?.plugin ? <span className="settings-theme-divider" /> : null}
    </li>)}
  </ul></div>;
}

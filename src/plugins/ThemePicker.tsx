import { localized, t, useTranslation } from "../i18n";
// Adapted from PI-Desktop ThemeRow.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useTheme } from "../theme/ThemeProvider";
import { selectPluginTheme, usePluginTheme } from "./pluginTheme";
import { usePluginRuntime } from "./usePluginRuntime";
import { usePopover } from "./center/usePopover";
import { composingKey } from "../utils/keyboard";
import "./theme-picker.css";

interface Option { id: string; title: string; hint: string; plugin?: boolean }
const BUILTINS: Option[] = localized(() => ([
  { id: "system", title: t("plugins.ThemePicker.text_217cfe7db1"), hint: t("plugins.ThemePicker.text_7547141efe") },
  { id: "light", title: t("plugins.ThemePicker.text_aa0819dfc4"), hint: t("plugins.ThemePicker.text_3e3d46c528") },
  { id: "dark", title: t("plugins.ThemePicker.text_a6b75d0680"), hint: t("plugins.ThemePicker.text_e082b3d947") },
]));
function useThemePicker() {
  useTranslation();
  const theme = useTheme(), selectedPlugin = usePluginTheme(), { themes } = usePluginRuntime();
  const menu = usePopover(340), [query, setQuery] = useState(""), [active, setActive] = useState("");
  const options = [...BUILTINS, ...themes.map((item) => ({ id: `${item.pluginId}:${item.id}`, title: item.label, hint: t("plugins.ThemePicker.text_bba9eb1dea", { pluginId: item.pluginId }), plugin: true }))];
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
  useTranslation();
  const picker = useThemePicker(), trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (picker.open) input.current?.focus(); }, [picker.open]);
  return <div className="pi-plugins plugin-theme-row">
    <div><h3>{t("plugins.ThemePicker.text_788db1cfec")}</h3><p>{t("plugins.ThemePicker.text_051eaf59d0")}</p></div>
    <div className="settings-theme-anchor" ref={picker.ref} onKeyDown={(event) => {
      if (event.key === "Escape" && !composingKey(event.nativeEvent) && picker.open) { event.stopPropagation(); picker.close(); trigger.current?.focus(); }
    }}>
      <button ref={trigger} type="button" className="settings-theme-trigger" aria-label={t("plugins.ThemePicker.text_788db1cfec")} aria-haspopup="listbox" aria-expanded={picker.open}
        onClick={() => { picker.setQuery(""); picker.setActive(picker.selected); picker.setOpen(!picker.open); }}>
        <span className="settings-theme-trigger-label">{picker.options.find((item) => item.id === picker.selected)?.title}</span><ChevronDown size={14} />
      </button>
      {picker.open ? <div className={`settings-theme-menu is-open${picker.up ? " is-up" : ""}`}>
        <div className="settings-theme-search"><Search size={13} /><input ref={input} type="text" role="combobox" aria-label={t("plugins.ThemePicker.text_7be6f5e53f")} aria-controls="plugin-theme-options"
          aria-expanded aria-activedescendant={picker.activeId ? `theme-${picker.activeId}` : undefined} placeholder={t("plugins.ThemePicker.text_465492abb5")} value={picker.query}
          onChange={(event) => picker.setQuery(event.target.value)} onKeyDown={(event) => {
            if (composingKey(event.nativeEvent)) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); picker.move(event.key === "ArrowDown" ? 1 : -1); }
            if (event.key === "Enter" && picker.activeId) { event.preventDefault(); picker.choose(picker.activeId); trigger.current?.focus(); }
          }} /></div>
        <ThemeOptions picker={picker} />
      </div> : null}
    </div>
  </div>;
}

function ThemeOptions({ picker }: { picker: Picker }) {
  useTranslation();
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => { ref.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" }); }, [picker.activeId]);
  return <div className="settings-theme-results"><ul ref={ref} id="plugin-theme-options" className="settings-theme-list" role="listbox" aria-label={t("plugins.ThemePicker.text_b979760c82")}>
    {!picker.visible.length ? <li className="settings-theme-empty">{t("plugins.ThemePicker.text_21e4394a7a")}</li> : null}
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

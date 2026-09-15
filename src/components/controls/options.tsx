import { Check, Search } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { findOption, moveOption } from "./controlModel";

export interface SelectOption<T> { value: T; label: string; description?: string; disabled?: boolean }
interface NavigationProps<T> { options: readonly SelectOption<T>[]; selected: number; open: boolean; setOpen: (open: boolean) => void; onChoose: (index: number) => void; autoHighlight?: boolean }

export function useOptionNavigation<T>(props: NavigationProps<T>) {
  const { options, selected, open, setOpen, onChoose } = props;
  const start = selected >= 0 && !options[selected]?.disabled ? selected : props.autoHighlight === false ? -1 : moveOption(options, -1, 1);
  const [active, setActive] = useState(start);
  const typing = useRef({ text: "", at: 0 });
  const signature = JSON.stringify(options.map((option) => [option.value, option.disabled]));
  useEffect(() => setActive(start), [signature, start]);
  const keydown = (event: KeyboardEvent, editable = false) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey) return;
    const direction = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (direction) { event.preventDefault(); setActive(open ? moveOption(options, active, direction) : start >= 0 ? start : moveOption(options, -1, direction)); setOpen(true); return; }
    if (!editable && (event.key === "Home" || event.key === "End")) {
      event.preventDefault(); setOpen(true); setActive(moveOption(options, -1, event.key === "Home" ? 1 : -1)); return;
    }
    if (event.key === "Enter" || (!editable && event.key === " ")) {
      if (open && active >= 0) { event.preventDefault(); onChoose(active); }
      else if (!editable) { event.preventDefault(); setActive(start); setOpen(true); }
      return;
    }
    if (event.key === "Tab") return setOpen(false);
    if (!editable && event.key.length === 1 && !event.altKey) {
      event.preventDefault();
      const now = Date.now(), prefix = now - typing.current.at < 700 ? typing.current.text : "";
      typing.current = { text: prefix + event.key, at: now };
      const found = findOption(options, typing.current.text, active);
      if (found >= 0) setActive(found);
      setOpen(true);
    }
  };
  return { active, setActive, keydown, reset: () => { typing.current = { text: "", at: 0 }; setActive(start); } };
}

export function OptionList<T>({ options, selected, active, id, label, onChoose, onActive }: {
  options: readonly SelectOption<T>[]; selected: number; active: number; id: string; label: string;
  onChoose: (index: number) => void; onActive: (index: number) => void;
}) {
  useEffect(() => { document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, id]);
  return <div id={id} className="ui-options" role="listbox" aria-label={label}>
    {options.map((option, index) => <button key={String(option.value)} id={`${id}-option-${index}`} type="button"
      role="option" tabIndex={-1} aria-selected={selected === index} disabled={option.disabled} aria-disabled={option.disabled || undefined}
      title={option.description ? `${option.label} · ${option.description}` : option.label} className={`ui-option${active === index ? " is-active" : ""}`}
      onMouseDown={(event) => event.preventDefault()} onMouseMove={() => { if (!option.disabled) onActive(index); }}
      onClick={() => { if (!option.disabled) onChoose(index); }}>
      <span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
      {selected === index ? <Check size={14} aria-hidden="true" /> : null}
    </button>)}
    {!options.length ? <p className="ui-popover__empty">没有匹配的选项</p> : null}
  </div>;
}

export function OptionSearch({ value, onChange, onKeyDown, label, listId, active }: {
  value: string; onChange: (value: string) => void; onKeyDown: (event: KeyboardEvent) => void;
  label: string; listId: string; active: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  return <div className="ui-popover__search"><Search size={14} aria-hidden="true" />
    <input ref={ref} value={value} placeholder="搜索选项…" aria-label={`${label}：搜索选项`} role="combobox"
      aria-expanded="true" aria-autocomplete="list" aria-controls={listId}
      aria-activedescendant={active >= 0 ? `${listId}-option-${active}` : undefined}
      onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} />
  </div>;
}

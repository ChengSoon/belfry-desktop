import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { ControlPopover } from "./ControlPopover";
import { matchesOption } from "./controlModel";
import { OptionList, OptionSearch, useOptionNavigation, type SelectOption } from "./options";
import { useControlPopover } from "./useControlPopover";

export type { SelectOption } from "./options";
export interface SelectProps<T> {
  options: readonly SelectOption<T>[]; value: T; onChange: (value: T) => void;
  disabled?: boolean; className?: string; ariaLabel: string; id?: string;
  placeholder?: string; searchable?: boolean; initialOpen?: boolean;
}

export function Select<T extends string | number>(props: SelectProps<T>) {
  const { options, value, onChange, disabled, ariaLabel, id, className = "", initialOpen } = props;
  const popup = useControlPopover(initialOpen);
  const [query, setQuery] = useState("");
  const filtered = options.filter((option) => matchesOption(option, query));
  const selected = options.find((option) => Object.is(option.value, value));
  const selectedIndex = filtered.findIndex((option) => Object.is(option.value, value));
  const choose = (index: number) => {
    const option = filtered[index];
    if (disabled || !option || option.disabled) return;
    onChange(option.value); popup.close(true);
  };
  const nav = useOptionNavigation({ options: filtered, selected: selectedIndex, open: popup.open, setOpen: popup.setOpen, onChoose: choose });
  useEffect(() => { if (!popup.open) setQuery(""); if (disabled) popup.close(); }, [disabled, popup.open, popup.close]);
  const search = props.searchable ?? options.length > 8;
  return <div className={`ui-control ui-select ${className}`} ref={popup.root} onBlur={popup.onBlur}>
    <button ref={popup.trigger} id={id} type="button" role="combobox" className="ui-field ui-select__trigger"
      disabled={disabled || !options.length} aria-label={ariaLabel} aria-expanded={popup.open} aria-haspopup="listbox"
      aria-controls={popup.open ? popup.id : undefined}
      aria-activedescendant={popup.open && nav.active >= 0 ? `${popup.id}-option-${nav.active}` : undefined}
      title={selected?.description ?? selected?.label} onClick={() => { nav.reset(); setQuery(""); popup.toggle(); }} onKeyDown={(event) => nav.keydown(event)}>
      <span className={`ui-select__value${!selected ? " ui-select__placeholder" : ""}`}>{selected?.label ?? props.placeholder ?? "请选择"}</span>
      <ChevronDown className="ui-select__caret" size={14} aria-hidden="true" />
    </button>
    <ControlPopover control={popup}>
      {search ? <OptionSearch value={query} onChange={setQuery} label={ariaLabel} listId={popup.id} active={nav.active}
        onKeyDown={(event) => { if (!popup.onTab(event)) nav.keydown(event, true); }} /> : null}
      <OptionList options={filtered} selected={selectedIndex} active={nav.active} id={popup.id} label={ariaLabel}
        onChoose={choose} onActive={nav.setActive} />
    </ControlPopover>
  </div>;
}

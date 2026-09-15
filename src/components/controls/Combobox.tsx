import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { ControlPopover } from "./ControlPopover";
import { matchesOption } from "./controlModel";
import { OptionList, useOptionNavigation, type SelectOption } from "./options";
import { useControlPopover } from "./useControlPopover";
import { ownsTarget } from "./layerOwnership";

interface Props {
  value: string; options: readonly SelectOption<string>[]; onChange: (value: string) => void;
  ariaLabel: string; disabled?: boolean; required?: boolean; maxLength?: number;
  placeholder?: string; onCommit?: () => void; onSelect?: (value: string) => void;
  selectedValue?: string; openOnFocus?: boolean;
}

/** 自由输入与建议选项共存，确认前不会用高亮建议覆盖输入草稿。 */
export function Combobox(props: Props) {
  const { value, options, onChange, ariaLabel, disabled } = props;
  const popup = useControlPopover<HTMLInputElement>();
  const [filtering, setFiltering] = useState(false);
  const filtered = filtering ? options.filter((option) => matchesOption(option, value)) : options;
  const selected = filtered.findIndex((option) => option.value === (props.selectedValue ?? value));
  const choose = (index: number) => {
    const option = filtered[index];
    if (!option || option.disabled || disabled) return;
    (props.onSelect ?? onChange)(option.value); setFiltering(false); popup.close(true);
  };
  const nav = useOptionNavigation({ options: filtered, selected, open: popup.open, setOpen: popup.setOpen, onChoose: choose, autoHighlight: false });
  useEffect(() => { if (disabled) popup.close(); }, [disabled, popup.close]);
  return <div ref={popup.root} className="ui-control ui-combobox" onBlur={(event) => {
    popup.onBlur(event);
    if (!ownsTarget(popup.root.current, event.relatedTarget as Node | null)) props.onCommit?.();
  }}>
    <div className="ui-field"><input ref={popup.trigger} value={value} type="text" role="combobox" aria-label={ariaLabel}
      aria-required={props.required || undefined} aria-expanded={popup.open} aria-controls={popup.open ? popup.id : undefined}
      aria-autocomplete="list" aria-activedescendant={popup.open && nav.active >= 0 ? `${popup.id}-option-${nav.active}` : undefined}
      disabled={disabled} maxLength={props.maxLength} placeholder={props.placeholder} autoComplete="off" spellCheck={false}
      onChange={(event) => { onChange(event.target.value); setFiltering(true); popup.setOpen(true); nav.setActive(-1); }}
      onFocus={() => { if (props.openOnFocus) { setFiltering(false); popup.setOpen(true); } }}
      onKeyDown={(event) => nav.keydown(event, true)} />
      <button type="button" className="ui-field__icon" aria-label={`${ariaLabel}：显示建议`} tabIndex={-1} disabled={disabled}
        onMouseDown={(event) => event.preventDefault()} onClick={() => { popup.trigger.current?.focus(); setFiltering(false); nav.reset(); popup.toggle(); }}>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
    </div>
    <ControlPopover control={popup}><OptionList options={filtered} selected={selected} active={nav.active} id={popup.id}
      label={`${ariaLabel}建议`} onChoose={choose} onActive={nav.setActive} /></ControlPopover>
  </div>;
}

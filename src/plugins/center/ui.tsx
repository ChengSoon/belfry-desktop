// Adapted from PI-Desktop (vastsa), commit 4fb58d3. LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconChevronDown } from "./icons";
import { useDropdown } from "./useDropdown";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  /* React 19 passes ref as a plain prop; an anchored menu needs the element. */
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      className={cx(
        "btn",
        variant === "primary" && "btn-primary",
        variant === "secondary" && "btn-secondary",
        variant === "ghost" && "btn-ghost",
        size === "sm" && "px-2.5 py-1 text-xs",
        className,
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  spellCheck = false,
  autoCorrect = "off",
  autoCapitalize = "off",
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      className={cx("field-input", className)}
      spellCheck={spellCheck}
      autoCorrect={autoCorrect}
      autoCapitalize={autoCapitalize}
      {...props}
    />
  );
}

export function Textarea({ className, spellCheck = false, autoCorrect = "off", autoCapitalize = "off", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx("field-textarea", className)}
      spellCheck={spellCheck}
      autoCorrect={autoCorrect}
      autoCapitalize={autoCapitalize}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx("field-select", className)} {...props} />;
}

export interface SelectOption<T> { value: T; label: string }

// 沿用插件菜单样式；浮层挂到页面顶层，避免被滚动设置面板裁剪。
export function Dropdown<T extends string | number>({ options, value, onChange, disabled, className, ariaLabel, initialOpen }: {
  options: Array<SelectOption<T>>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  /** 允许独立预览直接展开菜单。 */
  initialOpen?: boolean;
}) {
  const selected = options.findIndex((option) => Object.is(option.value, value));
  const menu = useDropdown({ count: options.length, selected, disabled, initialOpen,
    select: (index) => onChange(options[index].value) });
  return <div className="plugins-menu-wrap plugins-dropdown-wrap" ref={menu.ref}>
    <button type="button" role="combobox" className={cx("field-select", "plugins-dropdown", className)} disabled={disabled || !options.length}
      aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={menu.open} aria-controls={menu.id}
      aria-activedescendant={menu.open ? `${menu.id}-${menu.active}` : undefined}
      onClick={menu.toggle} onKeyDown={menu.keydown} onBlur={menu.close}>
      <span className="plugins-dropdown-value">{options[selected]?.label ?? ""}</span>
      <IconChevronDown size={14} className="plugins-dropdown-caret" aria-hidden />
    </button>
    {menu.open ? createPortal(<div className="pi-plugins plugins-dropdown-layer">
      <div ref={menu.setList} id={menu.id} className="plugins-menu plugins-dropdown-menu" style={menu.style} role="listbox" aria-label={ariaLabel}>
      {options.map((option, index) => <button key={index} id={`${menu.id}-${index}`} data-index={index} type="button" role="option" tabIndex={-1} aria-selected={index === selected}
        className={cx("plugins-dropdown-option", index === selected && "is-selected", index === menu.active && "is-active")}
        onMouseDown={(event) => event.preventDefault()} onMouseMove={() => menu.setActive(index)} onClick={() => menu.choose(index)}>
        <span className="plugins-dropdown-label">{option.label}</span>
        {index === selected ? <IconCheck size={14} /> : null}</button>)}
    </div></div>, document.body) : null}
  </div>;
}

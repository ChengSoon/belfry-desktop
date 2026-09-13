// Adapted from PI-Desktop (vastsa), commit 4fb58d3. LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import type { ButtonHTMLAttributes, InputHTMLAttributes, Ref, TextareaHTMLAttributes } from "react";
import { Select as ControlSelect, type SelectProps } from "../../components/controls/Select";
export { Select } from "../../components/controls/Select";
export type { SelectOption } from "../../components/controls/Select";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ref,
  onClick,
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
      onClick={(event) => {
        // WebKit 鼠标点击按钮不会自动聚焦，先保留弹窗关闭后的返回位置。
        event.currentTarget.focus({ preventScroll: true });
        onClick?.(event);
      }}
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

/** 插件中心复用应用的下拉控件，保持历史调用方的 props。 */
export function Dropdown<T extends string | number>(props: Omit<SelectProps<T>, "ariaLabel"> & { ariaLabel?: string }) {
  return <ControlSelect {...props} ariaLabel={props.ariaLabel ?? "选择选项"}
    className={cx("plugins-dropdown-wrap", props.className)} />;
}

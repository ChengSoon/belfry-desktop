import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./kit.css";

/** 设置分区还原件（T42）：与 settings-v3 汇总稿一一对应的最小原语。 */
export const SPage = ({ children, label }: { children: ReactNode; label: string }) =>
  <section aria-label={label} className="sk-page">{children}</section>;

export const SGroupTitle = ({ children, tail }: { children: ReactNode; tail?: ReactNode }) => tail
  ? <div className="sk-gt-row"><h3 className="sk-gt">{children}</h3><div className="sk-gt-tail">{tail}</div></div>
  : <h3 className="sk-gt">{children}</h3>;

export const SList = ({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) =>
  <div aria-label={label} className={`sk-list ${className}`.trim()} role={label ? "group" : undefined}>{children}</div>;

export function SItem({ title, hint, lead, children, className = "", id }: {
  title: ReactNode; hint?: ReactNode; lead?: ReactNode; children?: ReactNode; className?: string; id?: string;
}) {
  return <div className={`sk-item ${className}`.trim()}>
    {lead}
    <div className="sk-l"><b id={id}>{title}</b>{hint ? <span>{hint}</span> : null}</div>
    {children ? <div className="sk-r">{children}</div> : null}
  </div>;
}

type Tone = "primary" | "secondary" | "ghost" | "danger";
export const SButton = ({ tone = "ghost", icon = false, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; icon?: boolean }) =>
  <button type="button" {...props} className={`sk-btn${tone === "ghost" ? "" : ` is-${tone}`}${icon ? " is-icon" : ""} ${className}`.trim()} />;

export const STag = ({ tone, dot = false, children }: { tone?: "accent" | "ok" | "warn" | "danger"; dot?: boolean; children: ReactNode }) =>
  <span className={`sk-tag${tone ? ` is-${tone}` : ""}`}>{dot ? <i aria-hidden="true" /> : null}{children}</span>;

export const SSwitch = ({ checked, onChange, labelledBy, label, disabled }: {
  checked: boolean; onChange: (next: boolean) => void; labelledBy?: string; label?: string; disabled?: boolean;
}) => <button aria-checked={checked} aria-label={label} aria-labelledby={labelledBy} className="sk-switch" disabled={disabled}
  onClick={() => onChange(!checked)} role="switch" type="button" />;

export function SSegment<T extends string>({ value, options, onChange, label, disabled }: {
  value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; label: string; disabled?: boolean;
}) {
  return <div aria-label={label} className="sk-seg" role="group">
    {options.map((option) => <button aria-pressed={option.value === value} disabled={disabled} key={option.value}
      onClick={() => onChange(option.value)} type="button">{option.label}</button>)}
  </div>;
}

export const SKeys = ({ keys }: { keys: readonly string[] }) => <>{keys.map((key, index) => <kbd className="sk-kbd" key={`${key}-${index}`}>{key}</kbd>)}</>;

import { Check } from "lucide-react";
import type { ReactNode } from "react";
import "./controls.css";

interface Props {
  checked: boolean; onChange?: (checked: boolean) => void; disabled?: boolean; readOnly?: boolean;
  children?: ReactNode; ariaLabel?: string; className?: string;
}

export function Checkbox({ checked, onChange, disabled, readOnly, children, ariaLabel, className = "" }: Props) {
  const content = <><span className="ui-checkbox__mark" aria-hidden="true">{checked ? <Check size={12} strokeWidth={2.5} /> : null}</span>{children}</>;
  const props = { role: "checkbox", "aria-checked": checked, "aria-label": ariaLabel, className: `ui-control ui-checkbox ${className}` } as const;
  return readOnly ? <span {...props} aria-disabled="true">{content}</span>
    : <button {...props} type="button" disabled={disabled} onClick={() => onChange?.(!checked)}>{content}</button>;
}

import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import "./controls.css";

export function Disclosure({ title, children, defaultOpen = false, className = "", ariaLabel, triggerClassName = "" }: {
  title: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string; ariaLabel?: string; triggerClassName?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return <div className={`ui-disclosure ${className}`} data-open={open}>
    <button type="button" className={`ui-disclosure__trigger ${triggerClassName}`} aria-label={ariaLabel}
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <ChevronRight className="ui-disclosure__chevron" size={13} aria-hidden="true" />
      <span className="ui-disclosure__label">{title}</span>
    </button>
    <div id={id} className="ui-disclosure__content" hidden={!open}>{children}</div>
  </div>;
}

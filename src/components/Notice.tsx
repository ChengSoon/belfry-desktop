import { AlertTriangle, Info } from "lucide-react";
import type { ReactNode } from "react";
import { ICON } from "../theme/sizing";
import "./notice.css";

interface Props {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  tone?: "danger" | "warning" | "neutral" | "info";
  role?: "alert" | "status";
}

export function Notice({ children, action, className = "", tone = "danger", role }: Props) {
  const Icon = tone === "neutral" || tone === "info" ? Info : AlertTriangle;
  return <div className={`ui-notice ui-notice--${tone} ${className}`.trim()}
    role={role ?? (tone === "danger" ? "alert" : "status")}>
    <Icon size={ICON.sm} aria-hidden="true" />
    <div className="ui-notice__message">{children}</div>
    {action ? <div className="ui-notice__actions">{action}</div> : null}
  </div>;
}

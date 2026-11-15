import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";

export function A2AButton({ tone = "secondary", icon = false, className = "", type = "button", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "secondary" | "danger"; icon?: boolean }) {
  return <button {...props} type={type} className={`a2a-button a2a-button--${tone}${icon ? " a2a-button--icon" : ""} ${className}`} />;
}

/** Quiet status text with a dot, matching the member rows in rooms. */
export function A2AStatus({ state = "neutral", className = "", ...props }:
  HTMLAttributes<HTMLSpanElement> & { state?: "neutral" | "ok" | "warn" }) {
  return <span {...props} className={`a2a-status a2a-status--${state} ${className}`} />;
}

/** A stable hue per agent name, matching the room avatar formula. */
export function a2aNodeHue(name: string) {
  let hue = 0;
  for (const char of name) hue = (hue * 31 + (char.codePointAt(0) ?? 0)) % 360;
  return hue;
}

export function a2aNodeInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0]);
  if (words.length > 1) return (first[0] + Array.from(words[1])[0]).toUpperCase();
  return /^[A-Za-z]/.test(first[0]) ? first.slice(0, 2).join("").toUpperCase() : first[0];
}

/** Circular, flat-tinted avatar used by the map and the connection rows. */
export function NodeAvatar({ name, size = "md", state = "idle", ghost = false, children }: {
  name: string; size?: "sm" | "md" | "lg"; state?: "ready" | "warn" | "idle"; ghost?: boolean; children?: ReactNode;
}) {
  return <span className={`a2a-avatar a2a-avatar--${size}`} data-state={state} data-ghost={ghost ? "" : undefined}
    style={{ "--node-hue": a2aNodeHue(name) } as CSSProperties} aria-hidden="true">
    {children ?? a2aNodeInitials(name)}
  </span>;
}

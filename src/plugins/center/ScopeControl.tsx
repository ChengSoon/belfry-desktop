// Adapted from PI-Desktop ScopeControl.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { useState } from "react";
import { activationState, resolveScope, type ActivationState } from "./activation";
import { IconCheck, IconChevronDown, IconFolder, IconGlobe, IconPower } from "./icons";
import { cx } from "./ui";
import { usePopover } from "./usePopover";
import { t } from "./i18n";
import { usePluginsPage } from "./context";
import { ScopeProjects } from "./ScopeProjects";
import type { PluginSummary } from "./types";

const STATES: ActivationState[] = ["off", "projects", "global"];
export function ScopeControl({ plugin }: { plugin: PluginSummary }) {
  const { actions, currentProjectPath } = usePluginsPage();
  const menu = usePopover(), [picking, setPicking] = useState(false);
  const state = activationState(plugin), scope = resolveScope(plugin.scope);
  const label = state === "projects" && scope.projects.length ? t("extensions.scope.projectCount", { count: scope.projects.length }) : t(`extensions.scope.${state}`);
  const select = async (next: ActivationState) => {
    menu.setOpen(false);
    if (next === "off") { setPicking(false); await actions.run(() => actions.mutate(plugin.id, "disable")); return; }
    const projects = scope.projects.length || !currentProjectPath ? scope.projects : [currentProjectPath];
    const saved = await actions.setScope(plugin, { mode: next, projects });
    if (saved) setPicking(next === "projects");
  };
  return <div className="scope-control is-compact"><div className="scope-compact-wrap" ref={menu.ref}>
    <button type="button" className={cx("scope-compact-trigger", `is-${state}`)}
      aria-label={`${t("extensions.scope.ariaLabel", { name: plugin.name })}: ${label}`} aria-haspopup={picking ? "dialog" : "menu"}
      aria-expanded={menu.open || picking} title={t(`extensions.scope.${state}Hint`)} disabled={actions.busy}
      onClick={() => picking ? setPicking(false) : menu.setOpen(!menu.open)}>
      <StateIcon state={state} /><span className="scope-compact-label">{label}</span><IconChevronDown className="scope-compact-chevron" size={12} />
    </button>
    {menu.open ? <div className={cx("scope-compact-menu", menu.up && "is-up")} role="menu" aria-label={t("extensions.scope.ariaLabel", { name: plugin.name })}>
      {STATES.map((option) => <button key={option} type="button" role="menuitemradio" aria-checked={state === option}
        className={cx("scope-compact-option", state === option && "is-active")} disabled={actions.busy} onClick={() => void select(option)}>
        <StateIcon state={option} /><span className="scope-compact-option-copy"><span className="scope-compact-option-label">{t(`extensions.scope.${option}`)}</span>
          <span className="scope-compact-option-hint">{t(`extensions.scope.${option}Hint`)}</span></span>{state === option ? <IconCheck size={13} /> : null}
      </button>)}
    </div> : null}
    {picking ? <ScopeProjects plugin={plugin} onClose={() => setPicking(false)} /> : null}
  </div></div>;
}
function StateIcon({ state }: { state: ActivationState }) {
  return state === "off" ? <IconPower size={13} /> : state === "projects" ? <IconFolder size={13} /> : <IconGlobe size={13} />;
}

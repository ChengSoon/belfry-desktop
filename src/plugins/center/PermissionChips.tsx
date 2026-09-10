// Adapted from PI-Desktop PluginsPage.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { CAPABILITY_ORDER, FS_MODES, orderPermissions, permissionRisk, RISK_LABEL_KEYS } from "./helpers";
import type { PluginCapability, PluginFsPolicy, PluginServiceStatus } from "./types";
import { cx } from "./ui";
import { t } from "./i18n";

export function PermissionChips({ permissions, limit = 3 }: { permissions?: readonly string[]; limit?: number }) {
  const ordered = orderPermissions(permissions), shown = ordered.slice(0, limit), hidden = ordered.length - shown.length;
  if (!ordered.length) return <span className="plugins-perm-none">{t("plugins.noPermissions")}</span>;
  return <span className="plugins-perm-chips">
    {shown.map((permission) => <span key={permission} className={cx("plugins-perm-chip", `risk-${permissionRisk(permission)}`)}
      title={t(`plugins.permissionHelp.${permission}`, { defaultValue: permission })}>{permissionLabel(permission)}</span>)}
    {hidden > 0 ? <span className="plugins-perm-chip is-more" title={ordered.slice(limit).map(permissionLabel).join(" · ")}>{t("plugins.permsMore", { count: hidden })}</span> : null}
  </span>;
}
export function permissionLabel(key: string) { return t(`plugins.permissions.${key}`, { defaultValue: key }); }
export function CapabilityChips({ capabilities }: { capabilities?: readonly PluginCapability[] }) {
  return <span className="plugins-cap-chips">{CAPABILITY_ORDER.filter((cap) => capabilities?.includes(cap)).map((cap) =>
    <span key={cap} className="plugins-cap-chip">{t(`plugins.capabilities.${cap}`, { defaultValue: cap === "views" ? "工作面板" : cap })}</span>)}</span>;
}
export function FsScopeChips({ policy }: { policy?: PluginFsPolicy }) {
  const chips = FS_MODES.flatMap((mode) => {
    const rule = policy?.[mode]; if (!rule) return [];
    const parts = [rule.root === "userSelected" ? t("plugins.fsRootPicked") : "", rule.scope?.join(" · "), rule.own ? t("plugins.fsOwnFiles") : ""].filter(Boolean);
    return [{ mode, text: `${t(`plugins.fsMode.${mode}`)} · ${parts.length ? parts.join(" · ") : t("plugins.fsAsksEachTime")}` }];
  });
  return <span className="plugins-perm-chips">{chips.map((chip) => <span key={chip.mode}
    className={cx("plugins-perm-chip", `risk-${permissionRisk(`fs.${chip.mode}`)}`)} title={chip.text}>{chip.text}</span>)}</span>;
}
export function ServiceChips({ statuses }: { statuses: PluginServiceStatus[] }) {
  return <span className="plugins-service-chips">{statuses.map((status) =>
    <span key={status.serviceId} className={cx("plugins-service-chip", `is-${status.state}`)} title={status.message}>
      <span className="plugins-service-dot" aria-hidden /><span className="plugins-service-name">{status.label}</span>
      <span className="plugins-service-state">{t(`plugins.serviceState.${status.state}`)}</span>
      {status.restarts > 0 ? <span className="plugins-service-restarts">{t("plugins.serviceRestarts", { count: status.restarts })}</span> : null}
    </span>)}</span>;
}
export function PermissionList({ permissions, added = [], plain = false }: { permissions: string[]; added?: string[]; plain?: boolean }) {
  return <ul className={cx("plugins-perm-list", plain && "is-plain")}>{permissions.map((permission) => {
    const risk = permissionRisk(permission);
    return <li key={permission} className={`risk-${risk}`}>
      {!plain ? <span className="plugins-perm-risk">{t(RISK_LABEL_KEYS[risk])}</span> : null}
      <span className="plugins-perm-copy"><strong>{permissionLabel(permission)}
        {added.includes(permission) ? <span className="plugins-tag is-update">{t("plugins.newPermission")}</span> : null}</strong>
        <span>{t(`plugins.permissionHelp.${permission}`, { defaultValue: permission })}</span></span>
    </li>;
  })}</ul>;
}

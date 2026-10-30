import { Check, ChevronRight, Plus, RefreshCcw, Server, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ICON } from "../../theme/sizing";
import type { SshLaunch } from "../../terminal/contracts";
import {
  shellProfileLabel,
  type ShellProfile,
  type ShellProfileId,
} from "../../terminal/contracts";
import type { AgentAvailability, WorkspaceTabKind } from "../contracts";
import { useDismiss } from "../useDismiss";
import { ClaudeIcon, CodexIcon, PiIcon } from "./AgentIcons";
import { SshDialog } from "./SshDialog";
import { composingKey } from "../../utils/keyboard";

interface NewSessionMenuProps {
  agents: AgentAvailability[];
  shellProfiles: ShellProfile[];
  onLaunch: (kind: WorkspaceTabKind, profileId?: ShellProfileId) => void;
  onLaunchSsh: (target: SshLaunch) => void;
  onRefresh: () => Promise<void>;
  shellShortcut: string;
}

export function NewSessionMenu({
  agents,
  shellProfiles,
  onLaunch,
  onLaunchSsh,
  onRefresh,
  shellShortcut,
}: NewSessionMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const [sshDialogOpen, setSshDialogOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshingRef = useRef(false);
  const mounted = useRef(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const shellRef = useRef<HTMLButtonElement>(null);
  const firstFocus = useRef("first");
  const menuId = useId();
  const closeMenu = useCallback(() => {
    if (triggerRef.current?.parentElement?.querySelector('[role="menu"]')?.contains(document.activeElement)) {
      triggerRef.current.focus({ preventScroll: true });
    }
    setMenuOpen(false);
    setShellMenuOpen(false);
  }, []);
  const menuRef = useDismiss<HTMLDivElement>(menuOpen, closeMenu);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    (firstFocus.current === "last" ? items?.[items.length - 1] : items?.[0])?.focus({ preventScroll: true });
    firstFocus.current = "first";
  }, [menuOpen, menuRef]);
  useLayoutEffect(() => {
    if (shellMenuOpen) menuRef.current?.querySelector<HTMLButtonElement>('.popover-menu__submenu button:not(:disabled)')?.focus();
  }, [shellMenuOpen, menuRef]);

  const refresh = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setRefreshError(null);
    try { await onRefresh(); }
    catch (error) {
      if (mounted.current) setRefreshError(error instanceof Error ? error.message : "检测失败，请重试");
    } finally {
      refreshingRef.current = false;
      if (mounted.current) setRefreshing(false);
    }
  };

  const menuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (composingKey(event.nativeEvent)) return;
    if (event.key === "Escape" || (event.key === "ArrowLeft" && shellMenuOpen)) {
      event.preventDefault();
      event.stopPropagation();
      if (shellMenuOpen) { setShellMenuOpen(false); shellRef.current?.focus(); }
      else closeMenu();
      return;
    }
    if (event.key === "ArrowRight" && event.target === shellRef.current) {
      event.preventDefault(); setShellMenuOpen(true); return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  };

  const start = (kind: WorkspaceTabKind, profileId?: ShellProfileId) => {
    closeMenu();
    onLaunch(kind, profileId);
  };

  const connectSsh = (target: SshLaunch) => {
    setSshDialogOpen(false);
    onLaunchSsh(target);
  };

  const cancelSsh = () => {
    setSshDialogOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <>
      <div className="popover-host" ref={menuRef} onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) closeMenu();
      }}>
        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-controls={menuOpen ? menuId : undefined}
          className="icon-button icon-button--sm"
          onClick={() => { if (menuOpen) closeMenu(); else setMenuOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              firstFocus.current = event.key === "ArrowUp" ? "last" : "first";
              setMenuOpen(true);
            }
          }}
          ref={triggerRef}
          title={`新建会话（Shell ${shellShortcut}）`}
          type="button"
        >
          <Plus aria-hidden="true" size={ICON.md} />
        </button>

        {menuOpen ? (
          <div className="popover popover--menu new-session-menu" id={menuId} role="menu" aria-label="新建会话" onKeyDown={menuKey}>
            <button
              aria-expanded={shellMenuOpen}
              aria-controls={shellMenuOpen ? `${menuId}-shell` : undefined}
              onClick={() => setShellMenuOpen((value) => !value)}
              ref={shellRef}
              role="menuitem"
              type="button"
            >
              <SquareTerminal aria-hidden="true" size={ICON.md} />
              <span>Shell</span>
              <i>{shellShortcut}</i>
              <ChevronRight aria-hidden="true" className="popover-menu__chevron" size={ICON.sm} />
            </button>
            {shellMenuOpen ? (
              <div className="popover-menu__submenu" id={`${menuId}-shell`} role="group" aria-label="Shell Profile">
                {shellProfiles.map((profile) => (
                  <button
                    disabled={!profile.available && !profile.isDefault}
                    key={profile.id}
                    onClick={() => start("shell", profile.id)}
                    role="menuitem"
                    title={profile.available || profile.isDefault
                      ? profile.executable ?? shellProfileLabel(profile.id)
                      : profile.reason ?? `${shellProfileLabel(profile.id)} 不可用`}
                    type="button"
                  >
                    <span>{shellProfileLabel(profile.id)}</span>
                    {profile.isDefault && profile.available ? <Check aria-label="默认" size={ICON.xs} /> : null}
                    {!profile.available && !profile.isDefault ? <i>不可用</i> : null}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              onClick={() => {
                closeMenu();
                setSshDialogOpen(true);
              }}
              role="menuitem"
              type="button"
            >
              <Server aria-hidden="true" size={ICON.md} />
              <span>SSH</span>
            </button>
            {agents.map((agent) => {
              const label = agent.descriptor.displayName;
              const Icon = agent.kind === "codex" ? CodexIcon
                : agent.kind === "claude" ? ClaudeIcon : PiIcon;
              return (
                <button
                  disabled={!agent.available}
                  key={agent.kind}
                  onClick={() => start(agent.kind)}
                  role="menuitem"
                  title={agent.available ? agent.version ?? label : agent.reason ?? `${label} 不可用`}
                  type="button"
                >
                  <Icon aria-hidden="true" size={ICON.md} />
                  <span>{label}</span>
                  {agent.available ? null : <i>未就绪</i>}
                </button>
              );
            })}
            <button
              className="popover-refresh"
              aria-busy={refreshing}
              aria-disabled={refreshing}
              onClick={() => void refresh()}
              role="menuitem"
              type="button"
            >
              <RefreshCcw aria-hidden="true" size={ICON.sm} />
              <span>{refreshing ? "检测中…" : "重新检测"}</span>
            </button>
            {refreshError ? <p className="new-session-menu__error" role="alert">{refreshError}</p> : null}
          </div>
        ) : null}
      </div>

      {sshDialogOpen ? (
        <SshDialog
          onCancel={cancelSsh}
          onConnect={connectSsh}
        />
      ) : null}
    </>
  );
}

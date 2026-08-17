import { Plus, RefreshCcw, Server, SquareTerminal } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { ICON } from "../../theme/sizing";
import type { SshLaunch } from "../../terminal/contracts";
import type { AgentAvailability, WorkspaceTabKind } from "../contracts";
import { useDismiss } from "../useDismiss";
import { ClaudeIcon, CodexIcon } from "./AgentIcons";
import { SshDialog } from "./SshDialog";

interface NewSessionMenuProps {
  agents: AgentAvailability[];
  onLaunch: (kind: WorkspaceTabKind) => void;
  onLaunchSsh: (target: SshLaunch) => void;
  onRefresh: () => Promise<void>;
  shellShortcut: string;
}

export function NewSessionMenu({
  agents,
  onLaunch,
  onLaunchSsh,
  onRefresh,
  shellShortcut,
}: NewSessionMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sshDialogOpen, setSshDialogOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const menuRef = useDismiss<HTMLDivElement>(menuOpen, closeMenu);

  const start = (kind: WorkspaceTabKind) => {
    setMenuOpen(false);
    onLaunch(kind);
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
      <div className="popover-host" ref={menuRef}>
        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="icon-button icon-button--sm"
          onClick={() => setMenuOpen((value) => !value)}
          ref={triggerRef}
          title={`新建会话（Shell ${shellShortcut}）`}
          type="button"
        >
          <Plus aria-hidden="true" size={ICON.md} />
        </button>

        {menuOpen ? (
          <div className="popover popover--menu" role="menu" aria-label="新建会话">
            <button onClick={() => start("shell")} role="menuitem" type="button">
              <SquareTerminal aria-hidden="true" size={ICON.md} />
              <span>Shell</span>
              <i>{shellShortcut}</i>
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                setSshDialogOpen(true);
              }}
              role="menuitem"
              type="button"
            >
              <Server aria-hidden="true" size={ICON.md} />
              <span>SSH</span>
            </button>
            {agents.map((agent) => {
              const label = agent.kind === "codex" ? "Codex" : "Claude";
              const Icon = agent.kind === "codex" ? CodexIcon : ClaudeIcon;
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
              onClick={() => void onRefresh()}
              role="menuitem"
              type="button"
            >
              <RefreshCcw aria-hidden="true" size={ICON.sm} />
              <span>重新检测</span>
            </button>
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

import { Bot, Plus, RefreshCcw, Sparkles, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { ICON } from "../../theme/sizing";
import type { AgentAvailability, WorkspaceTabKind } from "../contracts";
import { useDismiss } from "../useDismiss";

interface NewSessionMenuProps {
  agents: AgentAvailability[];
  onLaunch: (kind: WorkspaceTabKind) => void;
  onRefresh: () => Promise<void>;
}

export function NewSessionMenu({ agents, onLaunch, onRefresh }: NewSessionMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  const start = (kind: WorkspaceTabKind) => {
    setOpen(false);
    onLaunch(kind);
  };

  return (
    <div className="popover-host" ref={ref}>
      <button
        aria-expanded={open}
        className="icon-button icon-button--sm"
        onClick={() => setOpen((value) => !value)}
        title="新建会话"
        type="button"
      >
        <Plus aria-hidden="true" size={ICON.md} />
      </button>

      {open ? (
        <div className="popover popover--menu" role="menu" aria-label="新建会话">
          <button onClick={() => start("shell")} role="menuitem" type="button">
            <SquareTerminal aria-hidden="true" size={ICON.md} />
            <span>Shell</span>
          </button>
          {agents.map((agent) => {
            const label = agent.kind === "codex" ? "Codex" : "Claude";
            const Icon = agent.kind === "codex" ? Bot : Sparkles;
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
  );
}
